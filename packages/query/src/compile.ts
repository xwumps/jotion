import type { CalculationFn, PropertyType } from '@jotion/shared';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
  type CompiledQuery,
  type RawBuilder,
} from 'kysely';
import { decodeCursor, type CursorKey, type DecodedCursor } from './cursor';
import { safeTimeZone } from './dates';
import { EMPTY_GROUP } from '@jotion/shared';
import type { GroupSpec } from './grouping';
import {
  normalizeFilter,
  normalizeSorts,
  type ResolvedCondition,
  type ResolvedGroup,
  type ResolvedSort,
} from './normalize';
import type { QueryContext, QueryProperty } from './types';

/**
 * Query-Compiler: Filter-/Sortier-AST nach SQL über pages + property_values.
 * Ausschließlich parametrisiert: Werte aus Nutzereingaben gehen nur als Parameter ($n) in die
 * Abfrage. sql.raw wird nur für feste Fragmente und intern erzeugte Aliase (pv0, pv1, ...) genutzt.
 * Kysely dient als Query-Builder ohne eigene Verbindung; ausgeführt wird über Prisma.
 */

// Kysely ohne Treiber: nur zum Kompilieren nach PostgreSQL-SQL mit Parametern
const kysely = new Kysely<Record<string, never>>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

type Sql = RawBuilder<unknown>;

const PAGE_DERIVED: PropertyType[] = [
  'title',
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
];
const TEXT_TYPES: PropertyType[] = ['title', 'text', 'url', 'email', 'phone'];
const ARRAY_TYPES: PropertyType[] = ['multi_select', 'person', 'relation'];

/** Verknüpfte, nicht gelöschte Zeilen einer Relation als uuid[] (NULL ohne Verknüpfung). */
const relationIds = (prop: QueryProperty) =>
  sql`(SELECT array_agg(l.to_row_id ORDER BY l.position) FROM relation_links l JOIN pages tp ON tp.id = l.to_row_id AND tp.deleted_at IS NULL WHERE l.property_id = ${prop.id}::uuid AND l.from_row_id = p.id)`;

/** Ordnet jedem benötigten Property einen LEFT JOIN auf property_values zu. */
class Joins {
  private readonly aliases = new Map<string, string>();

  alias(prop: QueryProperty): Sql {
    let a = this.aliases.get(prop.id);
    if (!a) {
      a = `pv${this.aliases.size}`;
      this.aliases.set(prop.id, a);
    }
    return sql.raw(a);
  }

  col(prop: QueryProperty, column: string): Sql {
    return sql`${this.alias(prop)}.${sql.raw(column)}`;
  }

  sql(): Sql {
    if (this.aliases.size === 0) return sql``;
    return sql.join(
      [...this.aliases.entries()].map(
        ([propertyId, a]) =>
          sql`LEFT JOIN property_values ${sql.raw(a)} ON ${sql.raw(a)}.row_id = p.id AND ${sql.raw(a)}.property_id = ${propertyId}::uuid`,
      ),
      sql` `,
    );
  }
}

/** Skalarer Wert eines Properties (Text, Zahl, erste Option, Zeitpunkt ...). */
function scalarValue(prop: QueryProperty, j: Joins): Sql {
  switch (prop.type) {
    case 'title':
      return sql`NULLIF(p.title, '')`;
    case 'created_time':
      return sql`p.created_at`;
    case 'last_edited_time':
      return sql`p.last_edited_at`;
    case 'created_by':
      return sql`p.created_by_id`;
    case 'last_edited_by':
      return sql`p.last_edited_by_id`;
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return j.col(prop, 'v_text');
    case 'number':
    case 'unique_id':
      return j.col(prop, 'v_number');
    case 'select':
    case 'status':
      return sql`${j.col(prop, 'v_option_ids')}[1]`;
    case 'multi_select':
      return j.col(prop, 'v_option_ids');
    case 'person':
      return j.col(prop, 'v_user_ids');
    case 'checkbox':
      return sql`COALESCE(${j.col(prop, 'v_bool')}, false)`;
    case 'date':
      return j.col(prop, 'v_date_start');
    case 'files':
      return j.col(prop, 'v_json');
    case 'relation':
      return relationIds(prop);
    default:
      return sql`NULL`;
  }
}

/** Kalendertag eines Datums: mit Uhrzeit in der Zeitzone des Betrachters, sonst UTC. */
function dayExpr(prop: QueryProperty, j: Joins, tz: string): Sql {
  if (prop.type === 'created_time') return sql`(timezone(${tz}::text, p.created_at))::date`;
  if (prop.type === 'last_edited_time') return sql`(timezone(${tz}::text, p.last_edited_at))::date`;
  const start = j.col(prop, 'v_date_start');
  return sql`(CASE WHEN ${j.col(prop, 'v_date_has_time')} THEN timezone(${tz}::text, ${start}) ELSE timezone('UTC', ${start}) END)::date`;
}

/** Kalendertag eines Zeitstempels (mit Uhrzeit in tz, sonst UTC). */
function dayOfTs(ts: Sql, hasTime: Sql, tz: string): Sql {
  return sql`(CASE WHEN ${hasTime} THEN timezone(${tz}::text, ${ts}) ELSE timezone('UTC', ${ts}) END)::date`;
}

const ymd = (d: Sql) => sql`to_char(${d}, 'YYYY-MM-DD')`;

/** Gruppenschlüssel einer Zeile als text[] (leer = EMPTY_GROUP), siehe grouping.ts. */
function groupKeysSql(g: GroupSpec, j: Joins, tz: string): Sql {
  const prop = g.prop;
  const one = (x: Sql) => sql`ARRAY[COALESCE((${x})::text, ${EMPTY_GROUP}::text)]`;
  switch (prop.type) {
    case 'multi_select':
    case 'person': {
      const arr = scalarValue(prop, j);
      return sql`(CASE WHEN cardinality(${arr}) > 0 THEN ${arr}::text[] ELSE ARRAY[${EMPTY_GROUP}::text] END)`;
    }
    case 'checkbox':
      return sql`ARRAY[(${scalarValue(prop, j)})::text]`;
    case 'number':
    case 'unique_id': {
      // Winzige Beträge als 0 (sonst Unterlauf bei der Division), wie numberKey
      const raw = scalarValue(prop, j);
      const v = sql`(CASE WHEN abs(${raw}) < 1e-300 THEN 0::float8 ELSE ${raw} END)`;
      const iv = sql`${g.numberInterval}::float8`;
      // + 0.0 macht aus -0 eine 0 (wie numberKey)
      return one(sql`(floor(${v} / ${iv}) * ${iv} + 0.0::float8)`);
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const d = dayExpr(prop, j, tz);
      switch (g.dateBucket) {
        case 'day':
          return one(ymd(d));
        case 'week':
          return one(ymd(sql`(${d} - (extract(isodow from ${d})::int - 1))`));
        case 'month':
          return one(ymd(sql`date_trunc('month', ${d})`));
        case 'year':
          return one(ymd(sql`date_trunc('year', ${d})`));
      }
      break;
    }
    default:
      return one(scalarValue(prop, j));
  }
  return one(sql`NULL`);
}

/** Datumsbereich einer Zeile berührt [from, to] (Kalendertage). */
function dateRangeSql(r: NonNullable<QueryContext['dateRange']>, j: Joins, tz: string): Sql {
  const start = dayExpr(r.start, j, tz);
  let end: Sql;
  if (r.end && r.end.id !== r.start.id) {
    end = r.end.type === 'date' ? dayExpr(r.end, j, tz) : start;
  } else if (r.start.type === 'date') {
    end = dayOfTs(j.col(r.start, 'v_date_end'), j.col(r.start, 'v_date_has_time'), tz);
  } else end = start;
  return sql`(${start} IS NOT NULL AND ${start} <= ${r.to}::date AND COALESCE(GREATEST(${end}, ${start}), ${start}) >= ${r.from}::date)`;
}

/** LIKE-Muster mit maskierten Sonderzeichen (\ % _). */
export function likePattern(v: string, mode: 'contains' | 'starts' | 'ends'): string {
  const esc = v.replace(/[\\%_]/g, (m) => `\\${m}`);
  return mode === 'contains' ? `%${esc}%` : mode === 'starts' ? `${esc}%` : `%${esc}`;
}

const ANY_UUID = (v: string, arr: Sql) => sql`(${v}::uuid = ANY(COALESCE(${arr}, '{}'::uuid[])))`;

function conditionSql(c: ResolvedCondition, j: Joins, tz: string): Sql {
  const { prop, operator: op } = c;
  const t = prop.type;
  const v = c.value;

  if (TEXT_TYPES.includes(t)) {
    const x = scalarValue(prop, j);
    const s = String(v ?? '');
    switch (op) {
      case 'is_empty':
        return sql`(${x} IS NULL)`;
      case 'is_not_empty':
        return sql`(${x} IS NOT NULL)`;
      case 'equals':
        return sql`(${x} IS NOT NULL AND lower(${x}) = lower(${s}::text))`;
      case 'does_not_equal':
        return sql`(${x} IS NULL OR lower(${x}) <> lower(${s}::text))`;
      case 'contains':
        return sql`(${x} IS NOT NULL AND ${x} ILIKE ${likePattern(s, 'contains')}::text)`;
      case 'does_not_contain':
        return sql`(${x} IS NULL OR ${x} NOT ILIKE ${likePattern(s, 'contains')}::text)`;
      case 'starts_with':
        return sql`(${x} IS NOT NULL AND ${x} ILIKE ${likePattern(s, 'starts')}::text)`;
      case 'ends_with':
        return sql`(${x} IS NOT NULL AND ${x} ILIKE ${likePattern(s, 'ends')}::text)`;
    }
  }

  if (t === 'number' || t === 'unique_id') {
    const x = scalarValue(prop, j);
    const n = Number(v);
    switch (op) {
      case 'is_empty':
        return sql`(${x} IS NULL)`;
      case 'is_not_empty':
        return sql`(${x} IS NOT NULL)`;
      case 'equals':
        return sql`(${x} IS NOT NULL AND ${x} = ${n}::float8)`;
      case 'does_not_equal':
        return sql`(${x} IS NULL OR ${x} <> ${n}::float8)`;
      case 'greater_than':
        return sql`(${x} IS NOT NULL AND ${x} > ${n}::float8)`;
      case 'less_than':
        return sql`(${x} IS NOT NULL AND ${x} < ${n}::float8)`;
      case 'greater_than_or_equal_to':
        return sql`(${x} IS NOT NULL AND ${x} >= ${n}::float8)`;
      case 'less_than_or_equal_to':
        return sql`(${x} IS NOT NULL AND ${x} <= ${n}::float8)`;
    }
  }

  if (t === 'select' || t === 'status' || t === 'multi_select' || t === 'person') {
    const arr = j.col(prop, t === 'person' ? 'v_user_ids' : 'v_option_ids');
    const s = String(v ?? '');
    switch (op) {
      case 'is_empty':
        return sql`(COALESCE(cardinality(${arr}), 0) = 0)`;
      case 'is_not_empty':
        return sql`(COALESCE(cardinality(${arr}), 0) > 0)`;
      case 'is':
      case 'contains':
        return ANY_UUID(s, arr);
      case 'is_not':
      case 'does_not_contain':
        return sql`(NOT ${ANY_UUID(s, arr)})`;
    }
  }

  if (t === 'relation') {
    const arr = relationIds(prop);
    switch (op) {
      case 'is_empty':
        return sql`(COALESCE(cardinality(${arr}), 0) = 0)`;
      case 'is_not_empty':
        return sql`(COALESCE(cardinality(${arr}), 0) > 0)`;
      case 'contains':
        return ANY_UUID(String(v ?? ''), arr);
      case 'does_not_contain':
        return sql`(NOT ${ANY_UUID(String(v ?? ''), arr)})`;
    }
  }

  if (t === 'created_by' || t === 'last_edited_by') {
    const x = scalarValue(prop, j);
    switch (op) {
      case 'is_empty':
        return sql`false`;
      case 'is_not_empty':
        return sql`true`;
      case 'contains':
        return sql`(${x} = ${String(v)}::uuid)`;
      case 'does_not_contain':
        return sql`(${x} <> ${String(v)}::uuid)`;
    }
  }

  if (t === 'checkbox') return sql`(${scalarValue(prop, j)} = ${Boolean(v)}::boolean)`;

  if (t === 'date' || t === 'created_time' || t === 'last_edited_time') {
    const start = scalarValue(prop, j);
    if (op === 'is_empty') return sql`(${start} IS NULL)`;
    if (op === 'is_not_empty') return sql`(${start} IS NOT NULL)`;
    const day = dayExpr(prop, j, tz);
    const guard = (cond: Sql) => sql`(${start} IS NOT NULL AND ${cond})`;
    const d = String(v);
    switch (op) {
      case 'is':
        return guard(sql`${day} = ${d}::date`);
      case 'is_before':
        return guard(sql`${day} < ${d}::date`);
      case 'is_after':
        return guard(sql`${day} > ${d}::date`);
      case 'is_on_or_before':
        return guard(sql`${day} <= ${d}::date`);
      case 'is_on_or_after':
        return guard(sql`${day} >= ${d}::date`);
      case 'is_within': {
        const [a, b] = c.range!;
        return guard(sql`${day} BETWEEN ${a}::date AND ${b}::date`);
      }
    }
  }

  if (t === 'files') {
    const x = j.col(prop, 'v_json');
    if (op === 'is_empty') return sql`(COALESCE(jsonb_array_length(${x}), 0) = 0)`;
    if (op === 'is_not_empty') return sql`(COALESCE(jsonb_array_length(${x}), 0) > 0)`;
  }
  // Nach normalizeFilter nicht erreichbar
  return sql`true`;
}

function groupSql(g: ResolvedGroup, j: Joins, tz: string): Sql {
  const parts = g.children.map((c) =>
    c.type === 'group' ? groupSql(c, j, tz) : sql`COALESCE(${conditionSql(c, j, tz)}, false)`,
  );
  return sql`(${sql.join(parts, g.op === 'and' ? sql` AND ` : sql` OR `)})`;
}

// ---------------------------------------------------------------- Sortierung

/** Sortierschlüssel: Ausdruck und SQL-Typ (für Cursor-Parameter). */
interface SortKey {
  expr: Sql;
  type: CursorKey['type'];
  direction: 'asc' | 'desc';
}

function optionOrderArray(prop: QueryProperty): string[] {
  const cfg = prop.config as { options?: { id: string }[] } | null;
  return (cfg?.options ?? []).map((o) => o.id);
}

const lowerC = (x: Sql) => sql`(lower(${x}) COLLATE "C")`;
const userName = (idExpr: Sql) =>
  sql`((SELECT lower(u.name) FROM users u WHERE u.id = ${idExpr}) COLLATE "C")`;

function sortKey(s: ResolvedSort, j: Joins): SortKey {
  const { prop, direction } = s;
  switch (prop.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return { expr: lowerC(scalarValue(prop, j)), type: 'text', direction };
    case 'number':
    case 'unique_id':
      return { expr: scalarValue(prop, j), type: 'float8', direction };
    case 'select':
    case 'status':
    case 'multi_select':
      return {
        expr: sql`array_position(${optionOrderArray(prop)}::uuid[], ${j.col(prop, 'v_option_ids')}[1])`,
        type: 'int',
        direction,
      };
    case 'person':
      return { expr: userName(sql`${j.col(prop, 'v_user_ids')}[1]`), type: 'text', direction };
    case 'created_by':
    case 'last_edited_by':
      return { expr: userName(scalarValue(prop, j)), type: 'text', direction };
    case 'checkbox':
      return { expr: scalarValue(prop, j), type: 'bool', direction };
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return { expr: scalarValue(prop, j), type: 'timestamptz', direction };
    default:
      return { expr: sql`NULL::int`, type: 'int', direction };
  }
}

function cast(value: unknown, type: CursorKey['type']): Sql {
  switch (type) {
    case 'text':
      return sql`${String(value)}::text`;
    case 'float8':
      return sql`${Number(value)}::float8`;
    case 'int':
      return sql`${Number(value)}::int`;
    case 'bool':
      return sql`${Boolean(value)}::boolean`;
    case 'timestamptz':
      return sql`${String(value)}::timestamptz`;
  }
}

/**
 * Keyset-Bedingung "nach dem Cursor" für ORDER BY (k IS NULL), k ASC|DESC, ..., position, id.
 * Leere Werte stehen in beiden Richtungen am Ende.
 */
function afterCursor(keys: SortKey[], cursor: DecodedCursor): Sql {
  const branches: Sql[] = [];
  const equal: Sql[] = [];
  keys.forEach((k, i) => {
    const cv = cursor.values[i];
    if (cv === null || cv === undefined) {
      // Innerhalb der leeren Werte gibt es kein "danach" bezüglich dieses Schlüssels
      equal.push(sql`(${k.expr}) IS NULL`);
      return;
    }
    const c = cast(cv, k.type);
    const after =
      k.direction === 'asc'
        ? sql`((${k.expr}) > ${c} OR (${k.expr}) IS NULL)`
        : sql`((${k.expr}) < ${c} OR (${k.expr}) IS NULL)`;
    branches.push(equal.length ? sql`(${sql.join([...equal, after], sql` AND `)})` : after);
    equal.push(sql`(${k.expr}) = ${c}`);
  });
  const pos = sql`${cursor.position}::text`;
  const posAfter = sql`p.position > ${pos}`;
  branches.push(equal.length ? sql`(${sql.join([...equal, posAfter], sql` AND `)})` : posAfter);
  equal.push(sql`p.position = ${pos}`);
  branches.push(sql`(${sql.join([...equal, sql`p.id > ${cursor.id}::uuid`], sql` AND `)})`);
  return sql`(${sql.join(branches, sql` OR `)})`;
}

// ---------------------------------------------------------------- Abfragen

function baseWhere(ctx: QueryContext): Sql {
  return sql`p.database_id = ${ctx.databaseId}::uuid AND p.kind = 'DATABASE_ROW' AND p.deleted_at IS NULL AND p.archived_at IS NULL AND (p.scope = 'TEAM' OR p.owner_id = ${ctx.viewerId}::uuid)`;
}

function searchSql(ctx: QueryContext): Sql | null {
  const q = ctx.search?.trim();
  if (!q) return null;
  const pat = likePattern(q, 'contains');
  // IN statt EXISTS: PostgreSQL nutzt den Trigramm-Index auf v_text und hasht das Ergebnis
  return sql`(p.title ILIKE ${pat}::text OR p.id IN (SELECT s.row_id FROM property_values s WHERE s.database_id = ${ctx.databaseId}::uuid AND s.v_text ILIKE ${pat}::text))`;
}

interface Prepared {
  joins: Joins;
  where: Sql;
  tz: string;
}

function prepare(ctx: QueryContext, joins = new Joins()): Prepared {
  const tz = safeTimeZone(ctx.timeZone);
  const filter = normalizeFilter(ctx.filter, ctx.properties, {
    now: ctx.now ?? new Date(),
    timeZone: tz,
  });
  const parts: Sql[] = [baseWhere(ctx)];
  if (filter) parts.push(groupSql(filter, joins, tz));
  const search = searchSql(ctx);
  if (search) parts.push(search);
  for (const g of ctx.groups ?? [])
    parts.push(sql`(${g.key}::text = ANY(${groupKeysSql(g.spec, joins, tz)}))`);
  if (ctx.dateRange) parts.push(dateRangeSql(ctx.dateRange, joins, tz));
  return { joins, where: sql.join(parts, sql` AND `), tz };
}

export interface CompiledRowQuery {
  query: CompiledQuery;
  /** Typen der Sortierschlüssel k0..kn (für den Cursor der nächsten Seite) */
  keyTypes: CursorKey['type'][];
  /** Signatur der Sortierung; ein Cursor gilt nur für dieselbe Sortierung */
  signature: string;
}

export class CursorMismatchError extends Error {
  constructor() {
    super('Cursor passt nicht zur Sortierung');
    this.name = 'CursorMismatchError';
  }
}

export function sortSignature(sorts: ResolvedSort[]): string {
  return sorts.map((s) => `${s.prop.id}:${s.direction}`).join(',');
}

/**
 * Eine Seite Zeilen: id, Seitenfelder und Sortierschlüssel k0..kn. Liefert limit + 1 Zeilen,
 * damit der Aufrufer erkennt, ob es weitere gibt.
 */
export function compileRowQuery(
  ctx: QueryContext,
  page: { limit: number; cursor?: string | null },
): CompiledRowQuery {
  const prepared = prepare(ctx);
  const { joins } = prepared;
  const sorts = normalizeSorts(ctx.sorts, ctx.properties);
  const keys = sorts.map((s) => sortKey(s, joins));
  const signature = sortSignature(sorts);
  const where: Sql[] = [prepared.where];
  if (page.cursor) {
    const cursor = decodeCursor(page.cursor);
    if (
      !cursor ||
      cursor.signature !== signature ||
      cursor.values.length !== keys.length ||
      cursor.types.some((t, i) => t !== keys[i]!.type)
    )
      throw new CursorMismatchError();
    where.push(afterCursor(keys, cursor));
  }
  const order: Sql[] = [];
  keys.forEach((k) => {
    order.push(sql`(${k.expr}) IS NULL`);
    order.push(k.direction === 'asc' ? sql`(${k.expr}) ASC` : sql`(${k.expr}) DESC`);
  });
  order.push(sql`p.position ASC`, sql`p.id ASC`);
  const keyCols = keys.map((k, i) => sql`(${k.expr}) AS ${sql.raw(`k${i}`)}`);
  const query =
    sql`SELECT p.id::text AS id, p.position, p.title, p.icon, p.cover, p.created_at, p.created_by_id::text AS created_by_id, p.last_edited_at, p.last_edited_by_id::text AS last_edited_by_id${keyCols.length ? sql`, ${sql.join(keyCols, sql`, `)}` : sql``}
    FROM pages p ${joins.sql()}
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY ${sql.join(order, sql`, `)}
    LIMIT ${Math.max(1, Math.floor(page.limit)) + 1}`.compile(kysely);
  return { query, keyTypes: keys.map((k) => k.type), signature };
}

/** Anzahl der Zeilen nach Filter und Suche. */
export function compileCountQuery(ctx: QueryContext): CompiledQuery {
  const { joins, where } = prepare(ctx);
  return sql`SELECT count(*)::int AS total FROM pages p ${joins.sql()} WHERE ${where}`.compile(
    kysely,
  );
}

// ---------------------------------------------------------------- Gruppen

/**
 * Anzahl Zeilen je Gruppe (und Untergruppe) nach Filter und Suche.
 * Spalten: key, sub_key (oder NULL), count. Zeilen mit mehreren Werten zählen in jeder Gruppe.
 */
export function compileGroupCountQuery(
  ctx: QueryContext,
  group: GroupSpec,
  subGroup?: GroupSpec | null,
): CompiledQuery {
  const prepared = prepare(ctx);
  const { joins, tz } = prepared;
  const g = groupKeysSql(group, joins, tz);
  const s = subGroup ? groupKeysSql(subGroup, joins, tz) : null;
  return sql`SELECT g.k AS key, ${s ? sql`s.k` : sql`NULL::text`} AS sub_key, count(*)::int AS count
    FROM pages p ${joins.sql()} CROSS JOIN LATERAL unnest(${g}) AS g(k)${s ? sql` CROSS JOIN LATERAL unnest(${s}) AS s(k)` : sql``}
    WHERE ${prepared.where}
    GROUP BY 1, 2`.compile(kysely);
}

// ---------------------------------------------------------------- Berechnungen

export interface CalculationRequest {
  propertyId: string;
  fn: CalculationFn;
}

const pct = (part: Sql) =>
  sql`(CASE WHEN count(*) = 0 THEN 0 ELSE 100.0 * ${part} / count(*) END)::float8`;

function calcSql(prop: QueryProperty, fn: CalculationFn, col: Sql): Sql {
  const isArray = ARRAY_TYPES.includes(prop.type);
  const isFiles = prop.type === 'files';
  const empty = isArray
    ? sql`COALESCE(cardinality(${col}), 0) = 0`
    : isFiles
      ? sql`COALESCE(jsonb_array_length(${col}), 0) = 0`
      : sql`${col} IS NULL`;
  const epochMs = (x: Sql) => sql`(extract(epoch from ${x}) * 1000)::float8`;
  switch (fn) {
    case 'count_all':
      return sql`count(*)::float8`;
    case 'count_values':
      if (isArray) return sql`COALESCE(sum(cardinality(${col})), 0)::float8`;
      if (isFiles) return sql`COALESCE(sum(jsonb_array_length(${col})), 0)::float8`;
      return sql`count(${col})::float8`;
    case 'count_unique':
      if (isArray) return sql`(SELECT count(DISTINCT x)::float8 FROM f f2, unnest(f2.${col}) x)`;
      return sql`count(DISTINCT ${col})::float8`;
    case 'count_empty':
      return sql`(count(*) FILTER (WHERE ${empty}))::float8`;
    case 'count_not_empty':
      return sql`(count(*) FILTER (WHERE NOT (${empty})))::float8`;
    case 'percent_empty':
      return pct(sql`count(*) FILTER (WHERE ${empty})`);
    case 'percent_not_empty':
      return pct(sql`count(*) FILTER (WHERE NOT (${empty}))`);
    case 'sum':
      return sql`sum(${col})::float8`;
    case 'average':
      return sql`avg(${col})::float8`;
    case 'median':
      return sql`(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${col}))::float8`;
    case 'min':
      return sql`min(${col})::float8`;
    case 'max':
      return sql`max(${col})::float8`;
    case 'range':
      return sql`(max(${col}) - min(${col}))::float8`;
    case 'earliest_date':
      return epochMs(sql`min(${col})`);
    case 'latest_date':
      return epochMs(sql`max(${col})`);
    case 'date_range':
      return epochMs(sql`(max(${col}) - min(${col}))`);
    case 'checked':
      return sql`(count(*) FILTER (WHERE ${col}))::float8`;
    case 'unchecked':
      return sql`(count(*) FILTER (WHERE NOT ${col}))::float8`;
    case 'percent_checked':
      return pct(sql`count(*) FILTER (WHERE ${col})`);
    case 'percent_unchecked':
      return pct(sql`count(*) FILTER (WHERE NOT ${col})`);
  }
}

/**
 * Spaltenberechnungen über alle gefilterten Zeilen in einer Abfrage.
 * Ergebnis-Spalten r0..rn in der Reihenfolge der Anfragen (Zahlen, Datumswerte in ms).
 */
export function compileCalculationQuery(
  ctx: QueryContext,
  requests: CalculationRequest[],
): { query: CompiledQuery; requests: CalculationRequest[] } {
  const byId = new Map(ctx.properties.map((p) => [p.id, p]));
  const valid = requests.filter((r) => byId.has(r.propertyId));
  const { joins, where } = prepare(ctx);
  const cols = valid.map(
    (r, i) => sql`${scalarValue(byId.get(r.propertyId)!, joins)} AS ${sql.raw(`c${i}`)}`,
  );
  const aggs = valid.map(
    (r, i) =>
      sql`${calcSql(byId.get(r.propertyId)!, r.fn, sql.raw(`c${i}`))} AS ${sql.raw(`r${i}`)}`,
  );
  const query =
    sql`WITH f AS (SELECT p.id${cols.length ? sql`, ${sql.join(cols, sql`, `)}` : sql``} FROM pages p ${joins.sql()} WHERE ${where})
    SELECT count(*)::int AS total${aggs.length ? sql`, ${sql.join(aggs, sql`, `)}` : sql``} FROM f`.compile(
      kysely,
    );
  return { query, requests: valid };
}

export { normalizeFilter, normalizeSorts };
export const PAGE_DERIVED_PROPERTY_TYPES = PAGE_DERIVED;
