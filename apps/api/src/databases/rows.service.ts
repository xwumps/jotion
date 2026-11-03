import { Injectable } from '@nestjs/common';
import { Prisma, type Page } from '@jotion/db';
import {
  calculationsFor,
  isReadonlyType,
  keyBetween,
  parsePropertyConfig,
  PropertyValueError,
  validatePropertyValue,
  viewConfigSchema,
  type CalculationResultDto,
  type calculateSchema,
  type createRowSchema,
  type moveRowSchema,
  type PageIcon,
  type PropertyValue,
  type queryRowsSchema,
  type RowDto,
  type RowQueryResultDto,
  type trashRowsSchema,
  type updateRowSchema,
  type ViewConfig,
} from '@jotion/shared';
import {
  compileCalculationQuery,
  compileCountQuery,
  compileRowQuery,
  CursorMismatchError,
  encodeCursor,
  fromStorage,
  toStorage,
  type QueryContext,
} from '@jotion/query';
import type { z } from 'zod';
import { CollabService } from '../collab/collab.service';
import { AppError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { DatabaseAccessService, type LoadedProperty } from './database-access';
import { storedValueData } from './values';

type Tx = Prisma.TransactionClient;

interface RawRow {
  id: string;
  position: string;
  title: string;
  icon: PageIcon | null;
  created_at: Date;
  created_by_id: string;
  last_edited_at: Date;
  last_edited_by_id: string;
  [key: string]: unknown;
}

/**
 * Zeilen einer Datenbank. Eine Zeile ist eine Seite (kind = DATABASE_ROW) unter der Datenbank,
 * ihre Properties liegen in property_values. Alle Abfragen laufen über den Query-Compiler
 * (parametrisiertes SQL) und sind auf Zeilen beschränkt, die der Nutzer sehen darf.
 */
@Injectable()
export class RowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DatabaseAccessService,
    private readonly collab: CollabService,
  ) {}

  private async viewConfig(databaseId: string, viewId?: string): Promise<ViewConfig | null> {
    if (!viewId) return null;
    const view = await this.prisma.client.dbView.findUnique({ where: { id: viewId } });
    if (!view || view.databaseId !== databaseId) throw notFound('Ansicht');
    try {
      return viewConfigSchema.parse(view.config ?? {});
    } catch {
      return viewConfigSchema.parse({});
    }
  }

  async query(
    user: AuthUser,
    databaseId: string,
    input: z.output<typeof queryRowsSchema>,
  ): Promise<RowQueryResultDto> {
    const a = await this.access.require(user.id, databaseId, { includeTrashed: true });
    const cfg = await this.viewConfig(databaseId, input.viewId);
    if (!a.data) return { rows: [], nextCursor: null, total: 0 };
    const props = await this.access.properties(a.data.db.id);
    const ctx: QueryContext = {
      databaseId: a.data.db.id,
      viewerId: user.id,
      properties: props,
      filter: input.filter !== undefined ? input.filter : (cfg?.filter ?? null),
      sorts: input.sorts ?? cfg?.sorts ?? [],
      search: input.search,
      timeZone: input.timeZone,
    };
    let compiled;
    try {
      compiled = compileRowQuery(ctx, { limit: input.limit, cursor: input.cursor });
    } catch (err) {
      if (err instanceof CursorMismatchError) throw new AppError('bad_request', err.message);
      throw err;
    }
    const count = compileCountQuery(ctx);
    const [raw, totals] = await Promise.all([
      this.prisma.client.$queryRawUnsafe<RawRow[]>(
        compiled.query.sql,
        ...compiled.query.parameters,
      ),
      // Gesamtzahl nur für die erste Seite (beim Weiterblättern bleibt sie gleich)
      input.cursor
        ? Promise.resolve(null)
        : this.prisma.client.$queryRawUnsafe<{ total: number }[]>(count.sql, ...count.parameters),
    ]);
    const page = raw.slice(0, input.limit);
    const rows = await this.toDtos(page, props);
    return {
      rows,
      nextCursor:
        raw.length > input.limit
          ? encodeCursor(compiled.signature, compiled.keyTypes, page.at(-1)!)
          : null,
      total: totals ? (totals[0]?.total ?? 0) : null,
    };
  }

  async calculate(
    user: AuthUser,
    databaseId: string,
    input: z.output<typeof calculateSchema>,
  ): Promise<CalculationResultDto> {
    const a = await this.access.require(user.id, databaseId, { includeTrashed: true });
    const cfg = (await this.viewConfig(databaseId, input.viewId))!;
    if (!a.data) return {};
    const props = await this.access.properties(a.data.db.id);
    const byId = new Map(props.map((p) => [p.id, p]));
    const requests = Object.entries(cfg.calculations)
      .filter(([pid, fn]) => {
        const p = byId.get(pid);
        return p && calculationsFor(p.type).includes(fn);
      })
      .map(([propertyId, fn]) => ({ propertyId, fn }));
    if (!requests.length) return {};
    const { query, requests: valid } = compileCalculationQuery(
      {
        databaseId: a.data.db.id,
        viewerId: user.id,
        properties: props,
        filter: cfg.filter,
        search: input.search,
        timeZone: input.timeZone,
      },
      requests,
    );
    const [res] = await this.prisma.client.$queryRawUnsafe<Record<string, number | null>[]>(
      query.sql,
      ...query.parameters,
    );
    const out: CalculationResultDto = {};
    valid.forEach((r, i) => (out[r.propertyId] = res?.[`r${i}`] ?? null));
    return out;
  }

  async get(user: AuthUser, databaseId: string, rowId: string): Promise<RowDto> {
    const a = await this.access.requireData(user.id, databaseId, { includeTrashed: true });
    const row = await this.requireRow(user, a.data.db.id, rowId, { includeTrashed: true });
    const props = await this.access.properties(a.data.db.id);
    return (await this.pagesToDtos([row], props))[0]!;
  }

  async create(
    user: AuthUser,
    databaseId: string,
    input: z.output<typeof createRowSchema>,
  ): Promise<RowDto> {
    const a = await this.access.requireData(user.id, databaseId);
    const data = a.data;
    const props = await this.access.properties(data.db.id);
    const values = await this.validateValues(data.page.workspaceId, props, input.values ?? {});

    const row = await this.prisma.client.$transaction(async (tx) => {
      const position = await this.rowPosition(tx, data.db.id, input.afterId, input.beforeId);
      const page = await tx.page.create({
        data: {
          workspaceId: data.page.workspaceId,
          parentId: data.db.id,
          databaseId: data.db.id,
          kind: 'DATABASE_ROW',
          position,
          title: (input.title ?? '').trim(),
          // Scope und Owner setzt der Trigger aus der Datenbankseite
          ownerId: data.page.ownerId,
          scope: data.page.scope,
          createdById: user.id,
          lastEditedById: user.id,
        },
      });
      await this.writeValues(tx, data.db.id, page.id, props, values);
      await this.assignUniqueIds(tx, data.db.id, page.id, props);
      await this.access.event(tx, data.page, 'database.rows.changed', user.id, {
        rowIds: [page.id],
      });
      return page;
    });
    return (await this.pagesToDtos([row], props))[0]!;
  }

  async update(
    user: AuthUser,
    databaseId: string,
    rowId: string,
    input: z.output<typeof updateRowSchema>,
  ): Promise<RowDto> {
    const a = await this.access.requireData(user.id, databaseId);
    const row = await this.requireRow(user, a.data.db.id, rowId);
    const props = await this.access.properties(a.data.db.id);
    const values = await this.validateValues(a.data.page.workspaceId, props, input.values);
    const title = input.title !== undefined ? input.title.replace(/\s+/g, ' ').trim() : undefined;
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await this.writeValues(tx, a.data.db.id, row.id, props, values);
      const u = await tx.page.update({
        where: { id: row.id },
        data: {
          ...(title !== undefined ? { title } : {}),
          lastEditedAt: new Date(),
          lastEditedById: user.id,
        },
      });
      await this.access.event(tx, a.data.page, 'database.rows.changed', user.id, {
        rowIds: [row.id],
      });
      if (title !== undefined)
        await this.access.event(tx, a.data.page, 'database.changed', user.id, {});
      return u;
    });
    if (title !== undefined) {
      // Titel erscheint auch in Breadcrumbs und Seitenverweisen
      await this.prisma.client.changeEvent.create({
        data: {
          workspaceId: row.workspaceId,
          type: 'page.updated',
          entityId: row.id,
          actorId: user.id,
          audienceUserId: row.scope === 'PRIVATE' ? row.ownerId : null,
          payload: { title },
        },
      });
    }
    return (await this.pagesToDtos([updated], props))[0]!;
  }

  async move(
    user: AuthUser,
    databaseId: string,
    rowId: string,
    input: z.output<typeof moveRowSchema>,
  ): Promise<RowDto> {
    const a = await this.access.requireData(user.id, databaseId);
    const row = await this.requireRow(user, a.data.db.id, rowId);
    const props = await this.access.properties(a.data.db.id);
    const moved = await this.prisma.client.$transaction(async (tx) => {
      const position = await this.rowPosition(
        tx,
        a.data.db.id,
        input.afterId,
        input.beforeId,
        row.id,
      );
      const u = await tx.page.update({ where: { id: row.id }, data: { position } });
      await this.access.event(tx, a.data.page, 'database.rows.changed', user.id, {
        rowIds: [row.id],
      });
      return u;
    });
    return (await this.pagesToDtos([moved], props))[0]!;
  }

  /** Zeilen in den Papierkorb (jede Zeile samt Unterseiten als eigene Einheit). */
  async trash(
    user: AuthUser,
    databaseId: string,
    input: z.output<typeof trashRowsSchema>,
  ): Promise<{ trashed: number }> {
    const a = await this.access.requireData(user.id, databaseId);
    const rows = await this.prisma.client.page.findMany({
      where: { id: { in: input.rowIds }, databaseId: a.data.db.id, deletedAt: null },
    });
    const visible = rows.filter((r) => r.scope === 'TEAM' || r.ownerId === user.id);
    await this.prisma.client.$transaction(async (tx) => {
      for (const r of visible) {
        await tx.$executeRaw`
          UPDATE pages SET deleted_at = now(), deleted_by_id = ${user.id}::uuid, trash_root_id = ${r.id}::uuid
           WHERE path <@ (SELECT path FROM pages WHERE id = ${r.id}::uuid) AND deleted_at IS NULL`;
      }
      await this.access.event(tx, a.data.page, 'database.rows.changed', user.id, {
        rowIds: visible.map((r) => r.id),
      });
      for (const r of visible)
        await tx.changeEvent.create({
          data: {
            workspaceId: r.workspaceId,
            type: 'page.trashed',
            entityId: r.id,
            actorId: user.id,
            audienceUserId: r.scope === 'PRIVATE' ? r.ownerId : null,
            payload: { parentId: r.parentId },
          },
        });
    });
    if (visible.length) this.collab.revalidate();
    return { trashed: visible.length };
  }

  // ---------------------------------------------------------------- Hilfen

  private async requireRow(
    user: AuthUser,
    dataId: string,
    rowId: string,
    opts: { includeTrashed?: boolean } = {},
  ): Promise<Page> {
    const row = await this.prisma.client.page.findUnique({ where: { id: rowId } });
    if (
      !row ||
      row.kind !== 'DATABASE_ROW' ||
      row.databaseId !== dataId ||
      !(row.scope === 'TEAM' || row.ownerId === user.id) ||
      (row.deletedAt && !opts.includeTrashed)
    )
      throw notFound('Zeile');
    return row;
  }

  /** Validiert Eingabewerte gegen die Properties. Unbekannte Properties sind ein Fehler. */
  private async validateValues(
    workspaceId: string,
    props: LoadedProperty[],
    input: Record<string, unknown>,
  ): Promise<Map<string, PropertyValue>> {
    const byId = new Map(props.map((p) => [p.id, p]));
    const out = new Map<string, PropertyValue>();
    const people: string[] = [];
    for (const [pid, raw] of Object.entries(input)) {
      const prop = byId.get(pid.toLowerCase());
      if (!prop)
        throw new AppError('validation_failed', 'Unbekanntes Property', { propertyId: pid });
      if (prop.type === 'title')
        throw new AppError('validation_failed', 'Titel über das Feld title setzen', {
          propertyId: pid,
        });
      if (isReadonlyType(prop.type))
        throw new AppError('validation_failed', 'Property ist schreibgeschützt', {
          propertyId: pid,
        });
      try {
        const v = validatePropertyValue(prop, raw);
        if (prop.type === 'person') people.push(...(v as string[]));
        out.set(prop.id, v);
      } catch (err) {
        if (err instanceof PropertyValueError)
          throw new AppError('validation_failed', err.message, { propertyId: pid });
        throw err;
      }
    }
    await this.access.assertMembers(workspaceId, [...new Set(people)]);
    return out;
  }

  private async writeValues(
    tx: Tx,
    dataId: string,
    rowId: string,
    props: LoadedProperty[],
    values: Map<string, PropertyValue>,
  ): Promise<void> {
    const byId = new Map(props.map((p) => [p.id, p]));
    for (const [pid, v] of values) {
      const cols = toStorage(byId.get(pid)!.type, v);
      if (!cols) {
        await tx.propertyValue.deleteMany({ where: { rowId, propertyId: pid } });
        continue;
      }
      const data = storedValueData(rowId, pid, dataId, cols);
      const { rowId: _r, propertyId: _p, databaseId: _d, ...update } = data;
      await tx.propertyValue.upsert({
        where: { rowId_propertyId: { rowId, propertyId: pid } },
        create: data,
        update,
      });
    }
  }

  /** Neue Zeile bekommt die nächste fortlaufende ID je Unique-ID-Property. */
  private async assignUniqueIds(tx: Tx, dataId: string, rowId: string, props: LoadedProperty[]) {
    for (const p of props.filter((x) => x.type === 'unique_id')) {
      const [locked] = await tx.$queryRaw<{ config: unknown }[]>`
        SELECT config FROM db_properties WHERE id = ${p.id}::uuid FOR UPDATE`;
      const cfg = parsePropertyConfig('unique_id', locked?.config ?? {}) as {
        prefix: string | null;
        nextValue: number;
      };
      await tx.propertyValue.create({
        data: { rowId, propertyId: p.id, databaseId: dataId, vNumber: cfg.nextValue },
      });
      await tx.dbProperty.update({
        where: { id: p.id },
        data: { config: { ...cfg, nextValue: cfg.nextValue + 1 } },
      });
    }
  }

  /**
   * Position einer Zeile, ohne alle Geschwister zu laden (Datenbanken können sehr groß sein).
   * Gleiche Sperre wie computePosition für Kinder derselben Seite.
   */
  private async rowPosition(
    tx: Tx,
    dataId: string,
    afterId?: string | null,
    beforeId?: string | null,
    excludeId?: string,
  ): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pages:${dataId}`}, 0))`;
    const exclude = excludeId ? Prisma.sql`AND id <> ${excludeId}::uuid` : Prisma.empty;
    const one = async (q: Prisma.Sql) =>
      (await tx.$queryRaw<{ position: string }[]>(q))[0]?.position ?? null;
    const last = () =>
      one(
        Prisma.sql`SELECT position FROM pages WHERE parent_id = ${dataId}::uuid ${exclude} ORDER BY position DESC LIMIT 1`,
      );
    let prev: string | null;
    let next: string | null = null;
    const anchorPos = async (id: string) => {
      const p = await one(
        Prisma.sql`SELECT position FROM pages WHERE id = ${id}::uuid AND parent_id = ${dataId}::uuid`,
      );
      if (p === null) throw new AppError('bad_request', 'Bezugszeile gehört nicht zur Datenbank');
      return p;
    };
    if (afterId) {
      prev = await anchorPos(afterId);
      next = await one(
        Prisma.sql`SELECT position FROM pages WHERE parent_id = ${dataId}::uuid AND position > ${prev} ${exclude} ORDER BY position LIMIT 1`,
      );
    } else if (beforeId) {
      next = await anchorPos(beforeId);
      prev = await one(
        Prisma.sql`SELECT position FROM pages WHERE parent_id = ${dataId}::uuid AND position < ${next} ${exclude} ORDER BY position DESC LIMIT 1`,
      );
    } else prev = await last();
    try {
      return keyBetween(prev, next);
    } catch {
      return keyBetween(await last(), null);
    }
  }

  private async toDtos(raw: RawRow[], props: LoadedProperty[]): Promise<RowDto[]> {
    const values = await this.loadValues(
      raw.map((r) => r.id),
      props,
    );
    return raw.map((r) => ({
      id: r.id,
      title: r.title,
      icon: r.icon,
      position: r.position,
      createdAt: r.created_at.toISOString(),
      createdById: r.created_by_id,
      lastEditedAt: r.last_edited_at.toISOString(),
      lastEditedById: r.last_edited_by_id,
      values: values.get(r.id) ?? {},
    }));
  }

  async pagesToDtos(pages: Page[], props: LoadedProperty[]): Promise<RowDto[]> {
    return this.toDtos(
      pages.map((p) => ({
        id: p.id,
        position: p.position,
        title: p.title,
        icon: (p.icon as PageIcon | null) ?? null,
        created_at: p.createdAt,
        created_by_id: p.createdById,
        last_edited_at: p.lastEditedAt,
        last_edited_by_id: p.lastEditedById,
      })),
      props,
    );
  }

  private async loadValues(ids: string[], props: LoadedProperty[]) {
    const out = new Map<string, Record<string, PropertyValue>>();
    if (!ids.length) return out;
    const byId = new Map(props.map((p) => [p.id, p]));
    const rows = await this.prisma.client.propertyValue.findMany({ where: { rowId: { in: ids } } });
    for (const v of rows) {
      const prop = byId.get(v.propertyId);
      if (!prop) continue;
      let rec = out.get(v.rowId);
      if (!rec) out.set(v.rowId, (rec = {}));
      rec[v.propertyId] = fromStorage(prop.type, v);
    }
    return out;
  }
}
