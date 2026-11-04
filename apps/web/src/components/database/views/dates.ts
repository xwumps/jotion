import type { DateValue, PropertyDto, RowDto } from '@jotion/shared';

/**
 * Datumshilfen für Kalender und Zeitleiste. Positionen sind "Tagnummern" (Tage seit 1970 als
 * Kommazahl): ganztägige Werte liegen auf Mitternacht ihres Kalendertags, Werte mit Uhrzeit
 * auf ihrer lokalen Uhrzeit im Browser. So stimmen Tagesgrenzen auch bei Sommerzeit.
 */

export const DAY_MS = 86_400_000;

export const dayNum = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
export const dayStr = (n: number) => new Date(Math.floor(n) * DAY_MS).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => dayStr(dayNum(day) + n);

/** Heutiger Kalendertag (lokal). */
export function today(): string {
  const d = new Date();
  return localDay(d);
}

export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Lokale Position eines Zeitpunkts (Tagnummer mit Tagesanteil). */
export function instantPos(iso: string): number {
  const d = new Date(iso);
  return dayNum(localDay(d)) + (d.getHours() * 60 + d.getMinutes()) / 1440;
}

/** Montag der Woche eines Tages. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

export const isWeekend = (day: string) => {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
};

function dateOf(row: RowDto, prop: PropertyDto): DateValue | null {
  if (prop.type === 'created_time')
    return { start: row.createdAt, end: null, hasTime: true, timeZone: null };
  if (prop.type === 'last_edited_time')
    return { start: row.lastEditedAt, end: null, hasTime: true, timeZone: null };
  const v = row.values[prop.id];
  return v && typeof v === 'object' && 'start' in v ? (v as DateValue) : null;
}

export interface Span {
  /** Beginn (Tagnummer) */
  start: number;
  /** Ende exklusiv (ganztägig: Folgetag nach dem letzten Tag) */
  end: number;
  allDay: boolean;
  startDay: string;
  /** letzter Kalendertag (inklusive) */
  endDay: string;
}

/** Zeitraum einer Zeile aus Beginn-Property und optionalem Ende-Property. */
export function rowSpan(
  row: RowDto,
  startProp: PropertyDto,
  endProp: PropertyDto | null,
): Span | null {
  const s = dateOf(row, startProp);
  if (!s) return null;
  const pos = (v: string, hasTime: boolean) => (hasTime ? instantPos(v) : dayNum(v));
  const start = pos(s.start, s.hasTime);
  let endRaw: { v: string; hasTime: boolean } | null = null;
  if (endProp && endProp.id !== startProp.id) {
    const e = dateOf(row, endProp);
    if (e) endRaw = { v: e.start, hasTime: e.hasTime };
  } else if (s.end) endRaw = { v: s.end, hasTime: s.hasTime };
  let end: number;
  if (!endRaw) end = s.hasTime ? start + 1 / 24 : start + 1;
  else end = endRaw.hasTime ? pos(endRaw.v, true) : dayNum(endRaw.v) + 1;
  if (end <= start) end = s.hasTime ? start + 1 / 24 : Math.floor(start) + 1;
  const startDay = dayStr(start);
  const endDay = dayStr(Math.max(Math.floor(start), Math.ceil(end) - 1));
  return { start, end, allDay: !s.hasTime, startDay, endDay };
}

/** Verschiebt einen Datumswert um Tage (Uhrzeit bleibt) oder Millisekunden. */
export function shiftDateValue(v: DateValue, days: number, ms = 0): DateValue {
  const move = (s: string) =>
    v.hasTime
      ? new Date(Date.parse(s) + days * DAY_MS + ms).toISOString()
      : addDays(s, days + Math.round(ms / DAY_MS));
  return { ...v, start: move(v.start), end: v.end ? move(v.end) : null };
}

/**
 * Neue Werte nach Ziehen/Größe ändern: Beginn und/oder Ende um delta Tage verschieben.
 * Liefert die zu speichernden Werte je Property-ID (oder null, wenn nicht änderbar).
 */
export function movedValues(
  row: RowDto,
  startProp: PropertyDto,
  endProp: PropertyDto | null,
  edge: 'move' | 'start' | 'end',
  days: number,
  ms = 0,
): Record<string, DateValue> | null {
  if (startProp.type !== 'date') return null;
  const s = dateOf(row, startProp);
  if (!s) return null;
  const separate = endProp && endProp.id !== startProp.id;
  if (separate && endProp.type !== 'date') return null;
  const out: Record<string, DateValue> = {};
  const shift = (x: string, hasTime: boolean) =>
    hasTime ? new Date(Date.parse(x) + days * DAY_MS + ms).toISOString() : addDays(x, days);
  if (separate) {
    const e = dateOf(row, endProp);
    if (edge !== 'end') out[startProp.id] = { ...s, start: shift(s.start, s.hasTime) };
    if (edge !== 'start' && e) out[endProp.id] = { ...e, start: shift(e.start, e.hasTime) };
    if (edge === 'end' && !e)
      out[endProp.id] = { ...s, start: shift(s.start, s.hasTime), end: null };
    return out;
  }
  if (edge === 'move') out[startProp.id] = shiftDateValue(s, days, ms);
  else if (edge === 'start') {
    const start = shift(s.start, s.hasTime);
    const end = s.end ?? s.start;
    out[startProp.id] = { ...s, start: start > end ? end : start, end };
  } else {
    const end = shift(s.end ?? s.start, s.hasTime);
    out[startProp.id] = { ...s, end: end < s.start ? s.start : end };
  }
  return out;
}

/** Wert eines neuen Eintrags an einem Tag. */
export const newDateValue = (day: string): DateValue => ({
  start: day,
  end: null,
  hasTime: false,
  timeZone: null,
});
