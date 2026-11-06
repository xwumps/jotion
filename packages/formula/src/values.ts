/**
 * Laufzeitwerte und Typen der Formelsprache.
 * Werte: Zahl, Text, Wahrheitswert, Datum (mit optionalem Ende), Person, Seite, Liste, leer (null).
 */

export interface DateVal {
  kind: 'date';
  /** Beginn in ms seit 1970 (ganztägig: Mitternacht UTC des Tages) */
  start: number;
  end: number | null;
  hasTime: boolean;
}
export interface PersonVal {
  kind: 'person';
  id: string;
  name: string;
  email: string;
}
export interface PageVal {
  kind: 'page';
  id: string;
  title: string;
}
export type Value = number | string | boolean | DateVal | PersonVal | PageVal | Value[] | null;

export type Type =
  'number' | 'text' | 'boolean' | 'date' | 'person' | 'page' | 'empty' | 'any' | { list: Type };

export const listOf = (t: Type): Type => ({ list: t });
export const isList = (t: Type): t is { list: Type } => typeof t === 'object';
export const elementType = (t: Type): Type => (isList(t) ? t.list : 'any');

export function typeName(t: Type): string {
  if (isList(t)) return `Liste (${typeName(t.list)})`;
  return (
    {
      number: 'Zahl',
      text: 'Text',
      boolean: 'Wahrheitswert',
      date: 'Datum',
      person: 'Person',
      page: 'Seite',
      empty: 'leer',
      any: 'beliebig',
    } as const
  )[t];
}

/** Ergebnistyp für die Speicherung: was ein Formel-Property im Ganzen liefert. */
export type ResultType =
  'number' | 'text' | 'boolean' | 'date' | 'list' | 'person' | 'page' | 'empty';
export function resultTypeOf(t: Type): ResultType {
  if (isList(t)) return 'list';
  if (t === 'any') return 'text';
  return t;
}

export const isDate = (v: Value): v is DateVal =>
  !!v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'date';
export const isPerson = (v: Value): v is PersonVal =>
  !!v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'person';
export const isPage = (v: Value): v is PageVal =>
  !!v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'page';

export function typeOfValue(v: Value): Type {
  if (v === null) return 'empty';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'text';
  if (typeof v === 'boolean') return 'boolean';
  if (Array.isArray(v)) return listOf(v.length ? typeOfValue(v[0]!) : 'any');
  return v.kind;
}

/** Leer wie bei Notion: null, "", leere Liste, 0 zählt NICHT als leer. */
export function isEmpty(v: Value): boolean {
  return v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

export function equal(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => equal(x, b[i]!));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'date') {
      const d = b as DateVal;
      return a.start === d.start && a.end === d.end;
    }
    return a.id === (b as PersonVal | PageVal).id;
  }
  return false;
}

/** Vergleich für Sortierung und <, >: Zahlen, Texte, Daten, Wahrheitswerte. */
export function compare(a: Value, b: Value): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (isDate(a) && isDate(b)) return a.start - b.start;
  return toText(a).localeCompare(toText(b));
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Text eines Werts (für Verkettung, Anzeige, format()). */
export function toText(v: Value, timeZone = 'UTC'): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map((x) => toText(x, timeZone)).join(', ');
  if (v.kind === 'person') return v.name;
  if (v.kind === 'page') return v.title;
  const one = (ms: number) => {
    const p = zonedParts(ms, v.hasTime ? timeZone : 'UTC');
    const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    return v.hasTime ? `${day} ${pad(p.hour)}:${pad(p.minute)}` : day;
  };
  return v.end !== null && v.end !== v.start ? `${one(v.start)} → ${one(v.end)}` : one(v.start);
}

/** Zahl ohne Rundungsartefakte (0.1 + 0.2 ergibt "0.3"). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : n < 0 ? '-Infinity' : 'NaN';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sonntag */
  weekday: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
export function zonedParts(ms: number, timeZone: string): ZonedParts {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    partsCache.set(timeZone, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
  };
}

/** Zeitpunkt einer lokalen Wanduhrzeit in einer Zeitzone (DST-sicher über zwei Korrekturschritte). */
export function zonedToMs(
  p: Pick<ZonedParts, 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'>,
  timeZone: string,
): number {
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  let ms = wall;
  for (let i = 0; i < 2; i++) {
    const z = zonedParts(ms, timeZone);
    const shown = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
    ms += wall - shown;
  }
  return ms;
}
