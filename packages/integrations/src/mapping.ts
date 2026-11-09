import { createHash } from 'node:crypto';
import {
  RECORD_FIELDS,
  TEMPLATE_SOURCE,
  type Mapping,
  type MappingField,
  type OptionColor,
  type PropertyType,
  type PropertyValue,
} from '@jotion/shared';
import type { DateField, ExternalRecord, FieldValue, RecordKind } from './sdk';

/**
 * Mapping-Engine (Phase 8): normalisierte Felder eines Datensatzes in Werte von Properties.
 * Die Umwandlung ergibt sich aus Feldwert und Zieltyp:
 * Text→Auswahl (Option per Name, optional neu angelegt), Datum/Zeit→Datum, Wahrheitswert→Checkbox
 * oder Status, Text→URL (nur http/https), Vorlage ("{{categories}}: {{title}}") → Text.
 */

export interface MapProperty {
  id: string;
  name: string;
  type: PropertyType;
  config: unknown;
}

/** Ziel "title" oder ein Property */
export type MappedValues = Map<string, PropertyValue>;

export interface MapResult {
  values: MappedValues;
  /** Fehlende Optionsnamen je Property (bei autoCreateOptions) */
  missingOptions: Map<string, string[]>;
  errors: string[];
}

/** Property-Typen, die als Ziel möglich sind */
export const MAPPABLE_TYPES: PropertyType[] = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
];

interface Option {
  id: string;
  name: string;
  group?: string;
}
const optionsOf = (p: MapProperty): Option[] => {
  const cfg = p.config as { options?: Option[] } | null;
  return Array.isArray(cfg?.options) ? cfg.options : [];
};
const norm = (s: string) => s.trim().toLowerCase();

const isDateField = (v: FieldValue): v is DateField =>
  !!v && typeof v === 'object' && !Array.isArray(v) && 'start' in v;

/** Feldwert als Text (für Text-Properties und Vorlagen). */
export function fieldText(v: FieldValue | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v === '' ? null : v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nein';
  if (Array.isArray(v)) return v.length ? v.join(', ') : null;
  if (isDateField(v)) return v.end ? `${v.start} – ${v.end}` : v.start;
  return null;
}

export function renderTemplate(template: string, fields: Record<string, FieldValue>): string {
  return template
    .replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, k: string) => fieldText(fields[k]) ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–-]+|[\s:–-]+$/g, '')
    .trim();
}

function toDate(v: FieldValue): PropertyValue {
  if (isDateField(v)) return { start: v.start, end: v.end, hasTime: v.hasTime, timeZone: null };
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))
    return { start: v, end: null, hasTime: v.includes('T'), timeZone: null };
  return null;
}

function truthy(v: FieldValue): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string')
    return ['true', 'yes', 'ja', '1', 'completed', 'done', 'erledigt'].includes(norm(v));
  return null;
}

function optionNames(v: FieldValue, f: MappingField, prop: MapProperty): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v === 'boolean') {
    const named = v ? f.trueOption : f.falseOption;
    if (named) return [named];
    if (prop.type === 'status') {
      const group = v ? 'complete' : 'todo';
      const o = optionsOf(prop).find((x) => x.group === group);
      return o ? [o.name] : [];
    }
    return [v ? 'Ja' : 'Nein'];
  }
  if (Array.isArray(v)) return v.map(String).filter((s) => s.trim());
  const t = fieldText(v);
  return t ? [t] : [];
}

/** Wert eines Feldes für ein Property. */
function convert(
  v: FieldValue,
  f: MappingField,
  prop: MapProperty,
  missing: (name: string) => void,
): PropertyValue {
  switch (prop.type) {
    case 'text':
    case 'email':
    case 'phone':
      return fieldText(v);
    case 'url': {
      const t = fieldText(v);
      return t && /^https?:\/\//i.test(t) ? t : null;
    }
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      return truthy(v) === true;
    case 'date':
      return toDate(v);
    case 'select':
    case 'status':
    case 'multi_select': {
      const opts = optionsOf(prop);
      const ids: string[] = [];
      for (const name of optionNames(v, f, prop).map((n) => n.trim().slice(0, 100))) {
        const o = opts.find((x) => norm(x.name) === norm(name));
        if (o) ids.push(o.id);
        else if (f.autoCreateOptions && prop.type !== 'status') missing(name);
      }
      const unique = [...new Set(ids)];
      if (prop.type === 'multi_select') return unique;
      return unique[0] ?? null;
    }
    default:
      return null;
  }
}

/** Werte eines Datensatzes nach Mapping. Felder ohne passendes Property werden übersprungen. */
export function mapRecord(
  record: ExternalRecord,
  mapping: Mapping,
  props: MapProperty[],
): MapResult {
  const byId = new Map(props.map((p) => [p.id, p]));
  const values: MappedValues = new Map();
  const missingOptions = new Map<string, string[]>();
  const errors: string[] = [];
  for (const f of mapping.fields) {
    const raw: FieldValue =
      f.source === TEMPLATE_SOURCE
        ? renderTemplate(f.template ?? '', record.fields)
        : (record.fields[f.source] ?? null);
    if (f.target === 'title') {
      values.set('title', (fieldText(raw) ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000));
      continue;
    }
    const prop = byId.get(f.target);
    if (!prop) {
      errors.push(`Property ${f.target} existiert nicht mehr`);
      continue;
    }
    if (!MAPPABLE_TYPES.includes(prop.type)) {
      errors.push(`Property "${prop.name}" (${prop.type}) kann nicht befüllt werden`);
      continue;
    }
    const miss: string[] = [];
    const v = convert(raw, f, prop, (n) => miss.push(n));
    if (miss.length)
      missingOptions.set(prop.id, [...new Set([...(missingOptions.get(prop.id) ?? []), ...miss])]);
    values.set(prop.id, v);
  }
  return { values, missingOptions, errors };
}

/** Fehlende Optionen über alle Datensätze (Name in Originalschreibweise, ohne Dubletten). */
export function collectMissingOptions(
  records: ExternalRecord[],
  mapping: Mapping,
  props: MapProperty[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of records)
    for (const [pid, names] of mapRecord(r, mapping, props).missingOptions) {
      const list = out.get(pid) ?? [];
      for (const n of names) if (!list.some((x) => norm(x) === norm(n))) list.push(n);
      out.set(pid, list);
    }
  return out;
}

const COLORS: OptionColor[] = [
  'blue',
  'green',
  'orange',
  'purple',
  'pink',
  'yellow',
  'red',
  'brown',
  'gray',
];
/** Farbe einer neuen Option, stabil aus dem Namen */
export function optionColor(name: string): OptionColor {
  const h = createHash('sha1').update(norm(name)).digest();
  return COLORS[h[0]! % COLORS.length]!;
}

/** Hash des Mappings: ändert es sich, werden alle Datensätze neu angewendet. */
export function mappingHash(mapping: Mapping, options: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([mapping, options]))
    .digest('hex')
    .slice(0, 16);
}

// ------------------------------------------------------------------ Vergleich

/** Vergleichbare Darstellung eines Werts (Datum in ms, Listen sortiert, leer = null). */
export function canonical(type: PropertyType | 'title', v: unknown): string {
  if (v === undefined || v === null || v === '') return 'null';
  switch (type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return JSON.stringify(String(v));
    case 'checkbox':
      return v === true ? 'true' : 'null';
    case 'multi_select':
      return Array.isArray(v) && v.length ? JSON.stringify([...v].map(String).sort()) : 'null';
    case 'date': {
      const d = v as { start?: string; end?: string | null; hasTime?: boolean };
      if (!d.start) return 'null';
      const ms = (s: string) =>
        d.hasTime ? Date.parse(s) : Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
      return JSON.stringify([ms(d.start), d.end ? ms(d.end) : null, Boolean(d.hasTime)]);
    }
    default:
      return JSON.stringify(v);
  }
}

// ------------------------------------------------------------------ Vorschläge

export interface SuggestedProperty {
  key: string;
  name: string;
  type: PropertyType;
  options?: { name: string; color: OptionColor }[];
}

/** Properties einer neuen Ziel-Datenbank je nach Art der Datensätze. */
export function suggestedProperties(kinds: RecordKind[]): SuggestedProperty[] {
  const onlyFiles = kinds.length > 0 && kinds.every((k) => k === 'file');
  const out: SuggestedProperty[] = [
    {
      key: 'date',
      name: onlyFiles ? 'Geändert' : kinds.includes('message') ? 'Eingang' : 'Datum',
      type: 'date',
    },
  ];
  if (kinds.includes('task')) out.push({ key: 'completed', name: 'Erledigt', type: 'checkbox' });
  if (kinds.includes('event')) out.push({ key: 'location', name: 'Ort', type: 'text' });
  if (kinds.includes('message')) {
    out.push({ key: 'from', name: 'Von', type: 'text' });
    out.push({ key: 'read', name: 'Gelesen', type: 'checkbox' });
  }
  if (kinds.includes('file')) {
    out.push({ key: 'path', name: 'Pfad', type: 'text' });
    out.push({ key: 'size', name: 'Größe (Bytes)', type: 'number' });
    out.push({ key: 'mime', name: 'Dateityp', type: 'select' });
  }
  if (!onlyFiles) out.push({ key: 'categories', name: 'Kategorien', type: 'multi_select' });
  if (kinds.includes('task')) out.push({ key: 'priority', name: 'Priorität', type: 'number' });
  out.push({ key: 'url', name: 'Link', type: 'url' });
  out.push({ key: 'source', name: 'Quelle', type: 'select' });
  out.push({
    key: 'syncStatus',
    name: 'Sync-Status',
    type: 'select',
    options: [
      { name: SYNC_STATUS_ACTIVE, color: 'green' },
      { name: SYNC_STATUS_REMOVED, color: 'red' },
    ],
  });
  return out;
}

export const SYNC_STATUS_ACTIVE = 'Aktiv';
export const SYNC_STATUS_REMOVED = 'Entfernt';

const NAME_HINTS: Record<string, RegExp> = {
  date: /datum|date|termin|fällig|due|wann|zeit/i,
  completed: /erledigt|done|fertig|abgeschlossen|status/i,
  location: /ort|raum|location|wo\b/i,
  categories: /kategor|fach|tag|categor|thema/i,
  priority: /prior/i,
  url: /link|url/i,
  source: /quelle|source|kalender/i,
  description: /beschreib|notiz|description|details/i,
  organizer: /organis|lehrer|veranstalt/i,
  from: /von|absender|from|sender/i,
  to: /an\b|empfänger|to\b|recipient/i,
  read: /gelesen|read/i,
  path: /pfad|path|ordner/i,
  size: /größe|groesse|size/i,
  mime: /typ|type|format/i,
};

const TYPE_FOR: Record<string, PropertyType[]> = {
  date: ['date'],
  completed: ['checkbox', 'status'],
  location: ['text'],
  categories: ['multi_select', 'select'],
  priority: ['number', 'select'],
  url: ['url'],
  source: ['select', 'text'],
  description: ['text'],
  organizer: ['text', 'select'],
  from: ['text', 'email', 'select'],
  to: ['text', 'email'],
  read: ['checkbox'],
  path: ['text'],
  size: ['number'],
  mime: ['select', 'text'],
};

/** Mapping-Vorschlag für eine bestehende Datenbank: passende Typen, Name als Hinweis. */
export function suggestMapping(kinds: RecordKind[], props: MapProperty[]): Mapping {
  const fields: MappingField[] = [
    { source: 'title', target: 'title', ownership: 'local_preserve', autoCreateOptions: true },
  ];
  const used = new Set<string>();
  const available = new Set<string>(kinds.flatMap((k) => [...RECORD_FIELDS[k]]));
  available.add('source');
  for (const key of Object.keys(TYPE_FOR)) {
    if (!available.has(key)) continue;
    const candidates = props.filter((p) => TYPE_FOR[key]!.includes(p.type) && !used.has(p.id));
    const p =
      candidates.find((c) => NAME_HINTS[key]!.test(c.name)) ??
      // Datum und Erledigt auch ohne passenden Namen (meist eindeutig)
      (key === 'date' || (key === 'completed' && kinds.includes('task'))
        ? candidates.find((c) => c.type === TYPE_FOR[key]![0])
        : undefined);
    if (!p || /sync-status/i.test(p.name)) continue;
    used.add(p.id);
    fields.push({
      source: key,
      target: p.id,
      ownership: 'local_preserve',
      autoCreateOptions: true,
    });
  }
  const status = props.find((p) => p.type === 'select' && /sync-status/i.test(p.name));
  return { fields, descriptionToContent: true, syncStatusPropertyId: status?.id ?? null };
}
