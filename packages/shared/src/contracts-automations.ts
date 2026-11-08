import { z } from 'zod';
import { filterSchema } from './contracts-database';

/** Phase 9: Automatisierungen und Buttons. */

const id = z.uuid();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Höchste Kettentiefe (Automatisierung löst Automatisierung aus) */
export const MAX_AUTOMATION_DEPTH = 5;
/** Ausführungen je Automatisierung und Minute */
export const AUTOMATION_RATE_LIMIT = 60;
export const MAX_AUTOMATION_ACTIONS = 10;

export const AUTOMATION_TRIGGERS = [
  'row_created',
  'property_changed',
  'schedule',
  'date_reached',
  'button',
] as const;
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGERS)[number];

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('row_created') }).strict(),
  z
    .object({
      type: z.literal('property_changed'),
      /** "title" oder Property-ID */
      propertyId: z.union([z.literal('title'), id]),
    })
    .strict(),
  z
    .object({
      type: z.literal('schedule'),
      every: z.enum(['day', 'week', 'month']),
      time: time.default('08:00'),
      weekday: z.number().int().min(1).max(7).default(1),
      monthday: z.number().int().min(1).max(28).default(1),
      /** Aktionen je Zeile ausführen, die die Bedingung erfüllt (sonst einmal ohne Zeile) */
      forEachRow: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      type: z.literal('date_reached'),
      propertyId: id,
      /** Tage relativ zum Datum: -1 = einen Tag vorher */
      offsetDays: z.number().int().min(-365).max(365).default(0),
      time: time.default('08:00'),
    })
    .strict(),
  z
    .object({
      type: z.literal('button'),
      /** Button-Property dieser Datenbank; null = Button-Block */
      propertyId: id.nullable().default(null),
    })
    .strict(),
]);
export type AutomationTrigger = z.output<typeof triggerSchema>;

export const VALUE_KINDS = [
  'static',
  'clear',
  'today',
  'now',
  'trigger_user',
  'toggle',
  'formula',
  'text',
] as const;

export const valueSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static'), value: z.unknown() }).strict(),
  z.object({ kind: z.literal('clear') }).strict(),
  z
    .object({
      kind: z.literal('today'),
      offsetDays: z.number().int().min(-3650).max(3650).default(0),
    })
    .strict(),
  z.object({ kind: z.literal('now') }).strict(),
  /** Person, die ausgelöst hat */
  z.object({ kind: z.literal('trigger_user') }).strict(),
  /** Checkbox umschalten */
  z.object({ kind: z.literal('toggle') }).strict(),
  /** Formelausdruck im Kontext der auslösenden Zeile */
  z.object({ kind: z.literal('formula'), expression: z.string().min(1).max(2000) }).strict(),
  /** Text mit Platzhaltern {{title}}, {{Property}}, {{user}}, {{today}} */
  z.object({ kind: z.literal('text'), text: z.string().max(2000) }).strict(),
]);
export type ValueSpec = z.output<typeof valueSpecSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('set_property'),
      /** Auslösende Zeile oder über eine Relation verknüpfte Zeilen */
      target: z
        .discriminatedUnion('kind', [
          z.object({ kind: z.literal('trigger') }).strict(),
          z.object({ kind: z.literal('related'), relationPropertyId: id }).strict(),
        ])
        .default({ kind: 'trigger' }),
      propertyId: z.union([z.literal('title'), id]),
      value: valueSpecSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('create_row'),
      databaseId: id,
      /** Zeilen-Vorlage der Zieldatenbank; null = Standardvorlage greift nicht */
      templateId: id.nullable().default(null),
      title: z.string().max(2000).default(''),
      values: z.record(z.string(), valueSpecSchema).default({}),
      /** Relation in der neuen Zeile, die auf die auslösende Zeile zeigen soll */
      linkPropertyId: id.nullable().default(null),
    })
    .strict(),
  z
    .object({
      type: z.literal('webhook'),
      url: z.string().url().max(2000),
      /** Werte der auslösenden Zeile mitsenden */
      includeRow: z.boolean().default(true),
    })
    .strict(),
]);
export type AutomationAction = z.output<typeof actionSchema>;

export const automationInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean().default(true),
    /** Datenbank; null nur für Button-Blöcke und Zeitpläne ohne Zeilen */
    databaseId: id.nullable(),
    trigger: triggerSchema,
    conditions: filterSchema.nullable().default(null),
    actions: z.array(actionSchema).min(1).max(MAX_AUTOMATION_ACTIONS),
  })
  .strict()
  .superRefine((a, ctx) => {
    const rowTrigger = ['row_created', 'property_changed', 'date_reached'].includes(a.trigger.type);
    if (rowTrigger && !a.databaseId)
      ctx.addIssue({
        code: 'custom',
        path: ['databaseId'],
        message: 'Dieser Auslöser braucht eine Datenbank',
      });
    if (a.trigger.type === 'schedule' && a.trigger.forEachRow && !a.databaseId)
      ctx.addIssue({
        code: 'custom',
        path: ['databaseId'],
        message: 'Für "je Zeile" eine Datenbank wählen',
      });
  });
export type AutomationInput = z.output<typeof automationInputSchema>;

export const updateAutomationSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    trigger: triggerSchema.optional(),
    conditions: filterSchema.nullable().optional(),
    actions: z.array(actionSchema).min(1).max(MAX_AUTOMATION_ACTIONS).optional(),
  })
  .strict();

export interface AutomationDto {
  id: string;
  name: string;
  enabled: boolean;
  databaseId: string | null;
  trigger: AutomationTrigger;
  conditions: z.output<typeof filterSchema> | null;
  actions: AutomationAction[];
  createdBy: { id: string; name: string };
  /** Schlüssel für die Signatur der Webhooks (HMAC-SHA256 im Header X-Jotion-Signature) */
  webhookSecret: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRun: AutomationRunDto | null;
}

export type AutomationRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'stopped';

export interface AutomationRunDto {
  id: string;
  status: AutomationRunStatus;
  chainDepth: number;
  rowId: string | null;
  rowTitle: string | null;
  actorName: string | null;
  details: { action: string; ok: boolean; message?: string }[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
