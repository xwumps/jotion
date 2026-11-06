import {
  compare,
  elementType,
  equal,
  formatNumber,
  isDate,
  isEmpty,
  isList,
  isPage,
  isPerson,
  listOf,
  toText,
  typeName,
  zonedParts,
  zonedToMs,
  type DateVal,
  type Type,
  type Value,
} from './values';
import { formatDate } from './format-date';

export interface EvalEnv {
  now: number;
  timeZone: string;
}

/** Fehler eines Arguments während der Auswertung (Position ergänzt der Interpreter). */
export class ArgError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type Impl = (args: Value[], env: EvalEnv) => Value;
type TypeFn = (args: Type[]) => Type;

export interface Builtin {
  min: number;
  max: number;
  type: TypeFn;
  impl: Impl;
  /** Kurzbeschreibung für Autocomplete */
  doc: string;
  /** Hängt vom aktuellen Zeitpunkt ab (now, today) */
  volatile?: boolean;
}

// ---------------------------------------------------------------- Hilfen

const accepts = (t: Type, want: Type | Type[]): boolean => {
  if (t === 'any' || t === 'empty') return true;
  const list = Array.isArray(want) ? want : [want];
  return list.some((w) => {
    if (w === 'any') return true;
    if (isList(w)) return isList(t) && (w.list === 'any' || accepts(t.list, w.list));
    return t === w;
  });
};

/** Prüft Argumenttypen; wirft einen Typfehler mit Argumentnummer. */
function sig(want: (Type | Type[])[], ret: Type | TypeFn): TypeFn {
  return (args) => {
    args.forEach((t, i) => {
      const w = want[Math.min(i, want.length - 1)];
      if (w !== undefined && !accepts(t, w))
        throw new ArgTypeError(i, `erwartet ${wantName(w)}, bekommt ${typeName(t)}`);
    });
    return typeof ret === 'function' ? ret(args) : ret;
  };
}
const wantName = (w: Type | Type[]) =>
  Array.isArray(w) ? w.map(typeName).join(' oder ') : typeName(w);

export class ArgTypeError extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(message);
  }
}

const NUM: Type = 'number';
const TXT: Type = 'text';
const BOOL: Type = 'boolean';
const DATE: Type = 'date';
const ANY: Type = 'any';
const LIST: Type = listOf('any');

const num = (v: Value | undefined, what = 'Zahl'): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new ArgError(`${what} erwartet`);
};
const txt = (v: Value | undefined, env?: EvalEnv): string => toText(v ?? null, env?.timeZone);
const list = (v: Value | undefined): Value[] =>
  v === null || v === undefined ? [] : Array.isArray(v) ? v : [v];
const date = (v: Value | undefined): DateVal => {
  if (v !== undefined && isDate(v)) return v;
  throw new ArgError('Datum erwartet');
};
const nums = (args: Value[]): number[] =>
  args
    .flatMap((a) => list(a))
    .filter((x) => x !== null)
    .map((x) => num(x));
/** Endliche Zahl oder leer (Division durch 0 ergibt leer statt Infinity) */
const finite = (n: number): Value => (Number.isFinite(n) ? n : null);

const UNITS = [
  'years',
  'quarters',
  'months',
  'weeks',
  'days',
  'hours',
  'minutes',
  'seconds',
  'milliseconds',
] as const;
type Unit = (typeof UNITS)[number];
function unitOf(v: Value): Unit {
  const s = txt(v).toLowerCase().trim();
  const u = UNITS.find((x) => x === s || x.slice(0, -1) === s);
  if (!u) throw new ArgError(`Unbekannte Einheit "${s}" (${UNITS.join(', ')})`);
  return u;
}

const FIXED_MS: Partial<Record<Unit, number>> = {
  weeks: 7 * 86_400_000,
  days: 86_400_000,
  hours: 3_600_000,
  minutes: 60_000,
  seconds: 1000,
  milliseconds: 1,
};

/** Kalenderrechnung in der Zeitzone: Tage und Monate verschieben die Wanduhrzeit (DST-sicher). */
function addUnit(ms: number, n: number, unit: Unit, d: DateVal, tz: string): number {
  const zone = d.hasTime ? tz : 'UTC';
  if (unit === 'hours' || unit === 'minutes' || unit === 'seconds' || unit === 'milliseconds')
    return ms + n * FIXED_MS[unit]!;
  const p = zonedParts(ms, zone);
  let { year, month, day } = p;
  if (unit === 'days' || unit === 'weeks') {
    const t = new Date(Date.UTC(year, month - 1, day + n * (unit === 'weeks' ? 7 : 1)));
    year = t.getUTCFullYear();
    month = t.getUTCMonth() + 1;
    day = t.getUTCDate();
  } else {
    const months = unit === 'years' ? n * 12 : unit === 'quarters' ? n * 3 : n;
    const total = year * 12 + (month - 1) + Math.trunc(months);
    year = Math.floor(total / 12);
    month = (total % 12) + 1;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    day = Math.min(day, last);
  }
  return (
    zonedToMs({ year, month, day, hour: p.hour, minute: p.minute, second: p.second }, zone) +
    (ms % 1000)
  );
}

/** Abstand in ganzen Einheiten (wie Notion: zur Null hin gerundet). */
function between(a: DateVal, b: DateVal, unit: Unit, tz: string): number {
  const fixed = FIXED_MS[unit];
  if (fixed && unit !== 'days' && unit !== 'weeks') return Math.trunc((a.start - b.start) / fixed);
  const zone = a.hasTime || b.hasTime ? tz : 'UTC';
  const pa = zonedParts(a.start, zone);
  const pb = zonedParts(b.start, zone);
  if (unit === 'days' || unit === 'weeks') {
    // Kalendertage plus Uhrzeitanteil, damit 23:00 bis 01:00 kein ganzer Tag ist
    const da = Date.UTC(pa.year, pa.month - 1, pa.day, pa.hour, pa.minute, pa.second);
    const db = Date.UTC(pb.year, pb.month - 1, pb.day, pb.hour, pb.minute, pb.second);
    return Math.trunc((da - db) / (unit === 'weeks' ? 7 * 86_400_000 : 86_400_000));
  }
  let months = (pa.year - pb.year) * 12 + (pa.month - pb.month);
  const restA = [pa.day, pa.hour, pa.minute, pa.second];
  const restB = [pb.day, pb.hour, pb.minute, pb.second];
  const cmp = restA.findIndex((x, i) => x !== restB[i]);
  if (cmp !== -1) {
    if (months > 0 && restA[cmp]! < restB[cmp]!) months--;
    if (months < 0 && restA[cmp]! > restB[cmp]!) months++;
  }
  return unit === 'years'
    ? Math.trunc(months / 12)
    : unit === 'quarters'
      ? Math.trunc(months / 3)
      : months;
}

const mkDate = (start: number, hasTime: boolean, end: number | null = null): DateVal => ({
  kind: 'date',
  start,
  end,
  hasTime,
});

function parseDateText(s: string, tz: string): DateVal | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) {
    const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
    return Number.isNaN(ms) ? null : mkDate(ms, false);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) {
    const ms = zonedToMs(
      {
        year: +m[1]!,
        month: +m[2]!,
        day: +m[3]!,
        hour: +m[4]!,
        minute: +m[5]!,
        second: +(m[6] ?? 0),
      },
      tz,
    );
    return mkDate(ms, true);
  }
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : mkDate(ms, true);
}

function safeRegex(pattern: string, flags = ''): RegExp {
  if (pattern.length > 500) throw new ArgError('Regulärer Ausdruck ist zu lang');
  try {
    return new RegExp(pattern, flags);
  } catch {
    throw new ArgError('Ungültiger regulärer Ausdruck');
  }
}

const MAX_TEXT = 100_000;
const capText = (s: string) => {
  if (s.length > MAX_TEXT) throw new ArgError('Text wird zu lang');
  return s;
};

// ---------------------------------------------------------------- Funktionen

const listOfFirstElem: TypeFn = (a) => (a[0] && isList(a[0]) ? a[0] : LIST);
const elemOfFirst: TypeFn = (a) => (a[0] ? elementType(a[0]) : ANY);

function numberFn(doc: string, f: (n: number, m?: number) => number, max = 1): Builtin {
  return {
    min: 1,
    max,
    doc,
    type: sig([NUM, NUM], NUM),
    impl: (a) =>
      a[0] === null ? null : finite(f(num(a[0]), a[1] === undefined ? undefined : num(a[1]))),
  };
}

function aggregate(doc: string, f: (ns: number[]) => number | null): Builtin {
  return {
    min: 1,
    max: Infinity,
    doc,
    type: sig([[NUM, listOf(NUM)]], NUM),
    impl: (a) => {
      const ns = nums(a);
      return ns.length ? finite(f(ns) ?? NaN) : null;
    },
  };
}

function dateField(doc: string, f: (p: ReturnType<typeof zonedParts>) => number): Builtin {
  return {
    min: 1,
    max: 1,
    doc,
    type: sig([DATE], NUM),
    impl: (a, env) => {
      if (a[0] === null) return null;
      const d = date(a[0]);
      return f(zonedParts(d.start, d.hasTime ? env.timeZone : 'UTC'));
    },
  };
}

export const BUILTINS: Record<string, Builtin> = {
  // ---- Logik und Vergleich
  empty: {
    min: 1,
    max: 1,
    doc: 'Ist der Wert leer?',
    type: () => BOOL,
    impl: (a) => isEmpty(a[0]!),
  },
  not: { min: 1, max: 1, doc: 'Verneinung', type: () => BOOL, impl: (a) => !truthy(a[0]!) },
  equal: {
    min: 2,
    max: 2,
    doc: 'Sind beide Werte gleich?',
    type: () => BOOL,
    impl: (a) => equal(a[0]!, a[1]!),
  },
  unequal: {
    min: 2,
    max: 2,
    doc: 'Sind die Werte verschieden?',
    type: () => BOOL,
    impl: (a) => !equal(a[0]!, a[1]!),
  },

  // ---- Mathematik
  add: {
    min: 2,
    max: 2,
    doc: 'Summe zweier Zahlen oder Verkettung von Text',
    type: (a) => (a.some((t) => t === 'text') ? TXT : NUM),
    impl: (a, env) => plus(a[0]!, a[1]!, env),
  },
  subtract: numberFn('Differenz', (x, y) => x - (y ?? 0), 2),
  multiply: numberFn('Produkt', (x, y) => x * (y ?? 1), 2),
  divide: numberFn('Quotient', (x, y) => x / (y ?? 1), 2),
  mod: numberFn('Rest der Division', (x, y) => x % (y ?? 1), 2),
  pow: numberFn('Potenz', (x, y) => Math.pow(x, y ?? 1), 2),
  abs: numberFn('Betrag', Math.abs),
  ceil: numberFn('Aufrunden', Math.ceil),
  floor: numberFn('Abrunden', Math.floor),
  round: numberFn(
    'Runden (optional auf Nachkommastellen)',
    (x, places) => {
      const p = Math.pow(10, Math.trunc(places ?? 0));
      // toPrecision gegen Darstellungsfehler (1.005 * 100 = 100.49999999999999)
      return (Math.sign(x) * Math.round(Number((Math.abs(x) * p).toPrecision(15)))) / p;
    },
    2,
  ),
  sqrt: numberFn('Quadratwurzel', Math.sqrt),
  cbrt: numberFn('Kubikwurzel', Math.cbrt),
  exp: numberFn('e hoch x', Math.exp),
  ln: numberFn('Natürlicher Logarithmus', Math.log),
  log10: numberFn('Logarithmus zur Basis 10', Math.log10),
  log2: numberFn('Logarithmus zur Basis 2', Math.log2),
  sign: numberFn('Vorzeichen (-1, 0, 1)', Math.sign),
  pi: { min: 0, max: 0, doc: 'Kreiszahl π', type: () => NUM, impl: () => Math.PI },
  e: { min: 0, max: 0, doc: 'Eulersche Zahl e', type: () => NUM, impl: () => Math.E },
  min: aggregate('Kleinster Wert', (ns) => Math.min(...ns)),
  max: aggregate('Größter Wert', (ns) => Math.max(...ns)),
  sum: aggregate('Summe', (ns) => ns.reduce((s, x) => s + x, 0)),
  mean: aggregate('Durchschnitt', (ns) => ns.reduce((s, x) => s + x, 0) / ns.length),
  median: aggregate('Median', (ns) => {
    const s = [...ns].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  }),
  toNumber: {
    min: 1,
    max: 1,
    doc: 'Wert als Zahl (Text, Wahrheitswert, Datum als Zeitstempel)',
    type: () => NUM,
    impl: (a) => {
      const v = a[0]!;
      if (v === null) return null;
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (isDate(v)) return v.start;
      const s = txt(v).trim().replace(/\s/g, '');
      if (!s) return null;
      // Deutsche Schreibweise 1.234,5 und englische 1,234.5
      const norm =
        /,\d{1,2}$|,\d+$/.test(s) && !/\.\d+$/.test(s)
          ? s.replace(/\./g, '').replace(',', '.')
          : s.replace(/,/g, '');
      const n = Number(norm);
      return Number.isFinite(n) ? n : null;
    },
  },

  // ---- Text
  length: {
    min: 1,
    max: 1,
    doc: 'Länge von Text oder Anzahl der Listeneinträge',
    type: sig([[TXT, LIST]], NUM),
    impl: (a, env) => (Array.isArray(a[0]) ? a[0].length : [...txt(a[0]!, env)].length),
  },
  substring: {
    min: 2,
    max: 3,
    doc: 'Teil eines Texts (Beginn, Ende exklusiv)',
    type: sig([TXT, NUM, NUM], TXT),
    impl: (a, env) => {
      const chars = [...txt(a[0]!, env)];
      return chars.slice(num(a[1]!), a[2] === undefined ? undefined : num(a[2]!)).join('');
    },
  },
  contains: {
    min: 2,
    max: 2,
    doc: 'Enthält der Text den Suchtext?',
    type: () => BOOL,
    impl: (a, env) =>
      Array.isArray(a[0])
        ? a[0].some((x) => equal(x, a[1]!))
        : txt(a[0]!, env).includes(txt(a[1]!, env)),
  },
  test: {
    min: 2,
    max: 2,
    doc: 'Passt der Text zum regulären Ausdruck?',
    type: sig([TXT, TXT], BOOL),
    impl: (a, env) => safeRegex(txt(a[1]!, env)).test(txt(a[0]!, env)),
  },
  match: {
    min: 2,
    max: 2,
    doc: 'Alle Treffer eines regulären Ausdrucks als Liste',
    type: sig([TXT, TXT], listOf(TXT)),
    impl: (a, env) =>
      txt(a[0]!, env)
        .match(safeRegex(txt(a[1]!, env), 'g'))
        ?.slice(0, 1000) ?? [],
  },
  replace: {
    min: 3,
    max: 3,
    doc: 'Ersten Treffer ersetzen (regulärer Ausdruck)',
    type: sig([TXT, TXT, TXT], TXT),
    impl: (a, env) => capText(txt(a[0]!, env).replace(safeRegex(txt(a[1]!, env)), txt(a[2]!, env))),
  },
  replaceAll: {
    min: 3,
    max: 3,
    doc: 'Alle Treffer ersetzen (regulärer Ausdruck)',
    type: sig([TXT, TXT, TXT], TXT),
    impl: (a, env) =>
      capText(txt(a[0]!, env).replace(safeRegex(txt(a[1]!, env), 'g'), txt(a[2]!, env))),
  },
  lower: {
    min: 1,
    max: 1,
    doc: 'Kleinbuchstaben',
    type: sig([TXT], TXT),
    impl: (a, env) => txt(a[0]!, env).toLowerCase(),
  },
  upper: {
    min: 1,
    max: 1,
    doc: 'Großbuchstaben',
    type: sig([TXT], TXT),
    impl: (a, env) => txt(a[0]!, env).toUpperCase(),
  },
  trim: {
    min: 1,
    max: 1,
    doc: 'Leerzeichen am Rand entfernen',
    type: sig([TXT], TXT),
    impl: (a, env) => txt(a[0]!, env).trim(),
  },
  repeat: {
    min: 2,
    max: 2,
    doc: 'Text wiederholen',
    type: sig([TXT, NUM], TXT),
    impl: (a, env) => {
      const n = Math.max(0, Math.trunc(num(a[1]!)));
      const s = txt(a[0]!, env);
      if (s.length * n > MAX_TEXT) throw new ArgError('Text wird zu lang');
      return s.repeat(n);
    },
  },
  padStart: {
    min: 3,
    max: 3,
    doc: 'Vorne auffüllen bis zur Länge',
    type: sig([TXT, NUM, TXT], TXT),
    impl: (a, env) => txt(a[0]!, env).padStart(Math.min(MAX_TEXT, num(a[1]!)), txt(a[2]!, env)),
  },
  padEnd: {
    min: 3,
    max: 3,
    doc: 'Hinten auffüllen bis zur Länge',
    type: sig([TXT, NUM, TXT], TXT),
    impl: (a, env) => txt(a[0]!, env).padEnd(Math.min(MAX_TEXT, num(a[1]!)), txt(a[2]!, env)),
  },
  startsWith: {
    min: 2,
    max: 2,
    doc: 'Beginnt der Text mit ...?',
    type: sig([TXT, TXT], BOOL),
    impl: (a, env) => txt(a[0]!, env).startsWith(txt(a[1]!, env)),
  },
  endsWith: {
    min: 2,
    max: 2,
    doc: 'Endet der Text mit ...?',
    type: sig([TXT, TXT], BOOL),
    impl: (a, env) => txt(a[0]!, env).endsWith(txt(a[1]!, env)),
  },
  split: {
    min: 1,
    max: 2,
    doc: 'Text an einem Trennzeichen in eine Liste teilen',
    type: sig([TXT, TXT], listOf(TXT)),
    impl: (a, env) =>
      txt(a[0]!, env)
        .split(a[1] === undefined ? ' ' : txt(a[1]!, env))
        .slice(0, 10_000),
  },
  format: {
    min: 1,
    max: 1,
    doc: 'Wert als Text',
    type: () => TXT,
    impl: (a, env) => txt(a[0]!, env),
  },
  link: {
    min: 2,
    max: 2,
    doc: 'Link mit Beschriftung (als Text)',
    type: sig([TXT, TXT], TXT),
    impl: (a, env) => txt(a[0]!, env),
  },
  style: {
    min: 1,
    max: Infinity,
    doc: 'Text gestalten (wird als Text übernommen)',
    type: () => TXT,
    impl: (a, env) => txt(a[0]!, env),
  },
  unstyle: {
    min: 1,
    max: Infinity,
    doc: 'Gestaltung entfernen',
    type: () => TXT,
    impl: (a, env) => txt(a[0]!, env),
  },

  // ---- Datum
  now: {
    min: 0,
    max: 0,
    doc: 'Jetzt',
    type: () => DATE,
    impl: (_a, env) => mkDate(env.now, true),
    volatile: true,
  },
  today: {
    min: 0,
    max: 0,
    doc: 'Heute (ganztägig)',
    type: () => DATE,
    impl: (_a, env) => {
      const p = zonedParts(env.now, env.timeZone);
      return mkDate(Date.UTC(p.year, p.month - 1, p.day), false);
    },
    volatile: true,
  },
  minute: dateField('Minute', (p) => p.minute),
  hour: dateField('Stunde', (p) => p.hour),
  day: dateField('Wochentag (0 = Sonntag)', (p) => p.weekday),
  date: dateField('Tag im Monat', (p) => p.day),
  week: dateField('Kalenderwoche (ISO)', (p) => isoWeek(p.year, p.month, p.day)),
  month: dateField('Monat (1 bis 12)', (p) => p.month),
  year: dateField('Jahr', (p) => p.year),
  dateAdd: {
    min: 3,
    max: 3,
    doc: 'Datum verschieben, z. B. dateAdd(prop("Fällig"), 2, "days")',
    type: sig([DATE, NUM, TXT], DATE),
    impl: (a, env) => {
      if (a[0] === null) return null;
      const d = date(a[0]);
      const n = num(a[1]!);
      const u = unitOf(a[2]!);
      return mkDate(
        addUnit(d.start, n, u, d, env.timeZone),
        d.hasTime,
        d.end === null ? null : addUnit(d.end, n, u, d, env.timeZone),
      );
    },
  },
  dateSubtract: {
    min: 3,
    max: 3,
    doc: 'Datum zurückverschieben',
    type: sig([DATE, NUM, TXT], DATE),
    impl: (a, env) => BUILTINS.dateAdd!.impl([a[0]!, -num(a[1]!), a[2]!], env),
  },
  dateBetween: {
    min: 3,
    max: 3,
    doc: 'Abstand zweier Daten in einer Einheit',
    type: sig([DATE, DATE, TXT], NUM),
    impl: (a, env) =>
      a[0] === null || a[1] === null
        ? null
        : between(date(a[0]), date(a[1]), unitOf(a[2]!), env.timeZone),
  },
  dateRange: {
    min: 2,
    max: 2,
    doc: 'Zeitraum aus Beginn und Ende',
    type: sig([DATE, DATE], DATE),
    impl: (a) => {
      if (a[0] === null) return null;
      const s = date(a[0]);
      const e = a[1] === null ? null : date(a[1]);
      return mkDate(
        s.start,
        s.hasTime || !!e?.hasTime,
        e ? Math.max(e.end ?? e.start, s.start) : null,
      );
    },
  },
  dateStart: {
    min: 1,
    max: 1,
    doc: 'Beginn eines Zeitraums',
    type: sig([DATE], DATE),
    impl: (a) => (a[0] === null ? null : mkDate(date(a[0]).start, date(a[0]).hasTime)),
  },
  dateEnd: {
    min: 1,
    max: 1,
    doc: 'Ende eines Zeitraums',
    type: sig([DATE], DATE),
    impl: (a) => {
      if (a[0] === null) return null;
      const d = date(a[0]);
      return mkDate(d.end ?? d.start, d.hasTime);
    },
  },
  timestamp: {
    min: 1,
    max: 1,
    doc: 'Zeitstempel in Millisekunden',
    type: sig([DATE], NUM),
    impl: (a) => (a[0] === null ? null : date(a[0]).start),
  },
  fromTimestamp: {
    min: 1,
    max: 1,
    doc: 'Datum aus Zeitstempel (ms)',
    type: sig([NUM], DATE),
    impl: (a) => (a[0] === null ? null : mkDate(num(a[0]), true)),
  },
  formatDate: {
    min: 2,
    max: 2,
    doc: 'Datum formatieren, z. B. formatDate(now(), "DD.MM.YYYY HH:mm")',
    type: sig([DATE, TXT], TXT),
    impl: (a, env) => {
      if (a[0] === null) return '';
      const d = date(a[0]);
      return formatDate(d.start, txt(a[1]!, env), d.hasTime ? env.timeZone : 'UTC');
    },
  },
  parseDate: {
    min: 1,
    max: 1,
    doc: 'Text als Datum lesen (ISO, z. B. "2026-11-04")',
    type: sig([TXT], DATE),
    impl: (a, env) => parseDateText(txt(a[0]!, env), env.timeZone),
  },

  // ---- Listen
  at: {
    min: 2,
    max: 2,
    doc: 'Eintrag an Position (negativ von hinten)',
    type: sig([LIST, NUM], elemOfFirst),
    impl: (a) => list(a[0]!).at(Math.trunc(num(a[1]!))) ?? null,
  },
  first: {
    min: 1,
    max: 1,
    doc: 'Erster Eintrag',
    type: sig([LIST], elemOfFirst),
    impl: (a) => list(a[0]!)[0] ?? null,
  },
  last: {
    min: 1,
    max: 1,
    doc: 'Letzter Eintrag',
    type: sig([LIST], elemOfFirst),
    impl: (a) => list(a[0]!).at(-1) ?? null,
  },
  slice: {
    min: 2,
    max: 3,
    doc: 'Teil einer Liste',
    type: sig([LIST, NUM, NUM], listOfFirstElem),
    impl: (a) => list(a[0]!).slice(num(a[1]!), a[2] === undefined ? undefined : num(a[2]!)),
  },
  concat: {
    min: 1,
    max: Infinity,
    doc: 'Listen verbinden',
    type: (a) => (a[0] && isList(a[0]) ? a[0] : LIST),
    impl: (a) => {
      const out = a.flatMap((x) => list(x));
      if (out.length > 100_000) throw new ArgError('Liste wird zu lang');
      return out;
    },
  },
  sort: {
    min: 1,
    max: 1,
    doc: 'Liste sortieren',
    type: sig([LIST], listOfFirstElem),
    impl: (a) => [...list(a[0]!)].sort(compare),
  },
  reverse: {
    min: 1,
    max: 1,
    doc: 'Reihenfolge umkehren',
    type: sig([LIST], listOfFirstElem),
    impl: (a) => [...list(a[0]!)].reverse(),
  },
  join: {
    min: 1,
    max: 2,
    doc: 'Liste zu Text verbinden',
    type: sig([LIST, TXT], TXT),
    impl: (a, env) =>
      capText(
        list(a[0]!)
          .map((x) => txt(x, env))
          .join(a[1] === undefined ? ', ' : txt(a[1]!, env)),
      ),
  },
  includes: {
    min: 2,
    max: 2,
    doc: 'Enthält die Liste den Wert?',
    type: () => BOOL,
    impl: (a) => list(a[0]!).some((x) => equal(x, a[1]!)),
  },
  flat: {
    min: 1,
    max: 1,
    doc: 'Verschachtelte Listen eine Ebene flach machen',
    type: (a) => (a[0] && isList(a[0]) && isList(a[0].list) ? a[0].list : LIST),
    impl: (a) => list(a[0]!).flatMap((x) => list(x)),
  },
  unique: {
    min: 1,
    max: 1,
    doc: 'Doppelte Einträge entfernen',
    type: sig([LIST], listOfFirstElem),
    impl: (a) => list(a[0]!).filter((x, i, all) => all.findIndex((y) => equal(x, y)) === i),
  },
  count: {
    min: 1,
    max: 1,
    doc: 'Anzahl der Einträge',
    type: sig([LIST], NUM),
    impl: (a) => list(a[0]!).length,
  },

  // ---- Personen und Seiten
  name: {
    min: 1,
    max: 1,
    doc: 'Name einer Person',
    type: () => TXT,
    impl: (a) => {
      const v = a[0]!;
      if (Array.isArray(v)) return v.map((x) => (isPerson(x) ? x.name : txt(x))).join(', ');
      return isPerson(v) ? v.name : isPage(v) ? v.title : txt(v);
    },
  },
  email: {
    min: 1,
    max: 1,
    doc: 'E-Mail einer Person',
    type: () => TXT,
    impl: (a) => (isPerson(a[0]!) ? (a[0] as { email: string }).email : null),
  },
  id: {
    min: 0,
    max: 1,
    doc: 'ID einer Seite (ohne Argument: dieser Zeile)',
    type: () => TXT,
    impl: (a) => (a[0] && isPage(a[0]) ? a[0].id : null),
  },
};

/** ISO-Kalenderwoche */
function isoWeek(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
}

export function truthy(v: Value): boolean {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** + : Zahlen addieren, sonst Text verketten (wie Notion), Listen verbinden. */
export function plus(a: Value, b: Value, env: EvalEnv): Value {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (typeof a === 'string' || typeof b === 'string') return capText(txt(a, env) + txt(b, env));
  if (a === null && b === null) return null;
  return finite(num(a) + num(b));
}

export { formatNumber };
