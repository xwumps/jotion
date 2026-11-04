import { dateValueMs, type CalculationFn, type DateValue, type PropertyType } from '@jotion/shared';
import { safeTimeZone, valueDay } from './dates';
import {
  normalizeFilter,
  normalizeSorts,
  type ResolvedCondition,
  type ResolvedGroup,
  type ResolvedSort,
} from './normalize';
import type { CalculationRequest } from './compile';
import { matchesGroupsAndRange } from './grouping';
import type { QueryContext, QueryProperty, RowRecord } from './types';

/**
 * JS-Referenz-Implementierung von Filter, Sortierung, Suche und Berechnungen.
 * Dient als Orakel für die Vergleichstests des SQL-Compilers und ist bewusst einfach gehalten.
 */

const TEXT_TYPES: PropertyType[] = ['title', 'text', 'url', 'email', 'phone'];

const lower = (s: string) => s.toLowerCase();

/** Rohwert einer Zeile für ein Property (Seitenfelder für abgeleitete Typen). */
export function rowValue(row: RowRecord, prop: QueryProperty): unknown {
  switch (prop.type) {
    case 'title':
      return row.title === '' ? null : row.title;
    case 'created_time':
      return { start: row.createdAt, end: null, hasTime: true, timeZone: null };
    case 'last_edited_time':
      return { start: row.lastEditedAt, end: null, hasTime: true, timeZone: null };
    case 'created_by':
      return row.createdById;
    case 'last_edited_by':
      return row.lastEditedById;
    default: {
      const v = row.values[prop.id];
      return v === undefined ? null : v;
    }
  }
}

const asArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const asText = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function dateMs(v: unknown): { ms: number; hasTime: boolean } | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as DateValue;
  return { ms: dateValueMs(d.start, d.hasTime), hasTime: d.hasTime };
}

function evalCondition(c: ResolvedCondition, row: RowRecord, tz: string): boolean {
  const { prop, operator: op } = c;
  const t = prop.type;
  const raw = rowValue(row, prop);

  if (TEXT_TYPES.includes(t)) {
    const x = asText(raw);
    const s = lower(String(c.value ?? ''));
    switch (op) {
      case 'is_empty':
        return x === null;
      case 'is_not_empty':
        return x !== null;
      case 'equals':
        return x !== null && lower(x) === s;
      case 'does_not_equal':
        return x === null || lower(x) !== s;
      case 'contains':
        return x !== null && lower(x).includes(s);
      case 'does_not_contain':
        return x === null || !lower(x).includes(s);
      case 'starts_with':
        return x !== null && lower(x).startsWith(s);
      case 'ends_with':
        return x !== null && lower(x).endsWith(s);
    }
  }

  if (t === 'number' || t === 'unique_id') {
    const x = typeof raw === 'number' ? raw : null;
    const n = Number(c.value);
    switch (op) {
      case 'is_empty':
        return x === null;
      case 'is_not_empty':
        return x !== null;
      case 'equals':
        return x !== null && x === n;
      case 'does_not_equal':
        return x === null || x !== n;
      case 'greater_than':
        return x !== null && x > n;
      case 'less_than':
        return x !== null && x < n;
      case 'greater_than_or_equal_to':
        return x !== null && x >= n;
      case 'less_than_or_equal_to':
        return x !== null && x <= n;
    }
  }

  if (t === 'select' || t === 'status' || t === 'multi_select' || t === 'person') {
    const arr = t === 'select' || t === 'status' ? (raw ? [String(raw)] : []) : asArray(raw);
    const s = String(c.value ?? '');
    switch (op) {
      case 'is_empty':
        return arr.length === 0;
      case 'is_not_empty':
        return arr.length > 0;
      case 'is':
      case 'contains':
        return arr.includes(s);
      case 'is_not':
      case 'does_not_contain':
        return !arr.includes(s);
    }
  }

  if (t === 'created_by' || t === 'last_edited_by') {
    switch (op) {
      case 'is_empty':
        return false;
      case 'is_not_empty':
        return true;
      case 'contains':
        return raw === c.value;
      case 'does_not_contain':
        return raw !== c.value;
    }
  }

  if (t === 'checkbox') return (raw === true) === c.value;

  if (t === 'date' || t === 'created_time' || t === 'last_edited_time') {
    const d = dateMs(raw);
    if (op === 'is_empty') return d === null;
    if (op === 'is_not_empty') return d !== null;
    if (!d) return false;
    const day = valueDay(d.ms, d.hasTime, tz);
    const v = String(c.value);
    switch (op) {
      case 'is':
        return day === v;
      case 'is_before':
        return day < v;
      case 'is_after':
        return day > v;
      case 'is_on_or_before':
        return day <= v;
      case 'is_on_or_after':
        return day >= v;
      case 'is_within':
        return day >= c.range![0] && day <= c.range![1];
    }
  }

  if (t === 'files') {
    const n = asArray(raw).length;
    if (op === 'is_empty') return n === 0;
    if (op === 'is_not_empty') return n > 0;
  }
  return true;
}

function evalGroup(g: ResolvedGroup, row: RowRecord, tz: string): boolean {
  const results = g.children.map((c) =>
    c.type === 'group' ? evalGroup(c, row, tz) : evalCondition(c, row, tz),
  );
  return g.op === 'and' ? results.every(Boolean) : results.some(Boolean);
}

function matchesSearch(row: RowRecord, ctx: QueryContext): boolean {
  const q = ctx.search?.trim();
  if (!q) return true;
  const s = lower(q);
  if (lower(row.title).includes(s)) return true;
  return ctx.properties.some(
    (p) =>
      ['text', 'url', 'email', 'phone'].includes(p.type) &&
      typeof row.values[p.id] === 'string' &&
      lower(row.values[p.id] as string).includes(s),
  );
}

/** Zeilen, die Filter und Suche erfüllen (Reihenfolge unverändert). */
export function filterRows(rows: RowRecord[], ctx: QueryContext): RowRecord[] {
  const tz = safeTimeZone(ctx.timeZone);
  const filter = normalizeFilter(ctx.filter, ctx.properties, {
    now: ctx.now ?? new Date(),
    timeZone: tz,
  });
  return rows.filter(
    (r) =>
      (!filter || evalGroup(filter, r, tz)) &&
      matchesSearch(r, ctx) &&
      matchesGroupsAndRange(r, ctx, tz),
  );
}

type Key = string | number | boolean | null;

function sortKeyOf(row: RowRecord, s: ResolvedSort, ctx: QueryContext): Key {
  const { prop } = s;
  const raw = rowValue(row, prop);
  const name = (id: unknown) => {
    const n = typeof id === 'string' ? ctx.userNames?.[id] : undefined;
    return n === undefined ? null : lower(n);
  };
  switch (prop.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone': {
      const x = asText(raw);
      return x === null ? null : lower(x);
    }
    case 'number':
    case 'unique_id':
      return typeof raw === 'number' ? raw : null;
    case 'select':
    case 'status':
    case 'multi_select': {
      const first = prop.type === 'multi_select' ? asArray(raw)[0] : raw;
      if (typeof first !== 'string') return null;
      const opts = ((prop.config as { options?: { id: string }[] }).options ?? []).map((o) => o.id);
      const i = opts.indexOf(first);
      return i < 0 ? null : i + 1;
    }
    case 'person':
      return name(asArray(raw)[0]);
    case 'created_by':
    case 'last_edited_by':
      return name(raw);
    case 'checkbox':
      return raw === true;
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return dateMs(raw)?.ms ?? null;
    default:
      return null;
  }
}

/** Codepunkt-Vergleich wie PostgreSQL COLLATE "C" (für Zeichen der BMP identisch). */
function cmp(a: string | number | boolean, b: string | number | boolean): number {
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sortiert wie der Compiler: leere Werte zuletzt, dann Position und ID. */
export function sortRows(rows: RowRecord[], ctx: QueryContext): RowRecord[] {
  const sorts = normalizeSorts(ctx.sorts, ctx.properties);
  const keyed = rows.map((r) => ({ r, k: sorts.map((s) => sortKeyOf(r, s, ctx)) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < sorts.length; i++) {
      const x = a.k[i]!;
      const y = b.k[i]!;
      if (x === null && y === null) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const c = cmp(x, y);
      if (c !== 0) return sorts[i]!.direction === 'asc' ? c : -c;
    }
    return cmp(a.r.position, b.r.position) || cmp(a.r.id, b.r.id);
  });
  return keyed.map((x) => x.r);
}

/** Filter, Suche und Sortierung zusammen. */
export function queryRows(rows: RowRecord[], ctx: QueryContext): RowRecord[] {
  return sortRows(filterRows(rows, ctx), ctx);
}

function isEmptyFor(type: PropertyType, v: unknown): boolean {
  // Checkbox ist nie leer (fehlender Wert = nicht angehakt), wie COALESCE im SQL
  if (type === 'checkbox') return false;
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v === '';
  return false;
}

/** Spaltenberechnung über die gegebenen (bereits gefilterten) Zeilen. */
export function calculate(
  rows: RowRecord[],
  prop: QueryProperty,
  fn: CalculationFn,
): number | null {
  const vals = rows.map((r) => rowValue(r, prop));
  const n = rows.length;
  const percent = (k: number) => (n === 0 ? 0 : (100 * k) / n);
  const empties = vals.filter((v) => isEmptyFor(prop.type, v)).length;
  const isArray = ['multi_select', 'person', 'files'].includes(prop.type);
  const nums = (): number[] =>
    ['date', 'created_time', 'last_edited_time'].includes(prop.type)
      ? vals.map((v) => dateMs(v)?.ms).filter((x): x is number => x !== undefined)
      : vals.filter((v): v is number => typeof v === 'number');
  const scalarKey = (v: unknown): string =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? String(dateMs(v)?.ms)
      : typeof v === 'number'
        ? `n${v}`
        : JSON.stringify(v);

  switch (fn) {
    case 'count_all':
      return n;
    case 'count_values':
      return isArray ? vals.reduce<number>((s, v) => s + asArray(v).length, 0) : n - empties;
    case 'count_unique': {
      if (prop.type === 'multi_select' || prop.type === 'person')
        return new Set(vals.flatMap((v) => asArray(v))).size;
      return new Set(vals.filter((v) => !isEmptyFor(prop.type, v)).map(scalarKey)).size;
    }
    case 'count_empty':
      return empties;
    case 'count_not_empty':
      return n - empties;
    case 'percent_empty':
      return percent(empties);
    case 'percent_not_empty':
      return percent(n - empties);
    case 'sum': {
      const xs = nums();
      return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
    }
    case 'average': {
      const xs = nums();
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    }
    case 'median': {
      const xs = nums().sort((a, b) => a - b);
      if (!xs.length) return null;
      const m = Math.floor(xs.length / 2);
      return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
    }
    case 'min':
    case 'earliest_date': {
      const xs = nums();
      return xs.length ? Math.min(...xs) : null;
    }
    case 'max':
    case 'latest_date': {
      const xs = nums();
      return xs.length ? Math.max(...xs) : null;
    }
    case 'range':
    case 'date_range': {
      const xs = nums();
      return xs.length ? Math.max(...xs) - Math.min(...xs) : null;
    }
    case 'checked':
      return vals.filter((v) => v === true).length;
    case 'unchecked':
      return vals.filter((v) => v !== true).length;
    case 'percent_checked':
      return percent(vals.filter((v) => v === true).length);
    case 'percent_unchecked':
      return percent(vals.filter((v) => v !== true).length);
  }
}

/** Mehrere Berechnungen (Referenz zu compileCalculationQuery). */
export function calculateAll(
  rows: RowRecord[],
  ctx: QueryContext,
  requests: CalculationRequest[],
): Record<string, number | null> {
  const filtered = filterRows(rows, ctx);
  const byId = new Map(ctx.properties.map((p) => [p.id, p]));
  const out: Record<string, number | null> = {};
  for (const r of requests) {
    const p = byId.get(r.propertyId);
    if (p) out[r.propertyId] = calculate(filtered, p, r.fn);
  }
  return out;
}
