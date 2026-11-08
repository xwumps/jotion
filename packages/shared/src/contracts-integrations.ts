import { z } from 'zod';

/** Phase 8: Integrationen (Verbindungen, Quellen, Mapping, Sync-Läufe, Konflikte). */

const id = z.uuid();

export const CONNECTOR_TYPES = [
  'ical',
  'caldav',
  'iserv',
  // Phase 11
  'icloud',
  'nextcloud',
  'webdav',
  'google',
  'microsoft',
  'dropbox',
  'telegram',
] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export const CONNECTION_STATUSES = ['active', 'paused', 'error'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const DELETION_POLICIES = ['mark', 'archive', 'trash'] as const;
export type DeletionPolicy = (typeof DELETION_POLICIES)[number];

/**
 * remote: Remote-Wert gewinnt immer. local_preserve (Standard): Drei-Wege-Vergleich, lokale
 * Änderungen bleiben, Konflikte werden protokolliert. once: nur beim Anlegen.
 */
export const FIELD_OWNERSHIPS = ['remote', 'local_preserve', 'once'] as const;
export type FieldOwnership = (typeof FIELD_OWNERSHIPS)[number];

/** Normalisierte Felder je Art (siehe Connector-SDK) */
export const RECORD_FIELDS = {
  event: [
    'title',
    'description',
    'date',
    'start',
    'end',
    'allDay',
    'location',
    'organizer',
    'url',
    'categories',
    'status',
  ],
  task: [
    'title',
    'description',
    'date',
    'due',
    'completed',
    'priority',
    'categories',
    'status',
    'url',
  ],
  /** Phase 11: E-Mail und Telegram */
  message: ['title', 'description', 'date', 'from', 'to', 'categories', 'read', 'url'],
  /** Phase 11: Drive, OneDrive, Dropbox, WebDAV */
  file: ['title', 'path', 'size', 'mime', 'date', 'url'],
} as const;

/** Sync-Intervall in Minuten: 15 min bis 24 h */
export const SYNC_INTERVALS = [15, 30, 60, 180, 360, 720, 1440] as const;

export const TEMPLATE_SOURCE = 'template';

export const mappingFieldSchema = z
  .object({
    /** Feld des Datensatzes oder "template" */
    source: z.string().min(1).max(40),
    /** "title" oder Property-ID */
    target: z.union([z.literal('title'), id]),
    ownership: z.enum(FIELD_OWNERSHIPS).default('local_preserve'),
    /** Vorlage wie "{{categories}}: {{title}}" (nur bei source = template) */
    template: z.string().max(500).optional(),
    /** Auswahl/Status: fehlende Optionen anlegen */
    autoCreateOptions: z.boolean().default(true),
    /** Wahrheitswert in Auswahl/Status: Optionsnamen für wahr und falsch */
    trueOption: z.string().max(100).optional(),
    falseOption: z.string().max(100).optional(),
  })
  .strict();
export type MappingField = z.output<typeof mappingFieldSchema>;

export const mappingSchema = z
  .object({
    fields: z.array(mappingFieldSchema).max(50).default([]),
    /** Beschreibung beim Anlegen als Seiteninhalt übernehmen */
    descriptionToContent: z.boolean().default(true),
    /** Auswahl-Property für den Sync-Status (Optionen "Aktiv", "Entfernt") */
    syncStatusPropertyId: id.nullable().default(null),
  })
  .strict()
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.fields.forEach((f, i) => {
      if (seen.has(f.target))
        ctx.addIssue({
          code: 'custom',
          path: ['fields', i, 'target'],
          message: 'Ziel doppelt zugeordnet',
        });
      seen.add(f.target);
      if (f.source === TEMPLATE_SOURCE && !f.template)
        ctx.addIssue({ code: 'custom', path: ['fields', i, 'template'], message: 'Vorlage fehlt' });
    });
  });
export type Mapping = z.output<typeof mappingSchema>;

export const sourceOptionsSchema = z
  .object({
    expandRecurring: z.boolean().default(true),
    windowPastDays: z.number().int().min(0).max(365).default(30),
    windowFutureDays: z.number().int().min(1).max(730).default(180),
  })
  .strict();

const secretsSchema = z.record(z.string().max(40), z.string().max(4096));
const configSchema = z.record(z.string().max(40), z.unknown());

export const createConnectionSchema = z
  .object({
    type: z.enum(CONNECTOR_TYPES),
    name: z.string().trim().min(1).max(100),
    config: configSchema,
    secrets: secretsSchema.default({}),
    intervalMinutes: z.number().int().min(15).max(1440).default(60),
  })
  .strict();

export const updateConnectionSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    config: configSchema.optional(),
    /** Nur gesetzte Schlüssel werden ersetzt; leere Zeichenkette entfernt ein Geheimnis */
    secrets: secretsSchema.optional(),
    syncEnabled: z.boolean().optional(),
    intervalMinutes: z.number().int().min(15).max(1440).optional(),
  })
  .strict();

/** Verbindung vor dem Speichern testen */
export const testConnectionSchema = z
  .object({
    type: z.enum(CONNECTOR_TYPES),
    config: configSchema,
    secrets: secretsSchema.default({}),
  })
  .strict();

export const updateSourceSchema = z
  .object({
    enabled: z.boolean().optional(),
    targetDatabaseId: id.nullable().optional(),
    mapping: mappingSchema.optional(),
    options: sourceOptionsSchema.optional(),
    deletionPolicy: z.enum(DELETION_POLICIES).optional(),
  })
  .strict();

/** Neue Ziel-Datenbank mit vorgeschlagenen Properties anlegen */
export const createTargetDatabaseSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    /** Elternseite; ohne Angabe auf oberster Ebene im privaten Bereich */
    parentId: id.nullable().default(null),
  })
  .strict();

export const disconnectSchema = z
  .object({
    /** keep: synchronisierte Zeilen bleiben (Standard), archive: archivieren */
    rows: z.enum(['keep', 'archive']).default('keep'),
  })
  .strict();

export const resolveConflictSchema = z.object({ resolution: z.enum(['remote', 'local']) }).strict();

export interface SourceDto {
  id: string;
  remoteId: string;
  name: string;
  kinds: string[];
  enabled: boolean;
  targetDatabaseId: string | null;
  targetDatabaseTitle: string | null;
  mapping: Mapping;
  options: z.output<typeof sourceOptionsSchema>;
  deletionPolicy: DeletionPolicy;
  lastSyncedAt: string | null;
  entityCount: number;
}

export interface SyncStats {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  conflicts: number;
  skipped: number;
  errors: number;
}

export interface SyncRunDto {
  id: string;
  trigger: 'manual' | 'schedule';
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  stats: Partial<SyncStats>;
  errors: { source?: string; externalId?: string; message: string }[];
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ConnectionDto {
  id: string;
  type: ConnectorType;
  name: string;
  config: Record<string, unknown>;
  /** Namen der gespeicherten Geheimnisse (nie die Werte) */
  secretKeys: string[];
  status: ConnectionStatus;
  statusMessage: string | null;
  accountLabel: string | null;
  syncEnabled: boolean;
  intervalMinutes: number;
  nextSyncAt: string | null;
  lastSyncAt: string | null;
  sources: SourceDto[];
  lastRun: SyncRunDto | null;
  openConflicts: number;
}

export interface ConnectionTestDto {
  ok: boolean;
  accountLabel: string | null;
  sources: { remoteId: string; name: string; kinds: string[] }[];
  capabilities: Record<string, boolean>;
  error: { code: string; message: string } | null;
}

export interface ConflictDto {
  id: string;
  rowId: string | null;
  rowTitle: string | null;
  sourceName: string;
  field: string;
  fieldName: string;
  localValue: unknown;
  remoteValue: unknown;
  createdAt: string;
}

export interface MappingPreviewDto {
  /** Erste Datensätze mit den Werten, die in die Zeile geschrieben würden */
  rows: {
    externalId: string;
    kind: string;
    title: string;
    values: Record<string, unknown>;
    raw: Record<string, unknown>;
  }[];
  /** Optionen, die neu angelegt würden, je Property */
  newOptions: Record<string, string[]>;
  errors: string[];
}
