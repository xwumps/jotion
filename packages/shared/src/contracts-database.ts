/**
 * Phase 4: Verträge für Datenbanken (Properties, Werte, Filter, Sortierung, Ansichten).
 * Gleiche Schemas in API (Validierung) und Oberfläche (Typen, Editoren).
 */
import { z } from 'zod';
import type { PageCover, PageIcon, PageScope } from './contracts';

const id = z.uuid();

// ---------------------------------------------------------------- Property-Typen

export const PROPERTY_TYPES = [
  'title',
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'checkbox',
  'url',
  'email',
  'phone',
  'files',
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
  'unique_id',
  'relation',
  'rollup',
  'formula',
  'button',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Anlegbare Typen (title gibt es genau einmal). */
export const CREATABLE_PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'checkbox',
  'url',
  'email',
  'phone',
  'files',
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
  'unique_id',
  'relation',
  'rollup',
  'formula',
  'button',
] as const satisfies readonly PropertyType[];
export type CreatablePropertyType = (typeof CREATABLE_PROPERTY_TYPES)[number];

/** Werte stammen aus der Zeilenseite (pages), nicht aus property_values. */
export const PAGE_DERIVED_TYPES = [
  'title',
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
] as const satisfies readonly PropertyType[];

/** Nicht von Hand änderbare Werte. */
export const READONLY_PROPERTY_TYPES: readonly PropertyType[] = [
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
  'unique_id',
  'rollup',
  'formula',
  'button',
];

export const isReadonlyType = (t: PropertyType) => READONLY_PROPERTY_TYPES.includes(t);
export const isPageDerivedType = (t: PropertyType) =>
  (PAGE_DERIVED_TYPES as readonly PropertyType[]).includes(t);

export const OPTION_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export const STATUS_GROUPS = ['todo', 'in_progress', 'complete'] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export const NUMBER_FORMATS = [
  'number',
  'number_with_commas',
  'percent',
  'euro',
  'dollar',
  'pound',
  'yen',
  'franc',
] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const DATE_FORMATS = ['full', 'short', 'iso', 'month_day_year', 'day_month_year'] as const;
export const TIME_FORMATS = ['24h', '12h'] as const;

const optionName = z.string().trim().min(1).max(100);

export const selectOptionSchema = z.object({
  id,
  name: optionName,
  color: z.enum(OPTION_COLORS).default('default'),
});
export type SelectOption = z.infer<typeof selectOptionSchema>;

export const statusOptionSchema = selectOptionSchema.extend({
  group: z.enum(STATUS_GROUPS),
});
export type StatusOption = z.infer<typeof statusOptionSchema>;

const MAX_OPTIONS = 500;

/** Optionsnamen und IDs müssen eindeutig sein. */
function uniqueOptions<T extends { id: string; name: string }>(options: T[], ctx: z.RefinementCtx) {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const o of options) {
    if (ids.has(o.id)) ctx.addIssue({ code: 'custom', message: `Doppelte Option ${o.id}` });
    if (names.has(o.name.toLowerCase()))
      ctx.addIssue({ code: 'custom', message: `Doppelter Optionsname ${o.name}` });
    ids.add(o.id);
    names.add(o.name.toLowerCase());
  }
}

/** Ergebnistyp berechneter Properties (Formel, Rollup). */
export const RESULT_TYPES = [
  'number',
  'text',
  'boolean',
  'date',
  'list',
  'person',
  'page',
  'empty',
] as const;
export type ResultType = (typeof RESULT_TYPES)[number];

export const ROLLUP_AGGREGATIONS = [
  'show_original',
  'show_unique',
  'count_all',
  'count_values',
  'count_unique',
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'earliest_date',
  'latest_date',
  'date_range',
  'checked',
  'unchecked',
  'percent_checked',
  'percent_unchecked',
] as const;
export type RollupAggregation = (typeof ROLLUP_AGGREGATIONS)[number];

/** Welche Aggregationen zu welchem Ziel-Typ passen (für die Oberfläche und die Prüfung). */
export function rollupAggregationsFor(type: PropertyType): RollupAggregation[] {
  const base: RollupAggregation[] = [
    'show_original',
    'show_unique',
    'count_all',
    'count_values',
    'count_unique',
    'count_empty',
    'count_not_empty',
    'percent_empty',
    'percent_not_empty',
  ];
  switch (type) {
    case 'number':
    case 'unique_id':
    case 'formula':
    case 'rollup':
      return [...base, 'sum', 'average', 'median', 'min', 'max', 'range'];
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return [...base, 'earliest_date', 'latest_date', 'date_range'];
    case 'checkbox':
      return [...base, 'checked', 'unchecked', 'percent_checked', 'percent_unchecked'];
    default:
      return base;
  }
}

/** Höchstzahl verknüpfter Zeilen je Relation und Zeile */
export const MAX_RELATION_LINKS = 1000;

export const propertyConfigSchemas = {
  title: z.object({}).strict(),
  text: z.object({}).strict(),
  number: z
    .object({
      format: z.enum(NUMBER_FORMATS).default('number'),
      precision: z.number().int().min(0).max(8).nullable().default(null),
    })
    .strict(),
  select: z
    .object({ options: z.array(selectOptionSchema).max(MAX_OPTIONS).default([]) })
    .strict()
    .superRefine((c, ctx) => uniqueOptions(c.options, ctx)),
  multi_select: z
    .object({ options: z.array(selectOptionSchema).max(MAX_OPTIONS).default([]) })
    .strict()
    .superRefine((c, ctx) => uniqueOptions(c.options, ctx)),
  status: z
    .object({ options: z.array(statusOptionSchema).min(1).max(MAX_OPTIONS) })
    .strict()
    .superRefine((c, ctx) => uniqueOptions(c.options, ctx)),
  date: z
    .object({
      dateFormat: z.enum(DATE_FORMATS).default('full'),
      timeFormat: z.enum(TIME_FORMATS).default('24h'),
    })
    .strict(),
  person: z.object({}).strict(),
  checkbox: z.object({}).strict(),
  url: z.object({}).strict(),
  email: z.object({}).strict(),
  phone: z.object({}).strict(),
  files: z.object({}).strict(),
  created_time: z.object({}).strict(),
  created_by: z.object({}).strict(),
  last_edited_time: z.object({}).strict(),
  last_edited_by: z.object({}).strict(),
  unique_id: z
    .object({
      prefix: z
        .string()
        .trim()
        .max(10)
        .regex(/^[A-Za-z0-9]*$/)
        .nullable()
        .default(null),
      /** vom Server gepflegt */
      nextValue: z.number().int().min(1).default(1),
    })
    .strict(),
  // Phase 6: Relation, Rollup, Formel
  relation: z
    .object({
      targetDatabaseId: id,
      /** Zweiseitig: Gegen-Property in der Zieldatenbank (vom Server gepflegt) */
      twoWay: z.boolean().default(false),
      reversePropertyId: id.nullable().default(null),
      limit: z.enum(['one', 'many']).default('many'),
    })
    .strict(),
  rollup: z
    .object({
      relationPropertyId: id,
      targetPropertyId: id,
      aggregation: z.enum(ROLLUP_AGGREGATIONS).default('show_original'),
      /** vom Server ermittelt */
      resultType: z.enum(RESULT_TYPES).default('empty'),
    })
    .strict(),
  formula: z
    .object({
      expression: z.string().max(10_000),
      /** vom Server ermittelt: Ergebnistyp, Fehler der letzten Prüfung, now()/today() */
      resultType: z.enum(RESULT_TYPES).default('empty'),
      error: z.string().max(500).nullable().default(null),
      volatile: z.boolean().default(false),
    })
    .strict(),
  /** Phase 9: Klick löst die Automatisierung für die Zeile aus */
  button: z
    .object({
      label: z.string().trim().max(60).default(''),
      automationId: id.nullable().default(null),
    })
    .strict(),
} satisfies Record<PropertyType, z.ZodType>;

export type PropertyConfig<T extends PropertyType = PropertyType> = z.output<
  (typeof propertyConfigSchemas)[T]
>;
export type NumberConfig = PropertyConfig<'number'>;
export type SelectConfig = PropertyConfig<'select'>;
export type StatusConfig = PropertyConfig<'status'>;
export type UniqueIdConfig = PropertyConfig<'unique_id'>;

/** Validiert und normalisiert die Konfiguration eines Typs (Standardwerte werden ergänzt). */
export function parsePropertyConfig(type: PropertyType, config: unknown): PropertyConfig {
  return propertyConfigSchemas[type].parse(config ?? {}) as PropertyConfig;
}

/** Standard-Optionen eines neuen Status-Properties (wie bei Notion). */
export function defaultStatusOptions(newId: () => string, labels: [string, string, string]) {
  return [
    { id: newId(), name: labels[0], color: 'default' as const, group: 'todo' as const },
    { id: newId(), name: labels[1], color: 'blue' as const, group: 'in_progress' as const },
    { id: newId(), name: labels[2], color: 'green' as const, group: 'complete' as const },
  ];
}

// ---------------------------------------------------------------- Werte

export const TEXT_MAX = 10_000;
export const URL_MAX = 2000;
export const MAX_MULTI_VALUES = 100;
export const MAX_FILES = 20;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-./\s#*]{1,50}$/;

function validDay(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Datum: ganztägig (YYYY-MM-DD) oder mit Uhrzeit (ISO mit Zeitzone). */
export const dateValueSchema = z
  .object({
    start: z.string(),
    end: z.string().nullable().default(null),
    hasTime: z.boolean().default(false),
    timeZone: z.string().max(64).nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    const check = (s: string, key: 'start' | 'end') => {
      const ok = v.hasTime
        ? ISO_DATETIME.test(s) && !Number.isNaN(Date.parse(s))
        : ISO_DATE.test(s) && validDay(s);
      if (!ok) ctx.addIssue({ code: 'custom', path: [key], message: 'Ungültiges Datum' });
      return ok;
    };
    const a = check(v.start, 'start');
    if (v.end !== null && check(v.end, 'end') && a) {
      if (dateValueMs(v.end, v.hasTime) < dateValueMs(v.start, v.hasTime))
        ctx.addIssue({ code: 'custom', path: ['end'], message: 'Ende liegt vor dem Beginn' });
    }
  });
export type DateValue = z.output<typeof dateValueSchema>;

/** Zeitpunkt eines Datumswerts in ms (ganztägige Daten: Mitternacht UTC). */
export function dateValueMs(s: string, hasTime: boolean): number {
  return hasTime ? Date.parse(s) : Date.parse(`${s}T00:00:00Z`);
}

export const fileValueSchema = z.union([
  z.object({ type: z.literal('file'), fileId: id, name: z.string().max(255) }).strict(),
  z
    .object({
      type: z.literal('external'),
      url: z
        .string()
        .trim()
        .max(URL_MAX)
        .regex(/^https?:\/\//i),
      name: z.string().max(255),
    })
    .strict(),
]);
export type FileValue = z.infer<typeof fileValueSchema>;

/** Werte je Typ im API-Format (null = leer). */
export interface PropertyValueMap {
  title: string;
  text: string | null;
  number: number | null;
  select: string | null;
  multi_select: string[];
  status: string | null;
  date: DateValue | null;
  person: string[];
  checkbox: boolean;
  url: string | null;
  email: string | null;
  phone: string | null;
  files: FileValue[];
  created_time: string;
  created_by: string;
  last_edited_time: string;
  last_edited_by: string;
  unique_id: number | null;
  relation: string[];
  rollup: ComputedValue;
  formula: ComputedValue;
  button: null;
}
export type PropertyValue = PropertyValueMap[PropertyType] | null;

/**
 * Ergebnis einer Formel oder eines Rollups im API-Format: Zahl, Text, Wahrheitswert, Datum
 * (wie das Datums-Property), Person { id, name }, Seite { id, title } oder Liste davon.
 */
export type ComputedItem =
  | number
  | string
  | boolean
  | DateValue
  | { kind: 'person'; id: string; name: string }
  | { kind: 'page'; id: string; title: string };
export type ComputedValue = ComputedItem | ComputedItem[] | null;

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((s) => (s === null || s.trim() === '' ? null : s));

/** Eingabeschemas je Typ (vor der Prüfung gegen die Konfiguration). */
export const propertyValueSchemas = {
  title: z.string().max(2000),
  text: optionalText(TEXT_MAX),
  number: z.number().finite().nullable(),
  select: id.nullable(),
  multi_select: z.array(id).max(MAX_MULTI_VALUES),
  status: id.nullable(),
  date: dateValueSchema.nullable(),
  person: z.array(id).max(MAX_MULTI_VALUES),
  checkbox: z.boolean(),
  url: optionalText(URL_MAX),
  email: optionalText(254).refine((s) => s === null || EMAIL_RE.test(s.trim()), {
    message: 'Ungültige E-Mail-Adresse',
  }),
  phone: optionalText(50).refine((s) => s === null || PHONE_RE.test(s.trim()), {
    message: 'Ungültige Telefonnummer',
  }),
  files: z.array(fileValueSchema).max(MAX_FILES),
  created_time: z.never(),
  created_by: z.never(),
  last_edited_time: z.never(),
  last_edited_by: z.never(),
  unique_id: z.never(),
  relation: z.array(id).max(MAX_RELATION_LINKS),
  rollup: z.never(),
  formula: z.never(),
  button: z.never(),
} satisfies Record<PropertyType, z.ZodType>;

export interface PropertyLike {
  id: string;
  type: PropertyType;
  config: unknown;
}

export class PropertyValueError extends Error {
  constructor(
    readonly propertyId: string,
    message: string,
  ) {
    super(message);
    this.name = 'PropertyValueError';
  }
}

const dedupe = (ids: string[]) => [...new Set(ids.map((s) => s.toLowerCase()))];

/**
 * Prüft einen Wert gegen Typ und Konfiguration und normalisiert ihn
 * (Leerzeichen, doppelte IDs, leere Werte als null bzw. []).
 * Wirft PropertyValueError bei ungültigen Werten. Mitgliedschaft von Personen prüft die API.
 */
export function validatePropertyValue(prop: PropertyLike, raw: unknown): PropertyValue {
  if (isReadonlyType(prop.type))
    throw new PropertyValueError(prop.id, 'Dieses Property ist schreibgeschützt');
  const schema = propertyValueSchemas[prop.type];
  const parsed = schema.safeParse(raw === undefined ? null : raw);
  if (!parsed.success)
    throw new PropertyValueError(prop.id, parsed.error.issues[0]?.message ?? 'Ungültiger Wert');
  const v = parsed.data as PropertyValue;
  switch (prop.type) {
    case 'select':
    case 'status': {
      if (v === null) return null;
      const cfg = parsePropertyConfig(prop.type, prop.config) as SelectConfig;
      const opt = cfg.options.find((o) => o.id === String(v).toLowerCase());
      if (!opt) throw new PropertyValueError(prop.id, 'Unbekannte Option');
      return opt.id;
    }
    case 'multi_select': {
      const cfg = parsePropertyConfig(prop.type, prop.config) as SelectConfig;
      const ids = dedupe(v as string[]);
      for (const x of ids)
        if (!cfg.options.some((o) => o.id === x))
          throw new PropertyValueError(prop.id, 'Unbekannte Option');
      return ids;
    }
    case 'person':
      return dedupe(v as string[]);
    case 'text':
      return v;
    case 'url':
    case 'email':
    case 'phone':
      return v === null ? null : String(v).trim();
    case 'title':
      return String(v).replace(/\s+/g, ' ').trim();
    default:
      return v;
  }
}

/** Ist ein Wert leer (für Filter "ist leer" und Berechnungen)? */
export function isEmptyValue(type: PropertyType, v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (type === 'checkbox') return v !== true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

// ---------------------------------------------------------------- Filter

export const TEXT_OPERATORS = [
  'equals',
  'does_not_equal',
  'contains',
  'does_not_contain',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_not_empty',
] as const;
export const NUMBER_OPERATORS = [
  'equals',
  'does_not_equal',
  'greater_than',
  'less_than',
  'greater_than_or_equal_to',
  'less_than_or_equal_to',
  'is_empty',
  'is_not_empty',
] as const;
export const SELECT_OPERATORS = ['is', 'is_not', 'is_empty', 'is_not_empty'] as const;
export const MULTI_OPERATORS = [
  'contains',
  'does_not_contain',
  'is_empty',
  'is_not_empty',
] as const;
export const DATE_OPERATORS = [
  'is',
  'is_before',
  'is_after',
  'is_on_or_before',
  'is_on_or_after',
  'is_within',
  'is_empty',
  'is_not_empty',
] as const;
export const CHECKBOX_OPERATORS = ['is'] as const;
export const EMPTY_OPERATORS = ['is_empty', 'is_not_empty'] as const;

export const FILTER_OPERATORS = [
  ...new Set([
    ...TEXT_OPERATORS,
    ...NUMBER_OPERATORS,
    ...SELECT_OPERATORS,
    ...MULTI_OPERATORS,
    ...DATE_OPERATORS,
  ]),
] as unknown as readonly [FilterOperator, ...FilterOperator[]];
export type FilterOperator =
  | (typeof TEXT_OPERATORS)[number]
  | (typeof NUMBER_OPERATORS)[number]
  | (typeof SELECT_OPERATORS)[number]
  | (typeof MULTI_OPERATORS)[number]
  | (typeof DATE_OPERATORS)[number];

/** Erlaubte Operatoren je Typ (leer = nicht filterbar). */
export function operatorsFor(type: PropertyType): readonly FilterOperator[] {
  switch (type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return TEXT_OPERATORS;
    case 'number':
    case 'unique_id':
      return NUMBER_OPERATORS;
    case 'select':
    case 'status':
      return SELECT_OPERATORS;
    case 'multi_select':
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return MULTI_OPERATORS;
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return DATE_OPERATORS;
    case 'checkbox':
      return CHECKBOX_OPERATORS;
    case 'files':
      return EMPTY_OPERATORS;
    case 'relation':
      return MULTI_OPERATORS;
    default:
      return [];
  }
}

/**
 * Wie ein Property in Filtern, Sortierung, Gruppen und Berechnungen behandelt wird:
 * Formeln und Rollups nach ihrem Ergebnistyp (Listen als Text), alle anderen nach ihrem Typ.
 */
export function effectiveType(type: PropertyType, config: unknown): PropertyType {
  if (type !== 'formula' && type !== 'rollup') return type;
  const rt = (config as { resultType?: ResultType } | null)?.resultType ?? 'empty';
  switch (rt) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'checkbox';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

export const RELATIVE_DATES = [
  'today',
  'tomorrow',
  'yesterday',
  'one_week_ago',
  'one_week_from_now',
  'one_month_ago',
  'one_month_from_now',
] as const;
export type RelativeDate = (typeof RELATIVE_DATES)[number];
export const DATE_RANGES = [
  'past_week',
  'past_month',
  'past_year',
  'next_week',
  'next_month',
  'next_year',
] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export const dateOperandSchema = z.union([
  z.object({ kind: z.literal('exact'), date: z.string().regex(ISO_DATE) }).strict(),
  z.object({ kind: z.literal('relative'), preset: z.enum(RELATIVE_DATES) }).strict(),
]);
export type DateOperand = z.infer<typeof dateOperandSchema>;

/** Filterwert: Text, Zahl, Wahrheitswert, Options-/Nutzer-ID, Datumsangabe, Zeitraum. */
export const filterValueSchema = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
  dateOperandSchema,
]);

export const filterConditionSchema = z
  .object({
    type: z.literal('condition').default('condition'),
    propertyId: id,
    operator: z.enum(FILTER_OPERATORS),
    value: filterValueSchema.nullable().optional(),
  })
  .strict();
export type FilterCondition = z.output<typeof filterConditionSchema>;

export interface FilterGroup {
  type: 'group';
  op: 'and' | 'or';
  children: (FilterCondition | FilterGroup)[];
}
export type FilterNode = FilterCondition | FilterGroup;

/** Maximale Verschachtelung (Wurzelgruppe zählt mit). Phase 6 erweitert die Oberfläche auf Tiefe 3. */
export const MAX_FILTER_DEPTH = 3;
export const MAX_FILTER_CONDITIONS = 50;

export const filterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z
    .object({
      type: z.literal('group'),
      op: z.enum(['and', 'or']),
      children: z.array(z.union([filterConditionSchema, filterGroupSchema])).max(20),
    })
    .strict(),
) as z.ZodType<FilterGroup>;

/** Prüft Tiefe und Anzahl der Bedingungen. */
export const filterSchema = filterGroupSchema.superRefine((g, ctx) => {
  let count = 0;
  const walk = (n: FilterNode, depth: number) => {
    if (n.type === 'group') {
      if (depth > MAX_FILTER_DEPTH)
        ctx.addIssue({ code: 'custom', message: 'Filter zu tief verschachtelt' });
      for (const c of n.children) walk(c, depth + 1);
    } else count++;
  };
  walk(g, 1);
  if (count > MAX_FILTER_CONDITIONS)
    ctx.addIssue({ code: 'custom', message: 'Zu viele Filterbedingungen' });
});

// ---------------------------------------------------------------- Sortierung

export const sortSchema = z
  .object({ propertyId: id, direction: z.enum(['asc', 'desc']).default('asc') })
  .strict();
export type SortSpec = z.output<typeof sortSchema>;
export const MAX_SORTS = 10;

/** Typen, nach denen sortiert werden kann. */
export function isSortable(type: PropertyType): boolean {
  return !['files', 'relation'].includes(type);
}

// ---------------------------------------------------------------- Berechnungen

export const CALCULATIONS = [
  'count_all',
  'count_values',
  'count_unique',
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'earliest_date',
  'latest_date',
  'date_range',
  'checked',
  'unchecked',
  'percent_checked',
  'percent_unchecked',
] as const;
export type CalculationFn = (typeof CALCULATIONS)[number];

const COUNT_CALCS: CalculationFn[] = [
  'count_all',
  'count_values',
  'count_unique',
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
];

/** Verfügbare Berechnungen je Typ. */
export function calculationsFor(type: PropertyType): CalculationFn[] {
  switch (type) {
    case 'number':
    case 'unique_id':
      return [...COUNT_CALCS, 'sum', 'average', 'median', 'min', 'max', 'range'];
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return [...COUNT_CALCS, 'earliest_date', 'latest_date', 'date_range'];
    case 'checkbox':
      return ['count_all', 'checked', 'unchecked', 'percent_checked', 'percent_unchecked'];
    case 'relation':
      return ['count_all', 'count_empty', 'count_not_empty', 'percent_empty', 'percent_not_empty'];
    case 'rollup':
    case 'formula':
      return ['count_all'];
    default:
      return COUNT_CALCS;
  }
}

// ---------------------------------------------------------------- Ansichten

export const VIEW_TYPES = [
  'table',
  'board',
  'list',
  'gallery',
  'calendar',
  'timeline',
  'chart',
] as const;
export type ViewType = (typeof VIEW_TYPES)[number];
/** Anlegbare Ansichten. */
export const CREATABLE_VIEW_TYPES = [
  'table',
  'board',
  'list',
  'gallery',
  'calendar',
  'timeline',
  'chart',
] as const satisfies readonly ViewType[];

export const viewPropertySchema = z
  .object({
    id,
    visible: z.boolean().default(true),
    width: z.number().int().min(60).max(1200).optional(),
    wrap: z.boolean().optional(),
  })
  .strict();
export type ViewProperty = z.output<typeof viewPropertySchema>;

// ---------------------------------------------------------------- Gruppierung (Phase 5)

/** Gruppenschlüssel für "leer" (keine Option, kein Datum, ...). */
export const EMPTY_GROUP = '__empty__';
export const DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

/** Typen, nach denen gruppiert werden kann. */
export const GROUPABLE_TYPES: readonly PropertyType[] = [
  'title',
  'text',
  'url',
  'email',
  'phone',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'checkbox',
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
];
export const isGroupable = (t: PropertyType) => GROUPABLE_TYPES.includes(t);

const groupKey = z.string().min(1).max(200);

export const groupBySchema = z
  .object({
    propertyId: id,
    hideEmpty: z.boolean().default(false),
    /** Datum: Zeitraum je Gruppe */
    dateBucket: z.enum(DATE_BUCKETS).default('month'),
    /** Zahl: Breite der Bereiche */
    numberInterval: z.number().positive().max(1e12).default(10),
    /** Reihenfolge: manuell (Optionen bzw. order), auf- oder absteigend */
    sort: z.enum(['manual', 'asc', 'desc']).default('manual'),
    /** Manuelle Reihenfolge der Gruppenschlüssel (fehlende hinten) */
    order: z.array(groupKey).max(1000).default([]),
    /** Ausgeblendete Gruppen */
    hidden: z.array(groupKey).max(1000).default([]),
    /** Eingeklappte Gruppen (Liste, Tabelle, Swimlanes) */
    collapsed: z.array(groupKey).max(1000).default([]),
  })
  .strict();
export type GroupBy = z.output<typeof groupBySchema>;

export const CARD_PREVIEWS = ['none', 'cover', 'content', 'files'] as const;
export const CARD_SIZES = ['small', 'medium', 'large'] as const;

export const boardConfigSchema = z
  .object({
    cardPreview: z.enum(CARD_PREVIEWS).default('none'),
    /** Datei-Property als Vorschau (cardPreview = files) */
    previewPropertyId: id.nullable().default(null),
    cardSize: z.enum(CARD_SIZES).default('medium'),
    fitImage: z.boolean().default(false),
    /** Spaltenhintergrund in Optionsfarbe */
    colorColumns: z.boolean().default(true),
    /** Berechnung je Spalte (Standard: Anzahl) */
    columnCalculation: z
      .object({ propertyId: id.nullable(), fn: z.enum(CALCULATIONS) })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type BoardConfig = z.output<typeof boardConfigSchema>;

export const galleryConfigSchema = z
  .object({
    cardPreview: z.enum(CARD_PREVIEWS).default('cover'),
    previewPropertyId: id.nullable().default(null),
    cardSize: z.enum(CARD_SIZES).default('medium'),
    fitImage: z.boolean().default(false),
  })
  .strict();
export type GalleryConfig = z.output<typeof galleryConfigSchema>;

export const calendarConfigSchema = z
  .object({
    datePropertyId: id.nullable().default(null),
    mode: z.enum(['month', 'week']).default('month'),
    showWeekends: z.boolean().default(true),
  })
  .strict();
export type CalendarConfig = z.output<typeof calendarConfigSchema>;

export const TIMELINE_ZOOMS = [
  'hours',
  'day',
  'week',
  'bi_week',
  'month',
  'quarter',
  'year',
] as const;
export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number];

export const timelineConfigSchema = z
  .object({
    startPropertyId: id.nullable().default(null),
    /** Ende aus demselben Datums-Property (Bereich) oder einem zweiten Property */
    endPropertyId: id.nullable().default(null),
    zoom: z.enum(TIMELINE_ZOOMS).default('week'),
    showTable: z.boolean().default(true),
    tableWidth: z.number().int().min(160).max(800).default(280),
  })
  .strict();
export type TimelineConfig = z.output<typeof timelineConfigSchema>;

// ---------------------------------------------------------------- Charts (Phase 7)

export const CHART_TYPES = [
  'bar',
  'bar_horizontal',
  'line',
  'area',
  'pie',
  'donut',
  'scatter',
  'progress_bar',
  'progress_ring',
  'kpi',
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_MEASURES = [
  'count',
  'count_unique',
  'sum',
  'average',
  'median',
  'min',
  'max',
] as const;
export type ChartMeasure = (typeof CHART_MEASURES)[number];

export const CHART_DATE_RANGES = [
  'all',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_month',
  'this_year',
  'fixed',
] as const;
export type ChartDateRange = (typeof CHART_DATE_RANGES)[number];

const chartAxisSchema = z
  .object({
    propertyId: id,
    dateBucket: z.enum(DATE_BUCKETS).default('month'),
    numberInterval: z.number().positive().max(1e12).default(10),
  })
  .strict();

export const chartConfigSchema = z
  .object({
    type: z.enum(CHART_TYPES).default('bar'),
    /** X-Achse (bzw. Segmente bei Kreis): ohne bei KPI und Fortschritt */
    x: chartAxisSchema.nullable().default(null),
    /** Y-Wert: Anzahl oder Berechnung über ein Zahl-Property (auch Formel, Rollup) */
    y: z
      .object({
        measure: z.enum(CHART_MEASURES).default('count'),
        propertyId: id.nullable().default(null),
      })
      .strict()
      .default({ measure: 'count', propertyId: null }),
    /** Gruppierung in Serien (gestapelt oder nebeneinander) */
    series: chartAxisSchema.nullable().default(null),
    stack: z.enum(['none', 'stacked', 'percent']).default('none'),
    sort: z.enum(['x_asc', 'x_desc', 'y_asc', 'y_desc']).default('x_asc'),
    topN: z.number().int().min(1).max(100).nullable().default(null),
    hideEmpty: z.boolean().default(false),
    cumulative: z.boolean().default(false),
    /** Zeitraum über ein Datums-Property */
    dateFilter: z
      .object({
        propertyId: id,
        range: z.enum(CHART_DATE_RANGES).default('last_30_days'),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .default(null),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .default(null),
      })
      .strict()
      .nullable()
      .default(null),
    /** KPI: Vergleich mit dem gleich langen Zeitraum davor (braucht dateFilter) */
    compare: z.boolean().default(false),
    /** Fortschritt: Zielwert */
    target: z.number().finite().nullable().default(null),
    display: z
      .object({
        palette: z.enum(['jotion', 'pastel', 'vivid', 'mono']).default('jotion'),
        optionColors: z.boolean().default(true),
        legend: z.boolean().default(true),
        dataLabels: z.boolean().default(false),
        xTitle: z.string().max(100).default(''),
        yTitle: z.string().max(100).default(''),
        grid: z.boolean().default(true),
        smooth: z.boolean().default(false),
        height: z.number().int().min(160).max(800).default(320),
      })
      .strict()
      .default({
        palette: 'jotion',
        optionColors: true,
        legend: true,
        dataLabels: false,
        xTitle: '',
        yTitle: '',
        grid: true,
        smooth: false,
        height: 320,
      }),
  })
  .strict();
export type ChartConfig = z.output<typeof chartConfigSchema>;
export type ChartConfigInput = z.input<typeof chartConfigSchema>;

export const chartQuerySchema = z
  .object({
    viewId: id,
    timeZone: z.string().max(64).optional(),
  })
  .strict();

export interface ChartPointDto {
  /** Gruppenschlüssel der X-Achse (EMPTY_GROUP für leer, "" ohne X-Achse) */
  x: string;
  /** Gruppenschlüssel der Serie ("" ohne Serie) */
  series: string;
  value: number;
}

export interface ChartDataDto {
  points: ChartPointDto[];
  /** Gesamtwert über alle Zeilen (KPI, Fortschritt) */
  total: number;
  /** KPI: Wert im Zeitraum davor */
  previous: number | null;
  /** KPI: Verlauf je Tag oder Woche (Sparkline) */
  spark: { x: string; value: number }[];
  /** Zeitraum des Datumsfilters (für die Anzeige) */
  range: { from: string; to: string } | null;
}

export const viewConfigSchema = z
  .object({
    filter: filterSchema.nullable().default(null),
    sorts: z.array(sortSchema).max(MAX_SORTS).default([]),
    /** Reihenfolge = Spaltenreihenfolge; fehlende Properties erscheinen am Ende */
    properties: z.array(viewPropertySchema).max(500).default([]),
    /** Anzahl fixierter Spalten von links (inkl. Titel) */
    frozenColumns: z.number().int().min(0).max(5).default(1),
    calculations: z.record(z.string(), z.enum(CALCULATIONS)).default({}),
    wrapCells: z.boolean().default(false),
    // Phase 5: Gruppierung und typspezifische Einstellungen
    groupBy: groupBySchema.nullable().default(null),
    /** Zweite Ebene (Swimlanes im Board, Untergruppen in Liste und Tabelle) */
    subGroupBy: groupBySchema.nullable().default(null),
    /** Property-Sichtbarkeit für Karten (Board, Gallery, List, Calendar, Timeline) */
    cardProperties: z.array(id).max(500).optional(),
    board: boardConfigSchema.optional(),
    calendar: calendarConfigSchema.optional(),
    timeline: timelineConfigSchema.optional(),
    gallery: galleryConfigSchema.optional(),
    chart: chartConfigSchema.optional(),
  })
  .strict();
export type ViewConfig = z.output<typeof viewConfigSchema>;
export type ViewConfigInput = z.input<typeof viewConfigSchema>;

// ---------------------------------------------------------------- DTOs

export interface PropertyDto {
  id: string;
  name: string;
  type: PropertyType;
  config: PropertyConfig;
  position: string;
}

export interface ViewDto {
  id: string;
  name: string;
  type: ViewType;
  position: string;
  config: ViewConfig;
}

export interface DatabaseDto {
  id: string;
  workspaceId: string;
  title: string;
  icon: PageIcon | null;
  scope: PageScope;
  parentId: string | null;
  isInline: boolean;
  /** Linked Database: Quelle der Zeilen und Properties */
  source: { id: string; title: string; icon: PageIcon | null } | null;
  /** true, wenn es eine Linked Database ist, deren Quelle fehlt oder nicht sichtbar ist */
  sourceMissing: boolean;
  /** Datenbank mit Zeilen und Properties (bei Linked Databases die Quelle) */
  dataId: string;
  properties: PropertyDto[];
  views: ViewDto[];
  canEdit: boolean;
  /** Gesperrt: Properties und Ansichten unveränderlich, Zeilen weiter bearbeitbar */
  locked: boolean;
  deleted: boolean;
}

export interface RowDto {
  id: string;
  title: string;
  icon: PageIcon | null;
  cover?: PageCover | null;
  /** Titel und Icons verknüpfter Zeilen (Relationen) nach Zeilen-ID */
  refs?: Record<string, { title: string; icon: PageIcon | null }>;
  /** Vorschau aus dem Seiteninhalt (nur mit preview: true abgefragt) */
  preview?: { image: string | null; text: string };
  position: string;
  createdAt: string;
  createdById: string;
  lastEditedAt: string;
  lastEditedById: string;
  /** Werte gespeicherter Properties nach Property-ID (leere fehlen) */
  values: Record<string, PropertyValue>;
}

export interface RowQueryResultDto {
  rows: RowDto[];
  nextCursor: string | null;
  /** Anzahl aller passenden Zeilen; nur auf der ersten Seite (sonst null) */
  total: number | null;
}

export type CalculationResultDto = Record<string, number | string | null>;

export interface DatabaseSearchResultDto {
  id: string;
  title: string;
  icon: PageIcon | null;
  path: string;
}

// ---------------------------------------------------------------- Eingaben

const placement = {
  afterId: id.nullable().optional(),
  beforeId: id.nullable().optional(),
};

export const createDatabaseSchema = z
  .object({
    parentId: id.nullable().optional(),
    scope: z.enum(['PRIVATE', 'TEAM']).optional(),
    title: z.string().max(2000).optional(),
    inline: z.boolean().default(false),
    /** Linked Database auf eine bestehende Datenbank */
    sourceDatabaseId: id.optional(),
    /** Full-Page-Datenbank unter einer Seite: Unterseiten-Block anhängen */
    insertBlock: z.boolean().default(true),
    ...placement,
  })
  .strict()
  .refine((v) => !v.inline || v.parentId, {
    message: 'Inline-Datenbanken brauchen eine Elternseite',
  });
export type CreateDatabaseInput = z.input<typeof createDatabaseSchema>;

export const createPropertySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(CREATABLE_PROPERTY_TYPES),
    config: z.record(z.string(), z.unknown()).optional(),
    /** Ansicht, in der die Spalte direkt nach afterPropertyId erscheinen soll */
    viewId: id.optional(),
    afterPropertyId: id.nullable().optional(),
  })
  .strict();
export type CreatePropertyInput = z.input<typeof createPropertySchema>;

export const updatePropertySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    /** Typwechsel mit Konvertierung der Werte */
    type: z.enum(CREATABLE_PROPERTY_TYPES).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type UpdatePropertyInput = z.input<typeof updatePropertySchema>;

export const createViewSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(CREATABLE_VIEW_TYPES).default('table'),
    /** Konfiguration einer bestehenden Ansicht übernehmen */
    duplicateOf: id.optional(),
    ...placement,
  })
  .strict();
export type CreateViewInput = z.input<typeof createViewSchema>;

export const updateViewSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    /** Layout wechseln (Einstellungen der anderen Layouts bleiben erhalten) */
    type: z.enum(CREATABLE_VIEW_TYPES).optional(),
    /** Teiländerung; wird mit der gespeicherten Konfiguration zusammengeführt und dann geprüft.
     *  (Kein viewConfigSchema.partial(): dessen Standardwerte würden fehlende Felder überschreiben.) */
    config: z.record(z.string(), z.unknown()).optional(),
    ...placement,
  })
  .strict();
export type UpdateViewInput = Omit<z.input<typeof updateViewSchema>, 'config'> & {
  config?: Partial<ViewConfigInput>;
};

export const ROW_PAGE_MAX = 200;

export const queryRowsSchema = z
  .object({
    viewId: id.optional(),
    /** Überschreibt Filter/Sortierung der Ansicht (z. B. für Vorschau) */
    filter: filterSchema.nullable().optional(),
    sorts: z.array(sortSchema).max(MAX_SORTS).optional(),
    search: z.string().max(200).optional(),
    cursor: z.string().max(4000).nullable().optional(),
    limit: z.number().int().min(1).max(ROW_PAGE_MAX).default(100),
    /** IANA-Zeitzone für Datumsfilter */
    timeZone: z.string().max(64).optional(),
    /** Vorschau aus dem Seiteninhalt mitliefern (Karten in Board und Gallery) */
    preview: z.boolean().optional(),
    /** Drilldown: nur Zeilen eines Diagrammpunkts (X-Gruppe und Serie der Chart-Ansicht) */
    chartPoint: z
      .object({ x: z.string().max(200).optional(), series: z.string().max(200).optional() })
      .strict()
      .optional(),
    /** Nur Zeilen einer Gruppe (und Untergruppe) der Ansicht */
    group: groupKey.optional(),
    subGroup: groupKey.optional(),
    /** Nur Zeilen, deren Datum den Zeitraum [from, to] berührt (Kalender, Zeitleiste) */
    dateRange: z
      .object({
        startPropertyId: id,
        endPropertyId: id.nullable().optional(),
        from: z.string().regex(ISO_DATE),
        to: z.string().regex(ISO_DATE),
      })
      .strict()
      .optional(),
  })
  .strict();
export type QueryRowsInput = z.input<typeof queryRowsSchema>;

export const calculateSchema = z
  .object({
    viewId: id,
    /** Nur über eine Gruppe (Spaltenberechnung im Board) */
    group: groupKey.optional(),
    subGroup: groupKey.optional(),
    /** Berechnungen statt der gespeicherten der Ansicht */
    calculations: z.record(z.string(), z.enum(CALCULATIONS)).optional(),
    search: z.string().max(200).optional(),
    timeZone: z.string().max(64).optional(),
  })
  .strict();

export const createRowSchema = z
  .object({
    title: z.string().max(2000).optional(),
    values: z.record(z.string(), z.unknown()).optional(),
    /** Phase 9: Zeilen-Vorlage; ohne Angabe greift die Standardvorlage, "none" verhindert das */
    templateId: z.union([id, z.literal('none')]).optional(),
    ...placement,
  })
  .strict();
export type CreateRowInput = z.input<typeof createRowSchema>;

export const updateRowSchema = z
  .object({
    title: z.string().max(2000).optional(),
    values: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type UpdateRowInput = z.input<typeof updateRowSchema>;

/** Gruppenwechsel beim Ziehen im Board: Wert des Gruppen-Properties wird mit gesetzt. */
export const groupMoveSchema = z.object({ propertyId: id, from: groupKey, to: groupKey }).strict();
export type GroupMove = z.output<typeof groupMoveSchema>;

export const moveRowSchema = z
  .object({
    ...placement,
    groups: z.array(groupMoveSchema).max(2).optional(),
    /** Zeitzone für Datumsgruppen */
    timeZone: z.string().max(64).optional(),
  })
  .strict();
export type MoveRowInput = z.input<typeof moveRowSchema>;

export const groupsQuerySchema = z
  .object({
    viewId: id,
    search: z.string().max(200).optional(),
    timeZone: z.string().max(64).optional(),
  })
  .strict();

export interface GroupCountDto {
  key: string;
  subKey: string | null;
  count: number;
}

export interface GroupsResultDto {
  /** Anzahl je Gruppe (und Untergruppe), nur Gruppen mit Zeilen */
  counts: GroupCountDto[];
  total: number;
}

export const trashRowsSchema = z.object({ rowIds: z.array(id).min(1).max(500) }).strict();
