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
  type GroupsResultDto,
  type groupsQuerySchema,
  type createRowSchema,
  type moveRowSchema,
  type PageCover,
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
  compileGroupCountQuery,
  compileRowQuery,
  CursorMismatchError,
  encodeCursor,
  fromStorage,
  GroupMoveError,
  groupSpec,
  safeTimeZone,
  toStorage,
  valueForGroupMove,
  type GroupSpec,
  type QueryContext,
  type RowRecord,
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
  cover?: PageCover | null;
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
      groups: this.groupFilters(cfg, props, input.group, input.subGroup),
      dateRange: input.dateRange ? this.dateRange(props, input.dateRange) : undefined,
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
    if (input.preview) await this.attachPreviews(rows);
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
    const requests = Object.entries(input.calculations ?? cfg.calculations)
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
        groups: this.groupFilters(cfg, props, input.group, input.subGroup),
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

  /** Anzahl Zeilen je Gruppe (und Untergruppe) der Ansicht nach Filter und Suche. */
  async groups(
    user: AuthUser,
    databaseId: string,
    input: z.output<typeof groupsQuerySchema>,
  ): Promise<GroupsResultDto> {
    const a = await this.access.require(user.id, databaseId, { includeTrashed: true });
    const cfg = (await this.viewConfig(databaseId, input.viewId))!;
    if (!a.data) return { counts: [], total: 0 };
    const props = await this.access.properties(a.data.db.id);
    const g = cfg.groupBy ? groupSpec(cfg.groupBy, props) : null;
    if (!g) throw new AppError('bad_request', 'Ansicht ist nicht gruppiert');
    const sub = cfg.subGroupBy ? groupSpec(cfg.subGroupBy, props) : null;
    const ctx: QueryContext = {
      databaseId: a.data.db.id,
      viewerId: user.id,
      properties: props,
      filter: cfg.filter,
      search: input.search,
      timeZone: input.timeZone,
    };
    const q = compileGroupCountQuery(ctx, g, sub);
    const count = compileCountQuery(ctx);
    const [rows, totals] = await Promise.all([
      this.prisma.client.$queryRawUnsafe<{ key: string; sub_key: string | null; count: number }[]>(
        q.sql,
        ...q.parameters,
      ),
      this.prisma.client.$queryRawUnsafe<{ total: number }[]>(count.sql, ...count.parameters),
    ]);
    return {
      counts: rows.map((r) => ({ key: r.key, subKey: r.sub_key, count: r.count })),
      total: totals[0]?.total ?? 0,
    };
  }

  /** Gruppe und Untergruppe der Ansicht als Filter für die Zeilenabfrage. */
  private groupFilters(
    cfg: ViewConfig | null,
    props: LoadedProperty[],
    group?: string,
    subGroup?: string,
  ): QueryContext['groups'] {
    const out: NonNullable<QueryContext['groups']> = [];
    const add = (by: ViewConfig['groupBy'], key?: string) => {
      if (key === undefined) return;
      const spec = by ? groupSpec(by, props) : null;
      if (!spec) throw new AppError('bad_request', 'Ansicht ist nicht gruppiert');
      out.push({ spec, key });
    };
    add(cfg?.groupBy ?? null, group);
    add(cfg?.subGroupBy ?? null, subGroup);
    return out;
  }

  private dateRange(
    props: LoadedProperty[],
    r: NonNullable<z.output<typeof queryRowsSchema>['dateRange']>,
  ): QueryContext['dateRange'] {
    const isDate = (p?: LoadedProperty) =>
      p && ['date', 'created_time', 'last_edited_time'].includes(p.type);
    const start = props.find((p) => p.id === r.startPropertyId);
    const end = r.endPropertyId ? props.find((p) => p.id === r.endPropertyId) : undefined;
    if (!isDate(start) || (r.endPropertyId && !isDate(end)))
      throw new AppError('bad_request', 'Kein Datums-Property');
    return { start: start!, end: end ?? null, from: r.from, to: r.to };
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
    const placement = input.afterId !== undefined || input.beforeId !== undefined;
    const moved = await this.prisma.client.$transaction(async (tx) => {
      // Gruppenwechsel und Position atomar: Zeile sperren, aktuellen Wert lesen, neu setzen
      let title: string | undefined;
      if (input.groups?.length) {
        await tx.$queryRaw`SELECT id FROM pages WHERE id = ${row.id}::uuid FOR UPDATE`;
        const current = await tx.page.findUniqueOrThrow({ where: { id: row.id } });
        const [dto] = await this.pagesToDtos([current], props);
        const record: RowRecord = { ...dto!, createdAt: dto!.createdAt, values: dto!.values };
        const raw: Record<string, unknown> = {};
        for (const g of input.groups) {
          const prop = props.find((p) => p.id === g.propertyId);
          if (!prop) throw new AppError('validation_failed', 'Unbekanntes Property');
          const spec: GroupSpec = { prop, dateBucket: 'day', numberInterval: 1 };
          let res;
          try {
            res = valueForGroupMove(record, spec, g.from, g.to, safeTimeZone(input.timeZone));
          } catch (err) {
            if (err instanceof GroupMoveError) throw new AppError('bad_request', err.message);
            throw err;
          }
          if (res.kind === 'title') title = res.value.replace(/\s+/g, ' ').trim();
          else if (res.kind === 'value') {
            raw[prop.id] = res.value;
            // Folgewechsel (Untergruppe) sieht den neuen Wert
            record.values = { ...record.values, [prop.id]: res.value as never };
          }
        }
        const values = await this.validateValues(a.data.page.workspaceId, props, raw);
        await this.writeValues(tx, a.data.db.id, row.id, props, values);
      }
      const position = placement
        ? await this.rowPosition(tx, a.data.db.id, input.afterId, input.beforeId, row.id)
        : undefined;
      const changed = !!input.groups?.length;
      const u = await tx.page.update({
        where: { id: row.id },
        data: {
          ...(position !== undefined ? { position } : {}),
          ...(title !== undefined ? { title } : {}),
          ...(changed ? { lastEditedAt: new Date(), lastEditedById: user.id } : {}),
        },
      });
      await this.access.event(tx, a.data.page, 'database.rows.changed', user.id, {
        rowIds: [row.id],
      });
      if (title !== undefined) {
        await this.access.event(tx, a.data.page, 'database.changed', user.id, {});
        await tx.changeEvent.create({
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
    const files: string[] = [];
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
        if (prop.type === 'files')
          for (const f of v as { type: string; fileId?: string }[])
            if (f.type === 'file' && f.fileId) files.push(f.fileId);
        out.set(prop.id, v);
      } catch (err) {
        if (err instanceof PropertyValueError)
          throw new AppError('validation_failed', err.message, { propertyId: pid });
        throw err;
      }
    }
    await this.access.assertMembers(workspaceId, [...new Set(people)]);
    // Hochgeladene Dateien müssen zum selben Workspace gehören
    const fileIds = [...new Set(files)];
    if (fileIds.length) {
      const n = await this.prisma.client.file.count({
        where: { id: { in: fileIds }, workspaceId },
      });
      if (n !== fileIds.length)
        throw new AppError('validation_failed', 'Datei gehört nicht zu diesem Workspace');
    }
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
      cover: r.cover ?? null,
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
        cover: (p.cover as PageCover | null) ?? null,
        created_at: p.createdAt,
        created_by_id: p.createdById,
        last_edited_at: p.lastEditedAt,
        last_edited_by_id: p.lastEditedById,
      })),
      props,
    );
  }

  /** Erstes Bild und die ersten Textzeilen jeder Zeilenseite (aus der Block-Projektion). */
  private async attachPreviews(rows: RowDto[]): Promise<void> {
    if (!rows.length) return;
    const ids = rows.map((r) => r.id);
    const [images, texts] = await Promise.all([
      this.prisma.client.$queryRaw<{ page_id: string; src: string }[]>`
        SELECT DISTINCT ON (page_id) page_id::text, props->>'src' AS src FROM blocks
         WHERE page_id = ANY(${ids}::uuid[]) AND type = 'image' AND props ? 'src'
         ORDER BY page_id, position`,
      this.prisma.client.$queryRaw<{ page_id: string; text: string }[]>`
        SELECT page_id::text, left(string_agg(plain_text, ' ' ORDER BY position), 300) AS text
          FROM (SELECT page_id, plain_text, position,
                       row_number() OVER (PARTITION BY page_id ORDER BY position) AS n
                  FROM blocks
                 WHERE page_id = ANY(${ids}::uuid[]) AND plain_text <> ''
                   AND type NOT IN ('subpage', 'database')) b
         WHERE n <= 4
         GROUP BY page_id`,
    ]);
    const img = new Map(images.map((i) => [i.page_id, i.src]));
    const txt = new Map(texts.map((t) => [t.page_id, t.text]));
    for (const r of rows) {
      const src = img.get(r.id) ?? null;
      // Nur eigene Dateien oder https-Bilder, keine data:- oder javascript:-URLs
      const safe = src && (/^\/api\/files\//.test(src) || /^https:\/\//i.test(src)) ? src : null;
      r.preview = { image: safe, text: txt.get(r.id) ?? '' };
    }
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
