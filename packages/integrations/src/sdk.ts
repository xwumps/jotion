import type { SafeHttpClient } from './safe-http';

/**
 * Connector-SDK (Phase 8): gemeinsame Schnittstelle aller Connectoren.
 * Ein Connector liest Datensätze aus einer Quelle und normalisiert sie in ExternalRecords;
 * Mapping, Dedupe, Konflikte und Löschungen erledigt die Sync-Engine für alle gleich.
 */

export type RecordKind = 'event' | 'task';

/** Datum oder Zeitraum. Ganztägig: YYYY-MM-DD, sonst ISO-Zeitpunkt in UTC. */
export interface DateField {
  start: string;
  end: string | null;
  hasTime: boolean;
}

export type FieldValue = string | number | boolean | string[] | DateField | null;

/**
 * Normalisierte Felder je Kind:
 * - event: title, description, date (Zeitraum), start, end, allDay, location, organizer, url, categories, status
 * - task: title, description, date (Beginn bis Fälligkeit), due, completed, priority, categories, status, url
 */
export interface ExternalRecord {
  /** Stabile ID in der Quelle (UID, bei Terminserien UID#RECURRENCE-ID) */
  externalId: string;
  /** Ohne UID: Hash aus Quelle, Beginn und Titel (kann sich ändern, wenn sich diese ändern) */
  weakId: boolean;
  /** Ressource, aus der der Datensatz stammt (CalDAV-href), für Löschungen pro Ressource */
  remoteRef: string | null;
  kind: RecordKind;
  /** Hash der normalisierten Felder; gleicher Hash bedeutet unverändert */
  version: string;
  fields: Record<string, FieldValue>;
}

export interface PullResult {
  records: ExternalRecord[];
  /** Ressourcen, die in der Quelle gelöscht wurden (inkrementelle Abfrage) */
  deletedRefs: string[];
  /**
   * Ressourcen, deren Datensätze vollständig in records stehen (geänderte CalDAV-Objekte):
   * fehlende Einzeltermine dieser Ressourcen gelten als gelöscht.
   */
  refreshedRefs: string[];
  /** Fehler einzelner Ressourcen (z. B. ungültige Daten); der Rest wird verarbeitet */
  errors?: { ref: string; message: string }[];
  /**
   * true: records ist der vollständige Bestand der Quelle; alles andere gilt als gelöscht.
   * false: nur Änderungen seit dem Cursor.
   */
  complete: boolean;
  /** Neuer Cursor, wird erst nach erfolgreicher Verarbeitung gespeichert */
  cursor: Record<string, unknown> | null;
}

export interface ExternalSource {
  /** Stabile Kennung der Quelle in der Verbindung (URL oder href) */
  remoteId: string;
  name: string;
  kinds: RecordKind[];
  /** Zusatzinfos, z. B. Farbe oder unterstützte Komponenten */
  meta?: Record<string, unknown>;
}

export interface ConnectorContext {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  http: SafeHttpClient;
  /** Zeitzone für Zeiten ohne Zone (floating) */
  timeZone: string;
  now: () => number;
  signal?: AbortSignal;
}

export interface TestResult {
  accountLabel: string;
  sources: ExternalSource[];
  capabilities: Record<string, boolean>;
}

export interface ConnectorDefinition {
  type: string;
  displayName: string;
  authKind: 'basic' | 'none';
  /** Felder der Konfiguration (nicht geheim) und der Geheimnisse, für die Oberfläche */
  configFields: string[];
  secretFields: string[];
  capabilities: { kinds: RecordKind[]; incremental: boolean; write: boolean };
  /** Konfiguration prüfen und normalisieren; wirft ConnectorError bei ungültigen Werten */
  validateConfig(config: Record<string, unknown>): Record<string, unknown>;
  testConnection(ctx: ConnectorContext): Promise<TestResult>;
  discoverSources(ctx: ConnectorContext): Promise<ExternalSource[]>;
  pull(
    ctx: ConnectorContext,
    source: { remoteId: string; options: SourceOptions },
    cursor: Record<string, unknown> | null,
  ): Promise<PullResult>;
}

export interface SourceOptions {
  /** Terminserien in Einzeltermine im Zeitfenster aufteilen (Standard) oder als eine Zeile */
  expandRecurring: boolean;
  /** Zeitfenster für Wiederholungen in Tagen relativ zu heute */
  windowPastDays: number;
  windowFutureDays: number;
}

export const DEFAULT_SOURCE_OPTIONS: SourceOptions = {
  expandRecurring: true,
  windowPastDays: 30,
  windowFutureDays: 180,
};

/** Fehlerarten: auth stoppt den Zeitplan bis zur Nutzeraktion, die anderen zählen als Fehlschlag. */
export type ConnectorErrorCode = 'auth' | 'config' | 'network' | 'protocol' | 'not_found';

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}
