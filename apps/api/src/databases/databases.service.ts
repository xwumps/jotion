import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type DbView, type Page } from '@jotion/db';
import {
  calculationsFor,
  CREATABLE_VIEW_TYPES,
  defaultStatusOptions,
  keyBetween,
  parsePropertyConfig,
  viewConfigSchema,
  calendarConfigSchema,
  groupBySchema,
  timelineConfigSchema,
  type createDatabaseSchema,
  type createPropertySchema,
  type createViewSchema,
  type DatabaseDto,
  type DatabaseSearchResultDto,
  type PageIcon,
  type PropertyDto,
  type PropertyType,
  type PropertyValue,
  type updatePropertySchema,
  type updateViewSchema,
  type ViewConfig,
  type ViewDto,
  type ViewType,
} from '@jotion/shared';
import { canConvert, convertProperty, fromStorage, toStorage } from '@jotion/query';
import type { z } from 'zod';
import { CollabService } from '../collab/collab.service';
import { AppError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { recordEvent } from '../events/outbox';
import { PrismaService } from '../infra/prisma.service';
import { computePosition } from '../pages/positions';
import { PermissionService } from '../permissions/permission.service';
import { ComputeService } from './compute.service';
import { COMPUTED_TYPES, ComputedSchemaService } from './computed-schema';
import { DatabaseAccessService, safeConfig, type LoadedProperty } from './database-access';
import { storedValueData } from './values';

type Tx = Prisma.TransactionClient;

const de = (u: AuthUser) => (u.locale ?? 'de') !== 'en';
const labels = (u: AuthUser) =>
  de(u)
    ? {
        name: 'Name',
        tags: 'Tags',
        table: 'Tabelle',
        status: ['Nicht begonnen', 'In Bearbeitung', 'Erledigt'] as [string, string, string],
        yesNo: ['Ja', 'Nein'] as [string, string],
      }
    : {
        name: 'Name',
        tags: 'Tags',
        table: 'Table',
        status: ['Not started', 'In progress', 'Done'] as [string, string, string],
        yesNo: ['Yes', 'No'] as [string, string],
      };

/** Datenbanken, Properties und Ansichten. Zeilen siehe RowsService. */
@Injectable()
export class DatabasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly access: DatabaseAccessService,
    private readonly collab: CollabService,
    private readonly computed: ComputedSchemaService,
    private readonly compute: ComputeService,
  ) {}

  // ---------------------------------------------------------------- Datenbank

  async create(
    user: AuthUser,
    workspaceId: string,
    input: z.output<typeof createDatabaseSchema>,
  ): Promise<DatabaseDto> {
    await this.perms.requireMember(user.id, workspaceId);
    let parent: Page | null = null;
    if (input.parentId) {
      parent = (await this.perms.requireEditablePage(user.id, input.parentId)).page;
      if (parent.workspaceId !== workspaceId) throw notFound('Seite');
      if (parent.kind === 'DATABASE')
        throw new AppError('bad_request', 'In einer Datenbank können keine Datenbanken liegen');
    }
    let sourceId: string | null = null;
    if (input.sourceDatabaseId) {
      const src = await this.access.require(user.id, input.sourceDatabaseId);
      if (src.page.workspaceId !== workspaceId || !src.data) throw notFound('Datenbank');
      sourceId = src.data.db.id;
    }
    const scope = parent ? parent.scope : (input.scope ?? 'PRIVATE');
    const ownerId = parent ? parent.ownerId : user.id;
    const l = labels(user);

    const page = await this.prisma.client.$transaction(async (tx) => {
      const position = await computePosition(
        tx,
        { workspaceId, parentId: parent?.id ?? null, scope, ownerId },
        { afterId: input.afterId, beforeId: input.beforeId },
      );
      const created = await tx.page.create({
        data: {
          workspaceId,
          parentId: parent?.id ?? null,
          kind: 'DATABASE',
          position,
          title: input.title ?? '',
          scope,
          ownerId,
          createdById: user.id,
          lastEditedById: user.id,
        },
      });
      await tx.database.create({
        data: {
          id: created.id,
          workspaceId,
          isInline: input.inline,
          sourceDatabaseId: sourceId,
        },
      });
      if (!sourceId) {
        const [p1, p2] = [keyBetween(null, null), keyBetween(keyBetween(null, null), null)];
        await tx.dbProperty.createMany({
          data: [
            { databaseId: created.id, type: 'title', name: l.name, position: p1, config: {} },
            {
              databaseId: created.id,
              type: 'multi_select',
              name: l.tags,
              position: p2,
              config: { options: [] },
            },
          ],
        });
      }
      await tx.dbView.create({
        data: {
          databaseId: created.id,
          type: 'table',
          name: l.table,
          position: keyBetween(null, null),
          config: viewConfigSchema.parse({}) as Prisma.InputJsonValue,
        },
      });
      await recordEvent(tx, {
        workspaceId,
        type: 'page.created',
        entityId: created.id,
        actorId: user.id,
        audienceUserId: created.scope === 'PRIVATE' ? created.ownerId : null,
        payload: { parentId: created.parentId },
      });
      return created;
    });
    if (parent && !input.inline && input.insertBlock)
      await this.collab.addSubpageBlock(parent.id, page.id);
    return this.get(user, page.id);
  }

  async get(user: AuthUser, databaseId: string): Promise<DatabaseDto> {
    const a = await this.access.require(user.id, databaseId, { includeTrashed: true });
    const [properties, views] = await Promise.all([
      a.data ? this.access.properties(a.data.db.id) : Promise.resolve([]),
      this.prisma.client.dbView.findMany({
        where: { databaseId },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      id: a.page.id,
      workspaceId: a.page.workspaceId,
      title: a.page.title,
      icon: (a.page.icon as PageIcon | null) ?? null,
      scope: a.page.scope,
      parentId: a.page.parentId,
      isInline: a.db.isInline,
      source:
        a.db.sourceDatabaseId && a.data
          ? {
              id: a.data.page.id,
              title: a.data.page.title,
              icon: (a.data.page.icon as PageIcon | null) ?? null,
            }
          : null,
      sourceMissing: !a.data,
      dataId: a.data?.db.id ?? a.page.id,
      properties: properties.map(propertyDto),
      views: views.map(viewDto),
      canEdit: !a.page.deletedAt,
      locked: Boolean((a.page.settings as { locked?: boolean } | null)?.locked),
      deleted: Boolean(a.page.deletedAt),
    };
  }

  /** Datenbanken für die Auswahl einer Linked Database (nur sichtbare, keine verknüpften). */
  async search(user: AuthUser, workspaceId: string, q: string): Promise<DatabaseSearchResultDto[]> {
    await this.perms.requireMember(user.id, workspaceId);
    const query = q.trim().slice(0, 200);
    const like = `%${query.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows = await this.prisma.client.$queryRaw<
      { id: string; title: string; icon: PageIcon | null; path: string | null }[]
    >`
      SELECT p.id::text, p.title, p.icon,
             (SELECT string_agg(NULLIF(a.title, ''), ' / ' ORDER BY nlevel(a.path))
                FROM pages a WHERE a.path @> p.path AND a.id <> p.id) AS path
        FROM pages p JOIN databases d ON d.id = p.id
       WHERE p.workspace_id = ${workspaceId}::uuid AND p.kind = 'DATABASE' AND d.source_database_id IS NULL
         AND p.deleted_at IS NULL AND (p.scope = 'TEAM' OR p.owner_id = ${user.id}::uuid)
         ${query ? Prisma.sql`AND p.title ILIKE ${like}` : Prisma.empty}
       ORDER BY p.last_edited_at DESC LIMIT 20`;
    return rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon, path: r.path ?? '' }));
  }

  // ---------------------------------------------------------------- Properties

  async createProperty(
    user: AuthUser,
    databaseId: string,
    input: z.output<typeof createPropertySchema>,
  ): Promise<PropertyDto> {
    const a = await this.access.requireData(user.id, databaseId, { schema: true });
    const dataId = a.data.db.id;
    const l = labels(user);
    let config: unknown = input.config ?? {};
    if (input.type === 'status' && !(config as { options?: unknown[] }).options?.length)
      config = { options: defaultStatusOptions(randomUUID, l.status) };
    if (input.type === 'unique_id') config = { ...(config as object), nextValue: 1 };
    const isComputed = COMPUTED_TYPES.includes(input.type);
    const prepared = isComputed
      ? await this.computed.prepare(user, a.data, input.type, config as Record<string, unknown>, {
          name: input.name,
        })
      : null;
    const parsed = parsePropertyConfig(input.type, prepared ? prepared.config : config);
    if (input.viewId) await this.requireView(databaseId, input.viewId);

    const created = await this.prisma.client.$transaction(async (tx) => {
      await this.lockSchema(tx, dataId);
      const last = await tx.dbProperty.findFirst({
        where: { databaseId: dataId },
        orderBy: { position: 'desc' },
      });
      const prop = await tx.dbProperty.create({
        data: {
          databaseId: dataId,
          type: input.type,
          name: input.name,
          position: keyBetween(last?.position ?? null, null),
          config: parsed as Prisma.InputJsonValue,
        },
      });
      if (input.type === 'unique_id') await this.assignUniqueIds(tx, dataId, prop.id);
      if (prepared?.reverse) {
        const reverseId = await this.computed.createReverse(
          tx,
          { id: prop.id, databaseId: dataId },
          prepared.reverse,
        );
        await tx.dbProperty.update({
          where: { id: prop.id },
          data: {
            config: {
              ...(parsed as object),
              reversePropertyId: reverseId,
            } as Prisma.InputJsonValue,
          },
        });
        await this.dataEvent(tx, prepared.reverse.databaseId, user.id);
      }
      if (isComputed) await this.computed.reanalyzeFormulas(tx, dataId);
      if (input.viewId && input.afterPropertyId !== undefined) {
        const view = await tx.dbView.findUniqueOrThrow({ where: { id: input.viewId } });
        const cfg = viewConfigSchema.parse(view.config ?? {});
        const props = await this.access.properties(dataId, tx);
        const order = columnOrder(cfg, props).filter((id) => id !== prop.id);
        const i = input.afterPropertyId ? order.indexOf(input.afterPropertyId) : -1;
        order.splice(i + 1, 0, prop.id);
        const visible = new Map(cfg.properties.map((p) => [p.id, p]));
        cfg.properties = order.map((id) => visible.get(id) ?? { id, visible: true });
        await tx.dbView.update({
          where: { id: view.id },
          data: { config: cfg as Prisma.InputJsonValue },
        });
      }
      await this.access.event(tx, a.data.page, 'database.changed', user.id);
      if (a.data.page.id !== a.page.id)
        await this.access.event(tx, a.page, 'database.changed', user.id);
      return tx.dbProperty.findUniqueOrThrow({ where: { id: prop.id } });
    });
    if (isComputed) await this.compute.databaseChanged(dataId, user.id);
    return propertyDto({
      id: created.id,
      name: created.name,
      type: created.type as PropertyType,
      position: created.position,
      config: safeConfig(created.type as PropertyType, created.config),
    });
  }

  async updateProperty(
    user: AuthUser,
    databaseId: string,
    propertyId: string,
    input: z.output<typeof updatePropertySchema>,
  ): Promise<PropertyDto> {
    const a = await this.access.requireData(user.id, databaseId, { schema: true });
    const dataId = a.data.db.id;
    const prop = await this.prisma.client.dbProperty.findUnique({ where: { id: propertyId } });
    if (!prop || prop.databaseId !== dataId) throw notFound('Property');
    const type = prop.type as PropertyType;

    const involvesComputed =
      COMPUTED_TYPES.includes(type) ||
      (input.type !== undefined && COMPUTED_TYPES.includes(input.type));
    if (input.type && input.type !== type) {
      if (involvesComputed)
        throw new AppError(
          'validation_failed',
          'Relationen, Rollups und Formeln lassen sich nicht in andere Typen umwandeln',
        );
      await this.convert(user, a.data.page, prop.id, type, prop.config, input.type, input.config);
      if (input.name)
        await this.prisma.client.dbProperty.update({
          where: { id: prop.id },
          data: { name: input.name },
        });
    } else {
      let config: unknown = undefined;
      let prepared: Awaited<ReturnType<ComputedSchemaService['prepare']>> | null = null;
      if (input.config && COMPUTED_TYPES.includes(type)) {
        prepared = await this.computed.prepare(user, a.data, type, input.config, {
          selfId: prop.id,
          existing: (prop.config ?? {}) as Record<string, unknown>,
        });
        config = parsePropertyConfig(type, prepared.config);
      } else if (input.config) {
        const merged =
          type === 'unique_id'
            ? { ...input.config, nextValue: (prop.config as { nextValue?: number }).nextValue ?? 1 }
            : input.config;
        config = parsePropertyConfig(type, merged);
      }
      const oldRelation =
        type === 'relation' ? (prop.config as { reversePropertyId?: string | null }) : null;
      await this.prisma.client.$transaction(async (tx) => {
        await this.lockSchema(tx, dataId);
        await tx.dbProperty.update({
          where: { id: prop.id },
          data: {
            ...(input.name ? { name: input.name } : {}),
            ...(config ? { config: config as Prisma.InputJsonValue } : {}),
          },
        });
        if (input.name && input.name !== prop.name)
          await this.computed.renameReferences(tx, dataId, prop.name, input.name);
        if (prepared?.reverse) {
          // "Zweiseitig" eingeschaltet
          const reverseId = await this.computed.createReverse(
            tx,
            { id: prop.id, databaseId: dataId },
            prepared.reverse,
          );
          await tx.dbProperty.update({
            where: { id: prop.id },
            data: {
              config: {
                ...(config as object),
                reversePropertyId: reverseId,
              } as Prisma.InputJsonValue,
            },
          });
          await this.dataEvent(tx, prepared.reverse.databaseId, user.id);
        } else if (
          type === 'relation' &&
          config &&
          oldRelation?.reversePropertyId &&
          !(config as { twoWay: boolean }).twoWay
        ) {
          // "Zweiseitig" ausgeschaltet: Gegen-Relation entfernen
          const rev = await tx.dbProperty.findUnique({
            where: { id: oldRelation.reversePropertyId },
          });
          if (rev) {
            await tx.dbProperty.delete({ where: { id: rev.id } });
            await this.computed.reanalyzeFormulas(tx, rev.databaseId);
            await this.dataEvent(tx, rev.databaseId, user.id);
          }
        }
        if (involvesComputed || input.name) await this.computed.reanalyzeFormulas(tx, dataId);
        // Gelöschte Optionen aus allen Werten entfernen
        if (config && (type === 'select' || type === 'multi_select' || type === 'status')) {
          const keep = (config as { options: { id: string }[] }).options.map((o) => o.id);
          await tx.$executeRaw`
            UPDATE property_values SET v_option_ids = ARRAY(SELECT x FROM unnest(v_option_ids) x WHERE x = ANY(${keep}::uuid[]))
             WHERE property_id = ${prop.id}::uuid AND NOT (v_option_ids <@ ${keep}::uuid[])`;
          await tx.$executeRaw`
            DELETE FROM property_values WHERE property_id = ${prop.id}::uuid AND cardinality(v_option_ids) = 0`;
          await this.access.event(tx, a.data.page, 'database.rows.changed', user.id);
        }
        await this.access.event(tx, a.data.page, 'database.changed', user.id);
      });
      if (involvesComputed || input.name) await this.compute.databaseChanged(dataId, user.id);
    }
    const p = await this.prisma.client.dbProperty.findUniqueOrThrow({ where: { id: prop.id } });
    return propertyDto({
      id: p.id,
      name: p.name,
      type: p.type as PropertyType,
      position: p.position,
      config: safeConfig(p.type as PropertyType, p.config),
    });
  }

  async deleteProperty(user: AuthUser, databaseId: string, propertyId: string): Promise<void> {
    const a = await this.access.requireData(user.id, databaseId, { schema: true });
    const prop = await this.prisma.client.dbProperty.findUnique({ where: { id: propertyId } });
    if (!prop || prop.databaseId !== a.data.db.id) throw notFound('Property');
    if (prop.type === 'title')
      throw new AppError('bad_request', 'Die Titel-Spalte kann nicht gelöscht werden');
    const reverseId =
      prop.type === 'relation'
        ? (prop.config as { reversePropertyId?: string | null }).reversePropertyId
        : null;
    let reverseDb: string | null = null;
    await this.prisma.client.$transaction(async (tx) => {
      await this.lockSchema(tx, a.data.db.id);
      await tx.dbProperty.delete({ where: { id: prop.id } });
      // Zweiseitige Relation: Gegen-Property mit entfernen (wie Notion)
      if (reverseId) {
        const rev = await tx.dbProperty.findUnique({ where: { id: reverseId } });
        if (rev) {
          await tx.dbProperty.delete({ where: { id: rev.id } });
          reverseDb = rev.databaseId;
          if (rev.databaseId !== a.data.db.id)
            await this.computed.reanalyzeFormulas(tx, rev.databaseId);
          await this.dataEvent(tx, rev.databaseId, user.id);
        }
      }
      await this.computed.reanalyzeFormulas(tx, a.data.db.id);
      await this.access.event(tx, a.data.page, 'database.changed', user.id);
      await this.access.event(tx, a.data.page, 'database.rows.changed', user.id);
    });
    await this.compute.databaseChanged(a.data.db.id, user.id);
    if (reverseDb && reverseDb !== a.data.db.id)
      await this.compute.databaseChanged(reverseDb, user.id);
  }

  /** Ereignis "Schema geändert" für eine andere Datenbank (Gegen-Relation). */
  private async dataEvent(tx: Tx, databaseId: string, actorId: string) {
    const page = await tx.page.findUnique({ where: { id: databaseId } });
    if (page) await this.access.event(tx, page, 'database.changed', actorId);
  }

  /**
   * Typwechsel: alle Werte nach den Regeln aus @jotion/query umwandeln. Alter Typ, alte
   * Konfiguration und alte Werte landen als Snapshot in db_property_conversions (Rückgängig).
   * Läuft in einer Transaktion: entweder ist alles umgewandelt oder nichts.
   */
  private async convert(
    user: AuthUser,
    dataPage: Page,
    propertyId: string,
    from: PropertyType,
    fromConfigRaw: unknown,
    to: PropertyType,
    toConfig: unknown,
  ): Promise<void> {
    if (!canConvert(from, to))
      throw new AppError('bad_request', `Typwechsel von ${from} nach ${to} ist nicht möglich`);
    const l = labels(user);
    const fromConfig = safeConfig(from, fromConfigRaw);
    await this.prisma.client.$transaction(
      async (tx) => {
        await this.lockSchema(tx, dataPage.id);
        const old = await this.currentValues(tx, dataPage.id, propertyId, from);
        const names = new Map(
          (
            await tx.user.findMany({
              where: { memberships: { some: { workspaceId: dataPage.workspaceId } } },
              select: { id: true, name: true },
            })
          ).map((u) => [u.id, u.name]),
        );
        const result = convertProperty(
          {
            from: { type: from, config: fromConfig },
            to: { type: to, config: toConfig },
            values: old,
          },
          {
            newId: randomUUID,
            userName: (id) => names.get(id),
            statusLabels: l.status,
            yesNo: l.yesNo,
          },
        );
        await tx.dbPropertyConversion.create({
          data: {
            propertyId,
            fromType: from,
            fromConfig: fromConfig as Prisma.InputJsonValue,
            toType: to,
            toConfig: result.config as Prisma.InputJsonValue,
            // Nur gespeicherte Werte sichern; abgeleitete stammen ohnehin aus der Seite
            values: (isStored(from)
              ? old.filter((v) => v.value !== null)
              : []) as Prisma.InputJsonValue,
            createdById: user.id,
          },
        });
        await tx.dbProperty.update({
          where: { id: propertyId },
          data: { type: to, config: result.config as Prisma.InputJsonValue },
        });
        await this.writeValues(tx, dataPage.id, propertyId, to, result.values);
        if (to === 'unique_id') await this.assignUniqueIds(tx, dataPage.id, propertyId);
        await this.access.event(tx, dataPage, 'database.changed', user.id);
        await this.access.event(tx, dataPage, 'database.rows.changed', user.id);
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  /** Letzten Typwechsel rückgängig machen (nur, wenn der Typ seitdem gleich geblieben ist). */
  async undoConversion(
    user: AuthUser,
    databaseId: string,
    propertyId: string,
  ): Promise<PropertyDto> {
    const a = await this.access.requireData(user.id, databaseId, { schema: true });
    const prop = await this.prisma.client.dbProperty.findUnique({ where: { id: propertyId } });
    if (!prop || prop.databaseId !== a.data.db.id) throw notFound('Property');
    await this.prisma.client.$transaction(
      async (tx) => {
        await this.lockSchema(tx, a.data.db.id);
        const conv = await tx.dbPropertyConversion.findFirst({
          where: { propertyId },
          orderBy: { createdAt: 'desc' },
        });
        if (!conv || conv.toType !== prop.type)
          throw new AppError('conflict', 'Kein Typwechsel zum Rückgängigmachen');
        const values = conv.values as { rowId: string; value: PropertyValue }[];
        await tx.dbProperty.update({
          where: { id: propertyId },
          data: { type: conv.fromType, config: conv.fromConfig as Prisma.InputJsonValue },
        });
        // Nur Zeilen, die es noch gibt
        const existing = new Set(
          (
            await tx.page.findMany({
              where: { databaseId: a.data.db.id, id: { in: values.map((v) => v.rowId) } },
              select: { id: true },
            })
          ).map((r) => r.id),
        );
        await this.writeValues(
          tx,
          a.data.db.id,
          propertyId,
          conv.fromType as PropertyType,
          values.filter((v) => existing.has(v.rowId)),
        );
        await tx.dbPropertyConversion.delete({ where: { id: conv.id } });
        await this.access.event(tx, a.data.page, 'database.changed', user.id);
        await this.access.event(tx, a.data.page, 'database.rows.changed', user.id);
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    return this.propertyById(propertyId);
  }

  private async propertyById(id: string): Promise<PropertyDto> {
    const p = await this.prisma.client.dbProperty.findUniqueOrThrow({ where: { id } });
    return propertyDto({
      id: p.id,
      name: p.name,
      type: p.type as PropertyType,
      position: p.position,
      config: safeConfig(p.type as PropertyType, p.config),
    });
  }

  /** Werte eines Properties für alle Zeilen (abgeleitete Typen aus der Seite). */
  private async currentValues(
    tx: Tx,
    databaseId: string,
    propertyId: string,
    type: PropertyType,
  ): Promise<{ rowId: string; value: PropertyValue }[]> {
    if (!isStored(type)) {
      const rows = await tx.page.findMany({
        where: { databaseId },
        select: {
          id: true,
          createdAt: true,
          lastEditedAt: true,
          createdById: true,
          lastEditedById: true,
        },
      });
      return rows.map((r) => ({
        rowId: r.id,
        value:
          type === 'created_time'
            ? r.createdAt.toISOString()
            : type === 'last_edited_time'
              ? r.lastEditedAt.toISOString()
              : type === 'created_by'
                ? r.createdById
                : r.lastEditedById,
      }));
    }
    const vals = await tx.propertyValue.findMany({ where: { propertyId } });
    return vals.map((v) => ({ rowId: v.rowId, value: fromStorage(type, v) }));
  }

  /** Ersetzt alle Werte eines Properties (in Blöcken). */
  private async writeValues(
    tx: Tx,
    databaseId: string,
    propertyId: string,
    type: PropertyType,
    values: { rowId: string; value: PropertyValue }[],
  ): Promise<void> {
    await tx.propertyValue.deleteMany({ where: { propertyId } });
    const data: Prisma.PropertyValueCreateManyInput[] = [];
    for (const v of values) {
      const cols = toStorage(type, v.value);
      if (cols) data.push(storedValueData(v.rowId, propertyId, databaseId, cols));
    }
    for (let i = 0; i < data.length; i += 5000)
      await tx.propertyValue.createMany({ data: data.slice(i, i + 5000), skipDuplicates: true });
  }

  /** Vergibt fortlaufende IDs an alle Zeilen ohne ID (Reihenfolge der Erstellung). */
  private async assignUniqueIds(tx: Tx, databaseId: string, propertyId: string): Promise<void> {
    const prop = await tx.dbProperty.findUniqueOrThrow({ where: { id: propertyId } });
    const cfg = parsePropertyConfig('unique_id', prop.config) as {
      prefix: string | null;
      nextValue: number;
    };
    const [res] = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT max(v_number)::float8 AS max FROM property_values WHERE property_id = ${propertyId}::uuid`;
    const start = Math.max(cfg.nextValue, (res?.max ?? 0) + 1);
    const inserted = await tx.$executeRaw`
      INSERT INTO property_values (row_id, property_id, database_id, v_number, updated_at)
      SELECT p.id, ${propertyId}::uuid, ${databaseId}::uuid,
             ${start}::float8 + row_number() OVER (ORDER BY p.created_at, p.id) - 1, now()
        FROM pages p
       WHERE p.database_id = ${databaseId}::uuid AND p.kind = 'DATABASE_ROW'
         AND NOT EXISTS (SELECT 1 FROM property_values v WHERE v.row_id = p.id AND v.property_id = ${propertyId}::uuid)`;
    await tx.dbProperty.update({
      where: { id: propertyId },
      data: { config: { ...cfg, nextValue: start + inserted } },
    });
  }

  /** Serialisiert Schemaänderungen einer Datenbank. */
  private lockSchema(tx: Tx, databaseId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dbschema:${databaseId}`}, 0))`;
  }

  // ---------------------------------------------------------------- Ansichten

  private async requireView(databaseId: string, viewId: string): Promise<DbView> {
    const view = await this.prisma.client.dbView.findUnique({ where: { id: viewId } });
    if (!view || view.databaseId !== databaseId) throw notFound('Ansicht');
    return view;
  }

  async createView(
    user: AuthUser,
    databaseId: string,
    input: z.output<typeof createViewSchema>,
  ): Promise<ViewDto> {
    const a = await this.access.requireEditableStructure(user.id, databaseId);
    if (!(CREATABLE_VIEW_TYPES as readonly string[]).includes(input.type))
      throw new AppError('bad_request', 'Diese Ansicht folgt in einer späteren Phase');
    let config: ViewConfig = viewConfigSchema.parse({});
    if (input.duplicateOf) {
      const src = await this.requireView(databaseId, input.duplicateOf);
      config = viewConfigSchema.parse(src.config ?? {});
    }
    if (a.data)
      config = layoutDefaults(input.type, config, await this.access.properties(a.data.db.id));
    const view = await this.prisma.client.$transaction(async (tx) => {
      await this.lockSchema(tx, databaseId);
      const position = await this.viewPosition(tx, databaseId, input.afterId, input.beforeId);
      const v = await tx.dbView.create({
        data: {
          databaseId,
          type: input.type as ViewType,
          name: input.name,
          position,
          config: config as Prisma.InputJsonValue,
        },
      });
      await this.access.event(tx, a.page, 'database.changed', user.id);
      return v;
    });
    return viewDto(view);
  }

  async updateView(
    user: AuthUser,
    databaseId: string,
    viewId: string,
    input: z.output<typeof updateViewSchema>,
  ): Promise<ViewDto> {
    const a = await this.access.requireEditableStructure(user.id, databaseId);
    await this.requireView(databaseId, viewId);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await this.lockSchema(tx, databaseId);
      // Erst nach der Sperre lesen: sonst überschreiben sich gleichzeitige Teil-Updates
      // (z. B. Filter und Sortierung) gegenseitig und eine Einstellung geht verloren.
      const fresh = await tx.dbView.findUniqueOrThrow({ where: { id: viewId } });
      const current = viewConfigSchema.parse(fresh.config ?? {});
      let config = input.config ? viewConfigSchema.parse({ ...current, ...input.config }) : current;
      if (input.type && input.type !== fresh.type && a.data)
        config = layoutDefaults(input.type, config, await this.access.properties(a.data.db.id, tx));
      const moving = input.afterId !== undefined || input.beforeId !== undefined;
      const v = await tx.dbView.update({
        where: { id: viewId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.type ? { type: input.type as ViewType } : {}),
          config: config as Prisma.InputJsonValue,
          ...(moving
            ? {
                position: await this.viewPosition(
                  tx,
                  databaseId,
                  input.afterId,
                  input.beforeId,
                  viewId,
                ),
              }
            : {}),
        },
      });
      await this.access.event(tx, a.page, 'database.changed', user.id, { viewId });
      return v;
    });
    return viewDto(updated);
  }

  async deleteView(user: AuthUser, databaseId: string, viewId: string): Promise<void> {
    const a = await this.access.requireEditableStructure(user.id, databaseId);
    await this.requireView(databaseId, viewId);
    await this.prisma.client.$transaction(async (tx) => {
      await this.lockSchema(tx, databaseId);
      if ((await tx.dbView.count({ where: { databaseId } })) <= 1)
        throw new AppError('conflict', 'Die letzte Ansicht kann nicht gelöscht werden');
      await tx.dbView.delete({ where: { id: viewId } });
      await this.access.event(tx, a.page, 'database.changed', user.id);
    });
  }

  private async viewPosition(
    tx: Tx,
    databaseId: string,
    afterId?: string | null,
    beforeId?: string | null,
    excludeId?: string,
  ): Promise<string> {
    const views = (
      await tx.dbView.findMany({
        where: { databaseId },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, position: true },
      })
    ).filter((v) => v.id !== excludeId);
    let prev = views.at(-1)?.position ?? null;
    let next: string | null = null;
    if (afterId) {
      const i = views.findIndex((v) => v.id === afterId);
      if (i < 0) throw notFound('Ansicht');
      prev = views[i]!.position;
      next = views[i + 1]?.position ?? null;
    } else if (beforeId) {
      const i = views.findIndex((v) => v.id === beforeId);
      if (i < 0) throw notFound('Ansicht');
      next = views[i]!.position;
      prev = views[i - 1]?.position ?? null;
    }
    try {
      return keyBetween(prev, next);
    } catch {
      return keyBetween(views.at(-1)?.position ?? null, null);
    }
  }
}

/**
 * Sinnvolle Standardwerte je Layout (wie Notion): Board gruppiert nach dem ersten Status- bzw.
 * Auswahl-Property, Kalender und Zeitleiste nutzen das erste Datums-Property.
 */
export function layoutDefaults(
  type: string,
  config: ViewConfig,
  props: LoadedProperty[],
): ViewConfig {
  const first = (...types: PropertyType[]) =>
    types.map((t) => props.find((p) => p.type === t)).find(Boolean);
  const next = { ...config };
  if (type === 'board' && !next.groupBy) {
    const p = first('status', 'select', 'multi_select', 'person', 'checkbox');
    if (p) next.groupBy = groupBySchema.parse({ propertyId: p.id });
  }
  const date = first('date', 'created_time', 'last_edited_time');
  if (type === 'calendar' && !next.calendar?.datePropertyId && date)
    next.calendar = calendarConfigSchema.parse({ ...next.calendar, datePropertyId: date.id });
  if (type === 'timeline' && !next.timeline?.startPropertyId && date)
    next.timeline = timelineConfigSchema.parse({ ...next.timeline, startPropertyId: date.id });
  return viewConfigSchema.parse(next);
}

export function isStored(type: PropertyType): boolean {
  return !['title', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by'].includes(
    type,
  );
}

/** Spaltenreihenfolge einer Ansicht: konfigurierte zuerst, neue am Ende. */
export function columnOrder(cfg: ViewConfig, props: LoadedProperty[]): string[] {
  const known = new Set(props.map((p) => p.id));
  const order = cfg.properties.map((p) => p.id).filter((id) => known.has(id));
  for (const p of props) if (!order.includes(p.id)) order.push(p.id);
  // Titel steht immer zuerst
  const title = props.find((p) => p.type === 'title');
  return title ? [title.id, ...order.filter((id) => id !== title.id)] : order;
}

export function propertyDto(p: LoadedProperty): PropertyDto {
  return { id: p.id, name: p.name, type: p.type, config: p.config as never, position: p.position };
}

export function viewDto(v: DbView): ViewDto {
  let config: ViewConfig;
  try {
    config = viewConfigSchema.parse(v.config ?? {});
  } catch {
    config = viewConfigSchema.parse({});
  }
  // Ungültige Berechnungen (z. B. nach Typwechsel) werden beim Rechnen ignoriert
  return { id: v.id, name: v.name, type: v.type as ViewType, position: v.position, config };
}

export { calculationsFor };
