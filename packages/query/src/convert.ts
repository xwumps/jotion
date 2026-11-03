import {
  OPTION_COLORS,
  parsePropertyConfig,
  validatePropertyValue,
  type DateValue,
  type FileValue,
  type PropertyConfig,
  type PropertyType,
  type PropertyValue,
  type SelectOption,
  type StatusOption,
} from '@jotion/shared';

/**
 * Konvertierungsregeln beim Wechsel des Property-Typs.
 * Grundidee: jeder Wert wird zuerst in Text-Bausteine (Token) übersetzt und dann im Zieltyp
 * gelesen. Optionen bleiben beim Wechsel zwischen Select, Multi-Select und Status erhalten
 * (gleiche IDs und Farben), aus Text entstehen neue Optionen. Was sich nicht übertragen lässt,
 * wird leer. Das Ergebnis besteht immer die Validierung des Zieltyps.
 */

export interface ConversionContext {
  newId: () => string;
  userName?: (id: string) => string | undefined;
  /** Namen der Standard-Status (Zu erledigen, In Bearbeitung, Erledigt) */
  statusLabels?: [string, string, string];
  /** Antworten für Checkbox nach Text */
  yesNo?: [string, string];
}

export interface ConversionInput {
  from: { type: PropertyType; config: unknown };
  to: { type: PropertyType; config?: unknown };
  values: { rowId: string; value: unknown }[];
}

export interface ConversionResult {
  config: PropertyConfig;
  values: { rowId: string; value: PropertyValue }[];
}

/** Typen, aus und in die konvertiert werden kann. */
export function canConvert(from: PropertyType, to: PropertyType): boolean {
  const blocked: PropertyType[] = ['title', 'relation', 'rollup', 'formula'];
  return from !== to && !blocked.includes(from) && !blocked.includes(to);
}

const SELECT_LIKE: PropertyType[] = ['select', 'multi_select', 'status'];
const TRUE_WORDS = ['true', 'yes', 'ja', 'y', 'j', '1', 'x', 'checked', 'wahr', '✓', '✔'];

type Opt = { id: string; name: string; color: (typeof OPTION_COLORS)[number] };

function sourceOptions(type: PropertyType, config: unknown): Opt[] {
  if (!SELECT_LIKE.includes(type)) return [];
  try {
    return (parsePropertyConfig(type, config) as { options: Opt[] }).options;
  } catch {
    return [];
  }
}

function formatDate(d: DateValue): string {
  const one = (s: string) =>
    d.hasTime ? new Date(s).toISOString().slice(0, 16).replace('T', ' ') : s;
  return d.end ? `${one(d.start)} - ${one(d.end)}` : one(d.start);
}

/** Wert als Text-Bausteine. */
function tokens(
  type: PropertyType,
  value: unknown,
  options: Opt[],
  ctx: ConversionContext,
): string[] {
  if (value === null || value === undefined) return [];
  const optName = (id: unknown) => options.find((o) => o.id === id)?.name;
  switch (type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof value === 'string' && value.trim() ? [value] : [];
    case 'number':
    case 'unique_id':
      return typeof value === 'number' ? [String(value)] : [];
    case 'select':
    case 'status': {
      const n = optName(value);
      return n ? [n] : [];
    }
    case 'multi_select':
      return (value as string[]).map(optName).filter((n): n is string => Boolean(n));
    case 'checkbox':
      return [value === true ? (ctx.yesNo?.[0] ?? 'Yes') : (ctx.yesNo?.[1] ?? 'No')];
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return typeof value === 'object' ? [formatDate(value as DateValue)] : [];
    case 'person':
    case 'created_by':
    case 'last_edited_by': {
      const ids = Array.isArray(value) ? (value as string[]) : [String(value)];
      return ids.map((id) => ctx.userName?.(id)).filter((n): n is string => Boolean(n));
    }
    case 'files':
      return (value as FileValue[]).map((f) => (f.type === 'external' ? f.url : f.name));
    default:
      return [];
  }
}

function parseNumber(s: string): number | null {
  let t = s.trim().replace(/[\s€$£¥%]/g, '');
  // Deutsche Schreibweise 1.234,5 bzw. 3,5
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.');
  else t = t.replace(/,(?=\d{3}\b)/g, '');
  if (!/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseDate(s: string): DateValue | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return { start: t, end: null, hasTime: false, timeZone: null };
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) {
    const day = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    return { start: day, end: null, hasTime: false, timeZone: null };
  }
  m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/.exec(t);
  if (m) {
    const iso = `${m[1]}T${m[2]}${m[3] ?? ':00'}${m[4] ?? 'Z'}`;
    if (Number.isNaN(Date.parse(iso))) return null;
    return { start: new Date(iso).toISOString(), end: null, hasTime: true, timeZone: null };
  }
  return null;
}

/** Prüft einen Kandidaten gegen den Zieltyp; ungültig wird leer. */
function safe(prop: { type: PropertyType; config: unknown }, candidate: unknown): PropertyValue {
  try {
    return validatePropertyValue({ id: 'x', ...prop }, candidate);
  } catch {
    return validatePropertyValue({ id: 'x', ...prop }, emptyOf(prop.type));
  }
}

function emptyOf(type: PropertyType): unknown {
  if (type === 'multi_select' || type === 'person' || type === 'files') return [];
  if (type === 'checkbox') return false;
  return null;
}

/** Konvertiert alle Werte eines Properties in den Zieltyp. */
export function convertProperty(input: ConversionInput, ctx: ConversionContext): ConversionResult {
  const { from, to } = input;
  if (!canConvert(from.type, to.type))
    throw new Error(`Konvertierung ${from.type} nach ${to.type} nicht möglich`);
  const srcOptions = sourceOptions(from.type, from.config);
  const toks = input.values.map((v) => {
    // Zeitstempel der Seite (ISO-String) wie ein Datum mit Uhrzeit behandeln
    const raw =
      (from.type === 'created_time' || from.type === 'last_edited_time') &&
      typeof v.value === 'string'
        ? { start: new Date(v.value).toISOString(), end: null, hasTime: true, timeZone: null }
        : v.value;
    return { rowId: v.rowId, raw, t: tokens(from.type, raw, srcOptions, ctx) };
  });

  // Werte, die keine Speicherung brauchen (aus der Seite abgeleitet bzw. vom Server vergeben)
  if (
    ['created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'unique_id'].includes(
      to.type,
    )
  ) {
    const config = parsePropertyConfig(to.type, to.config ?? {});
    return { config, values: input.values.map((v) => ({ rowId: v.rowId, value: null })) };
  }

  if (SELECT_LIKE.includes(to.type)) {
    // Optionen: vorhandene behalten, neue aus Text-Bausteinen
    const options: Opt[] = srcOptions.map((o) => ({ ...o }));
    const byName = new Map(options.map((o) => [o.name.toLowerCase(), o]));
    const colors = OPTION_COLORS.filter((c) => c !== 'default');
    const idsFor = (names: string[]): string[] => {
      const out: string[] = [];
      for (const raw of names) {
        const name = raw.trim().slice(0, 100);
        if (!name) continue;
        let o = byName.get(name.toLowerCase());
        if (!o) {
          if (options.length >= 500) continue;
          o = { id: ctx.newId(), name, color: colors[options.length % colors.length]! };
          options.push(o);
          byName.set(name.toLowerCase(), o);
        }
        if (!out.includes(o.id)) out.push(o.id);
      }
      return out;
    };
    const split = (t: string[]) =>
      SELECT_LIKE.includes(from.type) ? t : t.flatMap((s) => s.split(','));
    const mapped = toks.map((x) => {
      // Optionen aus Select-Typen über ihre ID übernehmen (Namen sind ohnehin eindeutig)
      const ids = SELECT_LIKE.includes(from.type)
        ? (from.type === 'multi_select'
            ? ((x.raw as string[] | null) ?? [])
            : x.raw
              ? [String(x.raw)]
              : []
          ).filter((id) => options.some((o) => o.id === id))
        : idsFor(split(x.t));
      return { rowId: x.rowId, ids };
    });
    let config: PropertyConfig;
    if (to.type === 'status') {
      const prevGroups = new Map(
        from.type === 'status'
          ? (parsePropertyConfig('status', from.config) as { options: StatusOption[] }).options.map(
              (o) => [o.id, o.group],
            )
          : [],
      );
      let statusOptions: StatusOption[] = options.map((o) => ({
        ...o,
        group: prevGroups.get(o.id) ?? 'todo',
      }));
      if (statusOptions.length === 0) {
        const [a, b, c] = ctx.statusLabels ?? ['Not started', 'In progress', 'Done'];
        statusOptions = [
          { id: ctx.newId(), name: a, color: 'default', group: 'todo' },
          { id: ctx.newId(), name: b, color: 'blue', group: 'in_progress' },
          { id: ctx.newId(), name: c, color: 'green', group: 'complete' },
        ];
      }
      config = parsePropertyConfig('status', { options: statusOptions });
    } else {
      config = parsePropertyConfig(to.type, { options: options as SelectOption[] });
    }
    const prop = { type: to.type, config };
    return {
      config,
      values: mapped.map((m) => ({
        rowId: m.rowId,
        value: safe(prop, to.type === 'multi_select' ? m.ids : (m.ids[0] ?? null)),
      })),
    };
  }

  const config = parsePropertyConfig(
    to.type,
    to.type === 'number' && from.type === 'number' ? from.config : (to.config ?? {}),
  );
  const prop = { type: to.type, config };
  const one = (x: { raw: unknown; t: string[] }): unknown => {
    switch (to.type) {
      case 'text':
      case 'url':
      case 'email':
      case 'phone':
        return x.t.length ? x.t.join(', ') : null;
      case 'number':
        if (from.type === 'unique_id' || from.type === 'number')
          return typeof x.raw === 'number' ? x.raw : null;
        if (from.type === 'checkbox') return x.raw === true ? 1 : 0;
        return x.t.length === 1 ? parseNumber(x.t[0]!) : null;
      case 'checkbox':
        if (from.type === 'number' || from.type === 'unique_id')
          return typeof x.raw === 'number' && x.raw !== 0;
        return x.t.some((s) => TRUE_WORDS.includes(s.trim().toLowerCase()));
      case 'date':
        if (from.type === 'created_time' || from.type === 'last_edited_time') return x.raw;
        return x.t.length === 1 ? parseDate(x.t[0]!) : null;
      case 'person':
        if (from.type === 'created_by' || from.type === 'last_edited_by')
          return x.raw ? [String(x.raw)] : [];
        return [];
      case 'files':
        if (from.type === 'url' && typeof x.raw === 'string' && /^https?:\/\//i.test(x.raw))
          return [{ type: 'external', url: x.raw.trim(), name: x.raw.trim().slice(0, 255) }];
        return [];
      default:
        return null;
    }
  };
  return {
    config,
    values: toks.map((x) => ({ rowId: x.rowId, value: safe(prop, one(x)) })),
  };
}
