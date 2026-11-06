import {
  EMPTY_GROUP,
  dateValueMs,
  type DateBucket,
  type DateValue,
  type GroupBy,
  type PropertyType,
} from '@jotion/shared';
import { addDays, valueDay } from './dates';
import { rowValue } from './reference';
import type { QueryContext, QueryProperty, RowRecord } from './types';

/**
 * Grouping-Engine (Phase 5): Gruppenschlüssel je Zeile.
 * Gleiche Regeln in SQL (compile.ts) und hier (Referenz für Tests, Oberfläche, Zuordnung beim Ziehen).
 *
 * Schlüssel je Typ:
 * - Auswahl/Status: Options-ID; Mehrfachauswahl/Person: jede ID (Zeile erscheint in mehreren Gruppen)
 * - Checkbox: "true"/"false"; Text: der Text; Zahl: Bereichsanfang (Vielfaches von numberInterval)
 * - Datum: erster Tag des Zeitraums (Tag, Woche ab Montag, Monat, Jahr) in der Zeitzone des Betrachters
 * - Erstellt/Bearbeitet von: Nutzer-ID
 * Leere Werte: EMPTY_GROUP.
 */

export interface GroupSpec {
  prop: QueryProperty;
  dateBucket: DateBucket;
  numberInterval: number;
}

export const DATE_GROUP_TYPES: PropertyType[] = ['date', 'created_time', 'last_edited_time'];

export function groupSpec(g: GroupBy, properties: QueryProperty[]): GroupSpec | null {
  const prop = properties.find((p) => p.id === g.propertyId);
  if (!prop) return null;
  return { prop, dateBucket: g.dateBucket, numberInterval: g.numberInterval };
}

/** Erster Tag des Zeitraums, in den ein Kalendertag fällt. */
export function bucketStart(day: string, bucket: DateBucket): string {
  switch (bucket) {
    case 'day':
      return day;
    case 'week': {
      const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sonntag
      return addDays(day, -((dow + 6) % 7));
    }
    case 'month':
      return `${day.slice(0, 7)}-01`;
    case 'quarter': {
      const m = Number(day.slice(5, 7));
      return `${day.slice(0, 4)}-${String(m - ((m - 1) % 3)).padStart(2, '0')}-01`;
    }
    case 'year':
      return `${day.slice(0, 4)}-01-01`;
  }
}

/** Zahl als Schlüssel wie PostgreSQL float8::text (kürzeste exakte Darstellung). */
export function numberKey(v: number, interval: number): string {
  const start = Math.abs(v) < 1e-300 ? 0 : Math.floor(v / interval) * interval;
  return String(Object.is(start, -0) ? 0 : start);
}

/** Gruppenschlüssel einer Zeile (mindestens einer). */
export function rowGroupKeys(row: RowRecord, spec: GroupSpec, timeZone: string): string[] {
  const raw = rowValue(row, spec.prop);
  switch (spec.prop.type) {
    case 'multi_select':
    case 'person': {
      const ids = Array.isArray(raw) ? (raw as string[]) : [];
      return ids.length ? [...new Set(ids)] : [EMPTY_GROUP];
    }
    case 'checkbox':
      return [raw === true ? 'true' : 'false'];
    case 'number':
    case 'unique_id':
      return typeof raw === 'number' ? [numberKey(raw, spec.numberInterval)] : [EMPTY_GROUP];
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      if (!raw || typeof raw !== 'object') return [EMPTY_GROUP];
      const d = raw as DateValue;
      const day = valueDay(dateValueMs(d.start, d.hasTime), d.hasTime, timeZone);
      return [bucketStart(day, spec.dateBucket)];
    }
    default:
      return typeof raw === 'string' && raw !== '' ? [raw] : [EMPTY_GROUP];
  }
}

/** Kalendertage [Beginn, Ende] eines Datumswerts einer Zeile (für Kalender und Zeitleiste). */
export function rowDayRange(
  row: RowRecord,
  start: QueryProperty,
  end: QueryProperty | null,
  timeZone: string,
): [string, string] | null {
  const dayOf = (v: unknown, which: 'start' | 'end'): string | null => {
    if (!v || typeof v !== 'object') return null;
    const d = v as DateValue;
    const s = which === 'end' ? d.end : d.start;
    return s ? valueDay(dateValueMs(s, d.hasTime), d.hasTime, timeZone) : null;
  };
  const a = dayOf(rowValue(row, start), 'start');
  if (!a) return null;
  let b: string | null;
  if (end && end.id !== start.id) b = end.type === 'date' ? dayOf(rowValue(row, end), 'start') : a;
  else b = start.type === 'date' ? dayOf(rowValue(row, start), 'end') : a;
  return [a, b && b > a ? b : a];
}

/** Referenz zu den Gruppen- und Zeitraumbedingungen des Compilers. */
export function matchesGroupsAndRange(
  row: RowRecord,
  ctx: QueryContext,
  timeZone: string,
): boolean {
  for (const g of ctx.groups ?? [])
    if (!rowGroupKeys(row, g.spec, timeZone).includes(g.key)) return false;
  if (ctx.dateRange) {
    const r = rowDayRange(row, ctx.dateRange.start, ctx.dateRange.end, timeZone);
    if (!r || r[0] > ctx.dateRange.to || r[1] < ctx.dateRange.from) return false;
  }
  return true;
}

/** Ziel eines Gruppenwechsels: neuer Titel oder neuer Rohwert des Properties (wird danach validiert). */
export type GroupMoveResult =
  { kind: 'title'; value: string } | { kind: 'value'; value: unknown } | { kind: 'unchanged' };

export class GroupMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupMoveError';
  }
}

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/**
 * Wert, mit dem eine Zeile aus Gruppe `from` in Gruppe `to` wechselt (Board-Ziehen).
 * Mehrfachauswahl/Person: `from` wird entfernt, `to` ergänzt; andere Werte bleiben.
 * Datum: verschiebt Beginn (und Ende) auf den ersten Tag der Zielgruppe, Uhrzeit und Dauer bleiben.
 */
export function valueForGroupMove(
  row: RowRecord,
  spec: GroupSpec,
  from: string,
  to: string,
  timeZone: string,
): GroupMoveResult {
  if (from === to) return { kind: 'unchanged' };
  const prop = spec.prop;
  const empty = to === EMPTY_GROUP;
  const raw = rowValue(row, prop);
  switch (prop.type) {
    case 'title':
      return { kind: 'title', value: empty ? '' : to };
    case 'select':
    case 'status':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return { kind: 'value', value: empty ? null : to };
    case 'checkbox':
      return { kind: 'value', value: to === 'true' };
    case 'number':
      return { kind: 'value', value: empty ? null : Number(to) };
    case 'multi_select':
    case 'person': {
      const ids = (Array.isArray(raw) ? (raw as string[]) : []).filter((x) => x !== from);
      if (!empty && !ids.includes(to)) ids.push(to);
      return { kind: 'value', value: empty ? [] : ids };
    }
    case 'date': {
      if (empty) return { kind: 'value', value: null };
      const d = raw && typeof raw === 'object' ? (raw as DateValue) : null;
      if (!d)
        return { kind: 'value', value: { start: to, end: null, hasTime: false, timeZone: null } };
      const startMs = dateValueMs(d.start, d.hasTime);
      const day = valueDay(startMs, d.hasTime, timeZone);
      const shift = (dayNumber(to) - dayNumber(day)) * DAY_MS;
      const move = (s: string) =>
        d.hasTime
          ? new Date(dateValueMs(s, true) + shift).toISOString()
          : new Date(dateValueMs(s, false) + shift).toISOString().slice(0, 10);
      return {
        kind: 'value',
        value: { ...d, start: move(d.start), end: d.end ? move(d.end) : null },
      };
    }
    default:
      throw new GroupMoveError('Nach diesem Property kann nicht per Ziehen gruppiert werden');
  }
}
