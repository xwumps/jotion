import { Prisma, type PrismaClient } from '@jotion/db';
import {
  evaluate,
  FormulaError,
  parse,
  type Node,
  type PageVal,
  type PersonVal,
  type Value,
} from '@jotion/formula';
import {
  parsePropertyConfig,
  type PropertyType,
  type ResultType,
  type RollupAggregation,
} from '@jotion/shared';
import { computeOrder, formulaRefs } from './config';
import { computedColumns, fromComputed, type ComputeProperty } from './convert';
import { aggregate } from './rollup';

type Db = PrismaClient | Prisma.TransactionClient;

export interface ComputeEngineOptions {
  /** Zeitzone für Datumsfunktionen in Formeln */
  timeZone: string;
  now?: () => number;
  /** Höchstens so viele Relationsebenen weiterreichen (Schutz vor Zyklen) */
  maxDepth?: number;
}

interface PageRow {
  id: string;
  title: string;
  database_id: string;
  created_at: Date;
  created_by_id: string;
  last_edited_at: Date;
  last_edited_by_id: string;
}
interface ValueRow {
  row_id: string;
  property_id: string;
  v_text: string | null;
  v_number: number | null;
  v_bool: boolean | null;
  v_date_start: Date | null;
  v_date_end: Date | null;
  v_date_has_time: boolean | null;
  v_option_ids: string[] | null;
  v_user_ids: string[] | null;
  v_json: unknown;
}
interface LinkRow {
  property_id: string;
  from_row_id: string;
  to_row_id: string;
  title: string;
}

const BATCH = 1000;

/**
 * Arrays als Text übergeben: Prisma typisiert ein Array nur aus null als int[], das ließe sich
 * nicht in timestamptz[] oder bool[] umwandeln.
 */
const str = (xs: (string | number | boolean | Date | null)[]): (string | null)[] =>
  xs.map((x) => (x === null ? null : x instanceof Date ? x.toISOString() : String(x)));

/** Daten mehrerer Zeilen: Seitenfelder, gespeicherte Werte, Verknüpfungen. */
class RowData {
  pages = new Map<string, PageRow>();
  values = new Map<string, Map<string, ValueRow>>();
  links = new Map<string, Map<string, PageVal[]>>();
}

/**
 * Berechnet Formeln und Rollups, speichert die Ergebnisse in property_values (gleiche Spalten
 * wie normale Werte, siehe ADR) und reicht Änderungen über Relationen an abhängige Zeilen weiter.
 */
export class ComputeEngine {
  private readonly propsCache = new Map<string, ComputeProperty[]>();
  private readonly astCache = new Map<string, Node | null>();
  private readonly users = new Map<string, PersonVal>();

  constructor(
    private readonly db: Db,
    private readonly opts: ComputeEngineOptions,
  ) {}

  async properties(databaseId: string): Promise<ComputeProperty[]> {
    let p = this.propsCache.get(databaseId);
    if (!p) {
      const rows = await this.db.$queryRaw<
        { id: string; name: string; type: PropertyType; config: unknown }[]
      >`
        SELECT id::text, name, type::text AS type, config FROM db_properties WHERE database_id = ${databaseId}::uuid ORDER BY position`;
      p = rows.map((r) => {
        let config: Record<string, unknown>;
        try {
          config = parsePropertyConfig(r.type, r.config) as Record<string, unknown>;
        } catch {
          config = (r.config ?? {}) as Record<string, unknown>;
        }
        return { id: r.id, name: r.name, type: r.type, config };
      });
      this.propsCache.set(databaseId, p);
    }
    return p;
  }

  /** Berechnet die Zeilen neu (ohne rowIds: alle). Liefert Zeilen, deren Ergebnisse sich änderten. */
  async recomputeRows(databaseId: string, rowIds?: string[]): Promise<string[]> {
    const props = await this.properties(databaseId);
    const order = computeOrder(props);
    if (!order.length) return [];
    const changed: string[] = [];
    if (rowIds) {
      for (let i = 0; i < rowIds.length; i += BATCH)
        changed.push(...(await this.batch(databaseId, props, order, rowIds.slice(i, i + BATCH))));
      return changed;
    }
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const ids = (
        await this.db.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM pages WHERE database_id = ${databaseId}::uuid AND kind = 'DATABASE_ROW'
             AND deleted_at IS NULL AND id > ${after}::uuid ORDER BY id LIMIT ${BATCH}`
      ).map((r) => r.id);
      if (!ids.length) break;
      changed.push(...(await this.batch(databaseId, props, order, ids)));
      after = ids.at(-1)!;
    }
    return changed;
  }

  /**
   * Zeilen, deren Berechnungen von diesen Zeilen abhängen: Sie zeigen per Relation auf eine der
   * Zeilen und haben ein Rollup über diese Relation oder eine Formel, die sie verwendet.
   */
  async dependents(rowIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, Set<string>>();
    if (!rowIds.length) return new Map();
    const rows = await this.db.$queryRaw<
      { property_id: string; from_row_id: string; database_id: string }[]
    >`
      SELECT DISTINCT l.property_id::text, l.from_row_id::text, fp.database_id::text
        FROM relation_links l JOIN pages fp ON fp.id = l.from_row_id AND fp.deleted_at IS NULL
       WHERE l.to_row_id = ANY(${rowIds}::uuid[])`;
    const relevant = new Map<string, boolean>();
    for (const r of rows) {
      const key = `${r.database_id}:${r.property_id}`;
      if (!relevant.has(key)) relevant.set(key, await this.dependsOn(r.database_id, r.property_id));
      if (!relevant.get(key)) continue;
      if (!out.has(r.database_id)) out.set(r.database_id, new Set());
      out.get(r.database_id)!.add(r.from_row_id);
    }
    return new Map([...out].map(([k, v]) => [k, [...v]]));
  }

  private async dependsOn(databaseId: string, relationPropertyId: string): Promise<boolean> {
    const props = await this.properties(databaseId);
    return props.some(
      (p) =>
        (p.type === 'rollup' && p.config.relationPropertyId === relationPropertyId) ||
        (p.type === 'formula' && formulaRefs(p, props).includes(relationPropertyId)),
    );
  }

  /**
   * Berechnet die Zeilen neu und reicht Änderungen ebenenweise an abhängige Zeilen weiter.
   * includeSeed false: nur die Abhängigen (die Zeilen selbst sind schon berechnet).
   * Liefert je Datenbank die Zeilen, deren Ergebnisse sich änderten.
   */
  async propagate(
    databaseId: string,
    rowIds: string[],
    opts: { includeSeed?: boolean; extraRows?: Map<string, string[]> } = {},
  ): Promise<Map<string, Set<string>>> {
    const touched = new Map<string, Set<string>>();
    const mark = (db: string, ids: string[]) => {
      if (!ids.length) return;
      if (!touched.has(db)) touched.set(db, new Set());
      ids.forEach((id) => touched.get(db)!.add(id));
    };
    if (opts.includeSeed !== false) mark(databaseId, await this.recomputeRows(databaseId, rowIds));
    // Zusätzlich direkt betroffene Zeilen (z. B. Ziele einer geänderten Relation)
    let frontier = [...rowIds];
    for (const [db, ids] of opts.extraRows ?? []) {
      const ch = await this.recomputeRows(db, ids);
      mark(db, ch);
      frontier.push(...ids);
    }
    const maxDepth = this.opts.maxDepth ?? 5;
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const deps = await this.dependents(frontier);
      const next: string[] = [];
      for (const [db, ids] of deps) {
        const ch = await this.recomputeRows(db, ids);
        mark(db, ch);
        next.push(...ch);
      }
      frontier = [...new Set(next)];
    }
    return touched;
  }

  /** Echtzeit-Ereignis "Zeilen geändert" je Datenbank (über die Outbox der API). */
  async emitRowsChanged(
    touched: Map<string, Set<string>>,
    actorId: string | null = null,
  ): Promise<void> {
    for (const [databaseId, rows] of touched) {
      if (!rows.size) continue;
      await this.db.$executeRaw`
        INSERT INTO change_events (workspace_id, type, entity_id, actor_id, audience_user_id, payload)
        SELECT workspace_id, 'database.rows.changed', id, ${actorId}::uuid,
               CASE WHEN scope = 'PRIVATE' THEN owner_id ELSE NULL END,
               ${JSON.stringify({ rowIds: [...rows].slice(0, 200), computed: true })}::jsonb
          FROM pages WHERE id = ${databaseId}::uuid`;
    }
  }

  // ---------------------------------------------------------------- Laden

  private async load(rowIds: string[], data = new RowData()): Promise<RowData> {
    const ids = rowIds.filter((id) => !data.pages.has(id));
    if (!ids.length) return data;
    const [pages, values, links] = await Promise.all([
      this.db.$queryRaw<PageRow[]>`
        SELECT id::text, title, database_id::text, created_at, created_by_id::text, last_edited_at, last_edited_by_id::text
          FROM pages WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL`,
      this.db.$queryRaw<ValueRow[]>`
        SELECT row_id::text, property_id::text, v_text, v_number, v_bool, v_date_start, v_date_end,
               v_date_has_time, v_option_ids::text[] AS v_option_ids, v_user_ids::text[] AS v_user_ids, v_json
          FROM property_values WHERE row_id = ANY(${ids}::uuid[])`,
      this.db.$queryRaw<LinkRow[]>`
        SELECT l.property_id::text, l.from_row_id::text, l.to_row_id::text, tp.title
          FROM relation_links l JOIN pages tp ON tp.id = l.to_row_id AND tp.deleted_at IS NULL
         WHERE l.from_row_id = ANY(${ids}::uuid[]) ORDER BY l.position, l.to_row_id`,
    ]);
    for (const p of pages) data.pages.set(p.id, p);
    for (const v of values) {
      if (!data.values.has(v.row_id)) data.values.set(v.row_id, new Map());
      data.values.get(v.row_id)!.set(v.property_id, v);
    }
    for (const l of links) {
      if (!data.links.has(l.from_row_id)) data.links.set(l.from_row_id, new Map());
      const m = data.links.get(l.from_row_id)!;
      if (!m.has(l.property_id)) m.set(l.property_id, []);
      m.get(l.property_id)!.push({ kind: 'page', id: l.to_row_id, title: l.title });
    }
    // Personen für Namen und E-Mail
    const userIds = new Set<string>();
    for (const p of pages) [p.created_by_id, p.last_edited_by_id].forEach((u) => userIds.add(u));
    for (const v of values) (v.v_user_ids ?? []).forEach((u) => userIds.add(u));
    await this.loadUsers([...userIds]);
    return data;
  }

  private async loadUsers(ids: string[]) {
    const missing = ids.filter((id) => !this.users.has(id));
    if (!missing.length) return;
    const rows = await this.db.$queryRaw<{ id: string; name: string; email: string }[]>`
      SELECT id::text, name, email FROM users WHERE id = ANY(${missing}::uuid[])`;
    for (const u of rows)
      this.users.set(u.id, { kind: 'person', id: u.id, name: u.name, email: u.email });
  }

  private person(id: string): PersonVal {
    return this.users.get(id) ?? { kind: 'person', id, name: '?', email: '' };
  }

  /** Wert eines Properties einer geladenen Zeile als Formelwert. */
  private valueOf(p: ComputeProperty, rowId: string, data: RowData): Value {
    const page = data.pages.get(rowId);
    if (!page) return null;
    const v = data.values.get(rowId)?.get(p.id);
    switch (p.type) {
      case 'title':
        return page.title;
      case 'created_time':
        return { kind: 'date', start: page.created_at.getTime(), end: null, hasTime: true };
      case 'last_edited_time':
        return { kind: 'date', start: page.last_edited_at.getTime(), end: null, hasTime: true };
      case 'created_by':
        return this.person(page.created_by_id);
      case 'last_edited_by':
        return this.person(page.last_edited_by_id);
      case 'relation':
        return data.links.get(rowId)?.get(p.id) ?? [];
    }
    if (!v)
      return p.type === 'checkbox'
        ? false
        : ['multi_select', 'person', 'files'].includes(p.type)
          ? []
          : null;
    switch (p.type) {
      case 'text':
      case 'url':
      case 'email':
      case 'phone':
        return v.v_text;
      case 'number':
      case 'unique_id':
        return v.v_number;
      case 'checkbox':
        return v.v_bool === true;
      case 'select':
      case 'status':
      case 'multi_select': {
        const opts = (p.config.options as { id: string; name: string }[] | undefined) ?? [];
        const names = (v.v_option_ids ?? []).map((id) => opts.find((o) => o.id === id)?.name ?? '');
        return p.type === 'multi_select' ? names.filter(Boolean) : (names[0] ?? null) || null;
      }
      case 'person':
        return (v.v_user_ids ?? []).map((u) => this.person(u));
      case 'date':
        if (!v.v_date_start) return null;
        return {
          kind: 'date',
          start: v.v_date_start.getTime(),
          end: v.v_date_end ? v.v_date_end.getTime() : null,
          hasTime: Boolean(v.v_date_has_time),
        };
      case 'files':
        return Array.isArray(v.v_json) ? (v.v_json as { name: string }[]).map((f) => f.name) : [];
      case 'formula':
      case 'rollup':
        return fromComputed(v.v_json as never);
      default:
        return null;
    }
  }

  private ast(p: ComputeProperty): Node | null {
    const key = `${p.id}:${String(p.config.expression ?? '')}`;
    if (!this.astCache.has(key)) {
      let node: Node | null = null;
      if (!p.config.error) {
        try {
          node = parse(String(p.config.expression ?? ''));
        } catch {
          node = null;
        }
      }
      this.astCache.set(key, node);
    }
    return this.astCache.get(key)!;
  }

  /**
   * Phase 9: Formelausdruck für eine Zeile auswerten (Automatisierungen). Ohne Zeile stehen nur
   * now()/today() und Konstanten zur Verfügung. Wirft FormulaError bei Syntax- oder Typfehlern.
   */
  async evaluateFor(
    databaseId: string | null,
    rowId: string | null,
    expression: string,
  ): Promise<Value> {
    const node = parse(expression);
    const now = this.opts.now?.() ?? Date.now();
    if (!databaseId || !rowId)
      return evaluate(node, { props: {}, pageProp: () => null, now, timeZone: this.opts.timeZone });
    const props = await this.properties(databaseId);
    const data = await this.load([rowId]);
    const page = data.pages.get(rowId);
    const scope: Record<string, Value> = {};
    for (const p of props) scope[p.name] = this.valueOf(p, rowId, data);
    const related = new RowData();
    const linked = new Set<string>();
    for (const r of props.filter((p) => p.type === 'relation'))
      for (const pg of data.links.get(rowId)?.get(r.id) ?? []) linked.add(pg.id);
    if (linked.size) await this.load([...linked], related);
    const propsOf = new Map<string, ComputeProperty[]>();
    for (const pg of related.pages.values())
      if (!propsOf.has(pg.database_id))
        propsOf.set(pg.database_id, await this.properties(pg.database_id));
    return evaluate(node, {
      props: scope,
      pageProp: (pv: PageVal, name: string) => {
        const row = related.pages.get(pv.id);
        const p = row ? propsOf.get(row.database_id)?.find((x) => x.name === name) : undefined;
        return p ? this.valueOf(p, pv.id, related) : null;
      },
      self: page ? { kind: 'page', id: rowId, title: page.title } : undefined,
      now,
      timeZone: this.opts.timeZone,
    });
  }

  // ---------------------------------------------------------------- Berechnen

  private async batch(
    databaseId: string,
    props: ComputeProperty[],
    order: ComputeProperty[],
    rowIds: string[],
  ): Promise<string[]> {
    const data = await this.load(rowIds);
    const byId = new Map(props.map((p) => [p.id, p]));

    // Verknüpfte Zeilen laden, die Rollups und Formeln brauchen (eine Ebene)
    const relationProps = props.filter((p) => p.type === 'relation');
    const related = new RowData();
    const linkedIds = new Set<string>();
    for (const r of relationProps)
      for (const id of rowIds)
        for (const pg of data.links.get(id)?.get(r.id) ?? []) linkedIds.add(pg.id);
    if (linkedIds.size) await this.load([...linkedIds], related);
    const relatedProps = new Map<string, ComputeProperty[]>();
    for (const pg of related.pages.values())
      if (!relatedProps.has(pg.database_id))
        relatedProps.set(pg.database_id, await this.properties(pg.database_id));

    const relatedByName = (page: PageVal, name: string): Value => {
      const row = related.pages.get(page.id);
      if (!row) return null;
      const p = relatedProps.get(row.database_id)?.find((x) => x.name === name);
      return p ? this.valueOf(p, page.id, related) : null;
    };

    const now = this.opts.now?.() ?? Date.now();
    const writes: { rowId: string; propertyId: string; resultType: ResultType; value: Value }[] =
      [];
    const changed = new Set<string>();

    for (const rowId of rowIds) {
      const page = data.pages.get(rowId);
      if (!page || page.database_id !== databaseId) continue;
      const scope: Record<string, Value> = {};
      for (const p of props)
        if (p.type !== 'formula' && p.type !== 'rollup')
          scope[p.name] = this.valueOf(p, rowId, data);
      // Gespeicherte Ergebnisse als Ausgangswert (für Formeln, die in Zyklen ausgelassen werden)
      for (const p of props)
        if (p.type === 'formula' || p.type === 'rollup')
          scope[p.name] = this.valueOf(p, rowId, data);

      for (const p of order) {
        let value: Value = null;
        if (p.type === 'rollup') {
          const rel = byId.get(String(p.config.relationPropertyId));
          const pages = rel ? (data.links.get(rowId)?.get(rel.id) ?? []) : [];
          const targetDb = rel ? String(rel.config.targetDatabaseId) : '';
          const target = (
            relatedProps.get(targetDb) ?? (targetDb ? await this.properties(targetDb) : [])
          ).find((x) => x.id === p.config.targetPropertyId);
          const perRow = target
            ? pages.map((pg) =>
                related.pages.has(pg.id) ? this.valueOf(target, pg.id, related) : null,
              )
            : [];
          value = target ? aggregate(p.config.aggregation as RollupAggregation, perRow) : null;
        } else {
          const node = this.ast(p);
          if (node) {
            try {
              value = evaluate(node, {
                props: scope,
                pageProp: relatedByName,
                self: { kind: 'page', id: rowId, title: page.title },
                now,
                timeZone: this.opts.timeZone,
              });
            } catch (err) {
              if (!(err instanceof FormulaError)) throw err;
              value = null;
            }
          }
        }
        scope[p.name] = value;
        const resultType = (p.config.resultType as ResultType | undefined) ?? 'empty';
        const before = data.values.get(rowId)?.get(p.id)?.v_json ?? null;
        const cols = computedColumns(resultType, value, this.opts.timeZone);
        const after = cols ? cols.v_json : null;
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          writes.push({ rowId, propertyId: p.id, resultType, value });
          changed.add(rowId);
        }
      }
    }
    await this.write(databaseId, writes);
    return [...changed];
  }

  private async write(
    databaseId: string,
    writes: { rowId: string; propertyId: string; resultType: ResultType; value: Value }[],
  ): Promise<void> {
    if (!writes.length) return;
    const del: { r: string; p: string }[] = [];
    const up = {
      r: [] as string[],
      p: [] as string[],
      t: [] as (string | null)[],
      n: [] as (number | null)[],
      b: [] as (boolean | null)[],
      ds: [] as (Date | null)[],
      de: [] as (Date | null)[],
      dh: [] as (boolean | null)[],
      j: [] as string[],
    };
    for (const w of writes) {
      const c = computedColumns(w.resultType, w.value, this.opts.timeZone);
      if (!c) {
        del.push({ r: w.rowId, p: w.propertyId });
        continue;
      }
      up.r.push(w.rowId);
      up.p.push(w.propertyId);
      up.t.push(c.v_text);
      up.n.push(c.v_number);
      up.b.push(c.v_bool);
      up.ds.push(c.v_date_start);
      up.de.push(c.v_date_end);
      up.dh.push(c.v_date_has_time);
      up.j.push(JSON.stringify(c.v_json));
    }
    if (up.r.length)
      await this.db.$executeRaw`
        INSERT INTO property_values (row_id, property_id, database_id, v_text, v_number, v_bool,
                                     v_date_start, v_date_end, v_date_has_time, v_json, updated_at)
        SELECT u.r, u.p, ${databaseId}::uuid, u.t, u.n, u.b, u.ds, u.de, u.dh, u.j::jsonb, now()
          FROM unnest(${up.r}::text[]::uuid[], ${up.p}::text[]::uuid[], ${up.t}::text[],
                      ${str(up.n)}::text[]::float8[], ${str(up.b)}::text[]::bool[],
                      ${str(up.ds)}::text[]::timestamptz[], ${str(up.de)}::text[]::timestamptz[],
                      ${str(up.dh)}::text[]::bool[], ${up.j}::text[])
               AS u(r, p, t, n, b, ds, de, dh, j)
          JOIN pages pg ON pg.id = u.r AND pg.deleted_at IS NULL
        ON CONFLICT (row_id, property_id) DO UPDATE SET
          v_text = EXCLUDED.v_text, v_number = EXCLUDED.v_number, v_bool = EXCLUDED.v_bool,
          v_date_start = EXCLUDED.v_date_start, v_date_end = EXCLUDED.v_date_end,
          v_date_has_time = EXCLUDED.v_date_has_time, v_json = EXCLUDED.v_json, updated_at = now()`;
    if (del.length)
      await this.db.$executeRaw`
        DELETE FROM property_values v USING unnest(${del.map((d) => d.r)}::text[]::uuid[], ${del.map((d) => d.p)}::text[]::uuid[]) AS x(r, p)
         WHERE v.row_id = x.r AND v.property_id = x.p`;
  }
}

export { Prisma };
