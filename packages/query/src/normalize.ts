import {
  DATE_RANGES,
  dateOperandSchema,
  isSortable,
  operatorsFor,
  type DateRange,
  type FilterGroup,
  type FilterNode,
  type FilterOperator,
  type SortSpec,
} from '@jotion/shared';
import { resolveDateOperand, resolveDateRange } from './dates';
import type { QueryProperty } from './types';

/** Geprüfte Bedingung mit aufgelösten Werten (Datumsangaben als Kalendertage). */
export interface ResolvedCondition {
  type: 'condition';
  prop: QueryProperty;
  operator: FilterOperator;
  /** string (Text, ID, Kalendertag), number oder boolean; null bei leer-Operatoren */
  value: string | number | boolean | null;
  /** bei is_within: [von, bis] */
  range: [string, string] | null;
}

export interface ResolvedGroup {
  type: 'group';
  op: 'and' | 'or';
  children: (ResolvedCondition | ResolvedGroup)[];
}

export interface NormalizeOptions {
  now: Date;
  timeZone: string;
}

function optionIds(prop: QueryProperty): string[] {
  const cfg = prop.config as { options?: { id: string }[] } | null;
  return (cfg?.options ?? []).map((o) => o.id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Prüft eine Bedingung gegen das aktuelle Schema. Ungültige oder unvollständige Bedingungen
 * (gelöschtes Property, Typwechsel, fehlender Wert, gelöschte Option) werden ignoriert,
 * wie bei Notion: eine halb ausgefüllte Bedingung filtert nichts.
 */
function resolveCondition(
  c: Extract<FilterNode, { type: 'condition' }>,
  props: Map<string, QueryProperty>,
  opts: NormalizeOptions,
): ResolvedCondition | null {
  const prop = props.get(c.propertyId);
  if (!prop) return null;
  if (!operatorsFor(prop.type).includes(c.operator)) return null;
  const base = { type: 'condition' as const, prop, operator: c.operator, range: null };
  if (c.operator === 'is_empty' || c.operator === 'is_not_empty') return { ...base, value: null };
  const v = c.value;
  switch (prop.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof v === 'string' && v.length > 0 ? { ...base, value: v } : null;
    case 'number':
    case 'unique_id':
      return typeof v === 'number' && Number.isFinite(v) ? { ...base, value: v } : null;
    case 'select':
    case 'status':
    case 'multi_select': {
      if (typeof v !== 'string') return null;
      const lower = v.toLowerCase();
      return optionIds(prop).includes(lower) ? { ...base, value: lower } : null;
    }
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return typeof v === 'string' && UUID.test(v) ? { ...base, value: v.toLowerCase() } : null;
    case 'checkbox':
      return typeof v === 'boolean' ? { ...base, value: v } : null;
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      if (c.operator === 'is_within') {
        if (typeof v !== 'string' || !(DATE_RANGES as readonly string[]).includes(v)) return null;
        return {
          ...base,
          value: v,
          range: resolveDateRange(v as DateRange, opts.now, opts.timeZone),
        };
      }
      const parsed = dateOperandSchema.safeParse(v);
      if (!parsed.success) return null;
      return { ...base, value: resolveDateOperand(parsed.data, opts.now, opts.timeZone) };
    }
    default:
      return null;
  }
}

function resolveGroup(
  g: FilterGroup,
  props: Map<string, QueryProperty>,
  opts: NormalizeOptions,
): ResolvedGroup | null {
  const children: (ResolvedCondition | ResolvedGroup)[] = [];
  for (const child of g.children) {
    const r =
      child.type === 'group'
        ? resolveGroup(child, props, opts)
        : resolveCondition(child, props, opts);
    if (r) children.push(r);
  }
  return children.length ? { type: 'group', op: g.op, children } : null;
}

/** Normalisiert einen Filter; null, wenn nichts zu filtern bleibt. */
export function normalizeFilter(
  filter: FilterGroup | null | undefined,
  properties: QueryProperty[],
  opts: NormalizeOptions,
): ResolvedGroup | null {
  if (!filter) return null;
  return resolveGroup(filter, new Map(properties.map((p) => [p.id, p])), opts);
}

export interface ResolvedSort {
  prop: QueryProperty;
  direction: 'asc' | 'desc';
}

/** Sortierungen auf vorhandene, sortierbare Properties beschränken (jedes Property einmal). */
export function normalizeSorts(
  sorts: SortSpec[] | undefined,
  properties: QueryProperty[],
): ResolvedSort[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: ResolvedSort[] = [];
  for (const s of sorts ?? []) {
    const prop = byId.get(s.propertyId);
    if (!prop || !isSortable(prop.type) || seen.has(prop.id)) continue;
    seen.add(prop.id);
    out.push({ prop, direction: s.direction });
  }
  return out;
}
