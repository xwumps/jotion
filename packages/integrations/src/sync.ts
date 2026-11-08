import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@jotion/db';
import { appendTextParagraphs } from '@jotion/editor/projection';
import { fromStorage, toStorage, type StoredColumns } from '@jotion/query';
import {
  keyBetween,
  mappingSchema,
  parsePropertyConfig,
  PropertyValueError,
  sourceOptionsSchema,
  validatePropertyValue,
  type DeletionPolicy,
  type Mapping,
  type PropertyType,
  type PropertyValue,
  type SyncStats,
} from '@jotion/shared';
import * as Y from 'yjs';
import { connectorFor } from './connectors';
import type { SecretBox } from './crypto';
import {
  canonical,
  collectMissingOptions,
  mapRecord,
  mappingHash,
  optionColor,
  SYNC_STATUS_ACTIVE,
  SYNC_STATUS_REMOVED,
  type MapProperty,
} from './mapping';
import type { SafeHttpClient } from './safe-http';
import {
  ConnectorError,
  type ConnectorContext,
  type ConnectorDefinition,
  type ExternalRecord,
  type SourceOptions,
} from './sdk';

/**
 * Sync-Engine (Phase 8). Ablauf je Verbindung:
 *  1. Sperre (Lease in integration_connections, verfällt nach Absturz), alte "running"-Läufe abschließen
 *  2. je aktiver Quelle: Datensätze holen (Cursor), fehlende Optionen anlegen
 *  3. je Datensatz eine Transaktion: external_entities sperren, Zeile anlegen oder per
 *     Drei-Wege-Vergleich aktualisieren (Ownership je Feld), Konflikte protokollieren
 *  4. Löschungen nach Richtlinie (mark, archive, trash; nie endgültig)
 *  5. Cursor erst nach vollständiger Verarbeitung speichern: ein abgebrochener Lauf wiederholt
 *     beim nächsten Mal dieselben Datensätze, ohne Dubletten (Upsert nur über external_entities)
 */

type Tx = Prisma.TransactionClient;

export interface SyncEngineOptions {
  prisma: PrismaClient;
  box: SecretBox;
  http: () => SafeHttpClient;
  timeZone: string;
  now?: () => number;
  connectors?: Record<string, ConnectorDefinition>;
  /** Nach Änderungen an Zeilen (Formeln, Rollups, Diagramm-Cache) */
  onRowsChanged?: (databaseId: string, rowIds: string[], actorId: string) => Promise<void>;
  /** Tests: wird nach jedem Datensatz aufgerufen (Abbruch simulieren) */
  afterRecord?: (count: number) => void | Promise<void>;
  /** Dauer der Sperre; wird während des Laufs verlängert */
  lockMs?: number;
}

export type SyncOutcome =
  | { runId: string; status: 'succeeded' | 'partial' | 'failed'; stats: SyncStats }
  | { skipped: 'locked' | 'not_found' | 'disabled' };

/** Höchstzahl Fehlermeldungen je Lauf */
const MAX_ERRORS = 50;
/** Nach so vielen Fehlschlägen in Folge wird die Verbindung pausiert */
export const MAX_CONSECUTIVE_FAILURES = 5;

const emptyStats = (): SyncStats => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  deleted: 0,
  conflicts: 0,
  skipped: 0,
  errors: 0,
});

export const secretsContext = (connectionId: string) => `integration:${connectionId}`;

interface TargetDb {
  id: string;
  workspaceId: string;
  scope: string;
  ownerId: string;
}

interface Entity {
  id: string;
  row_id: string | null;
  version: string | null;
  field_state: Record<string, unknown>;
  remote_deleted_at: Date | null;
  suppressed: boolean;
}

interface ValueRow {
  property_id: string;
  v_text: string | null;
  v_number: number | null;
  v_bool: boolean | null;
  v_date_start: Date | null;
  v_date_end: Date | null;
  v_date_has_time: boolean | null;
  v_tz: string | null;
  v_option_ids: string[] | null;
  v_user_ids: string[] | null;
  v_json: unknown;
}

const columns = (r: ValueRow): StoredColumns => ({
  vText: r.v_text,
  vNumber: r.v_number,
  vBool: r.v_bool,
  vDateStart: r.v_date_start,
  vDateEnd: r.v_date_end,
  vDateHasTime: r.v_date_has_time,
  vTz: r.v_tz,
  vOptionIds: r.v_option_ids ?? [],
  vUserIds: r.v_user_ids ?? [],
  vJson: r.v_json,
});

class LockLostError extends Error {
  constructor() {
    super('Sperre verloren (Lauf dauerte zu lange oder wurde übernommen)');
  }
}

/** Einzeltermin, der nur aus dem Zeitfenster gewandert ist, gilt nicht als gelöscht. */
/** Beginn eines Datensatzes (Datumsfeld) als Zeitpunkt, für remote_start */
export function recordStart(record: ExternalRecord): Date | null {
  const d = record.fields.date;
  if (!d || typeof d !== 'object' || Array.isArray(d) || !('start' in d)) return null;
  const ms = Date.parse(d.hasTime ? d.start : `${d.start}T00:00:00Z`);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export function agedOut(externalId: string, windowStartMs: number): boolean {
  const i = externalId.lastIndexOf('#');
  if (i < 0) return false;
  const rid = externalId.slice(i + 1);
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(rid) ? Date.parse(`${rid}T23:59:59Z`) : Date.parse(rid);
  return Number.isFinite(ms) && ms < windowStartMs;
}

export class SyncEngine {
  private readonly now: () => number;
  private readonly lockMs: number;

  constructor(private readonly o: SyncEngineOptions) {
    this.now = o.now ?? Date.now;
    this.lockMs = o.lockMs ?? 10 * 60_000;
  }

  private connector(type: string): ConnectorDefinition {
    return this.o.connectors?.[type] ?? connectorFor(type);
  }

  /** Geheimnisse einer Verbindung entschlüsseln (bei altem Schlüssel neu verschlüsseln). */
  async secretsOf(conn: { id: string; secrets: string | null }): Promise<Record<string, string>> {
    if (!conn.secrets) return {};
    const ctx = secretsContext(conn.id);
    const plain = this.o.box.decrypt(conn.secrets, ctx);
    if (this.o.box.needsRotation(conn.secrets))
      await this.o.prisma.integrationConnection.update({
        where: { id: conn.id },
        data: { secrets: this.o.box.encrypt(plain, ctx) },
      });
    return JSON.parse(plain) as Record<string, string>;
  }

  context(config: Record<string, unknown>, secrets: Record<string, string>): ConnectorContext {
    return { config, secrets, http: this.o.http(), timeZone: this.o.timeZone, now: this.now };
  }

  // ---------------------------------------------------------------- Lauf

  async run(connectionId: string, trigger: 'manual' | 'schedule'): Promise<SyncOutcome> {
    const conn = await this.o.prisma.integrationConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn) return { skipped: 'not_found' };
    if (trigger === 'schedule' && (conn.status !== 'active' || !conn.syncEnabled))
      return { skipped: 'disabled' };

    const lockId = randomUUID();
    const got = await this.o.prisma.$executeRaw`
      UPDATE integration_connections
         SET sync_lock_id = ${lockId}::uuid, sync_locked_until = now() + ${`${this.lockMs} milliseconds`}::interval
       WHERE id = ${connectionId}::uuid AND (sync_locked_until IS NULL OR sync_locked_until < now())`;
    if (!got) return { skipped: 'locked' };
    let lastRenew = Date.now();
    const renew = async () => {
      if (Date.now() - lastRenew < this.lockMs / 3) return;
      const n = await this.o.prisma.$executeRaw`
        UPDATE integration_connections SET sync_locked_until = now() + ${`${this.lockMs} milliseconds`}::interval
         WHERE id = ${connectionId}::uuid AND sync_lock_id = ${lockId}::uuid`;
      if (!n) throw new LockLostError();
      lastRenew = Date.now();
    };

    // Läufe, die durch einen Absturz nie abgeschlossen wurden
    await this.o.prisma.syncRun.updateMany({
      where: { connectionId, status: 'running' },
      data: {
        status: 'failed',
        errorMessage: 'Abgebrochen (Prozess beendet)',
        finishedAt: new Date(),
      },
    });
    const run = await this.o.prisma.syncRun.create({ data: { connectionId, trigger } });
    const stats = emptyStats();
    const errors: { source?: string; externalId?: string; message: string }[] = [];
    const addError = (e: { source?: string; externalId?: string; message: string }) => {
      stats.errors++;
      if (errors.length < MAX_ERRORS) errors.push(e);
    };

    let fatal: Error | null = null;
    try {
      const connector = this.connector(conn.type);
      const ctx = this.context(conn.config as Record<string, unknown>, await this.secretsOf(conn));
      const sources = await this.o.prisma.integrationSource.findMany({
        where: { connectionId, enabled: true, targetDatabaseId: { not: null } },
        orderBy: { createdAt: 'asc' },
      });
      let failed: Error | null = null;
      let failedSources = 0;
      for (const source of sources) {
        try {
          await this.syncSource(conn.ownerId, connector, ctx, source, stats, addError, renew);
        } catch (err) {
          // Anmeldefehler betreffen alle Quellen
          if (err instanceof ConnectorError && err.code === 'auth') throw err;
          if (err instanceof LockLostError) throw err;
          failed = err as Error;
          failedSources++;
          addError({ source: source.name, message: (err as Error).message });
        }
      }
      // Keine Quelle erfolgreich: der Lauf ist fehlgeschlagen
      if (failed && failedSources === sources.length) fatal = failed;
    } catch (err) {
      fatal = err as Error;
    }

    const status: 'succeeded' | 'partial' | 'failed' = fatal
      ? 'failed'
      : stats.errors
        ? 'partial'
        : 'succeeded';
    await this.o.prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status,
        stats: stats as unknown as Prisma.InputJsonValue,
        errors: errors as unknown as Prisma.InputJsonValue,
        errorMessage: fatal?.message ?? null,
        finishedAt: new Date(),
      },
    });
    const auth = fatal instanceof ConnectorError && fatal.code === 'auth';
    const failures = fatal ? conn.consecutiveFailures + 1 : 0;
    await this.o.prisma.integrationConnection.update({
      where: { id: connectionId },
      data: {
        lastSyncAt: new Date(this.now()),
        nextSyncAt: new Date(this.now() + conn.intervalMinutes * 60_000),
        consecutiveFailures: failures,
        // Anmeldefehler: Zeitplan anhalten bis zur Nutzeraktion; nach 5 Fehlschlägen pausieren
        ...(auth
          ? { status: 'error', statusMessage: fatal!.message }
          : failures >= MAX_CONSECUTIVE_FAILURES
            ? {
                status: 'paused',
                statusMessage: `Nach ${failures} Fehlschlägen pausiert: ${fatal!.message}`,
              }
            : fatal
              ? { statusMessage: fatal.message }
              : { status: 'active', statusMessage: null }),
        syncLockId: null,
        syncLockedUntil: null,
      },
    });
    return { runId: run.id, status, stats };
  }

  // ---------------------------------------------------------------- Quelle

  private async target(targetId: string, ownerId: string): Promise<TargetDb> {
    const [db] = await this.o.prisma.$queryRaw<
      {
        id: string;
        source_id: string | null;
        workspace_id: string;
        scope: string;
        owner_id: string;
        deleted_at: Date | null;
      }[]
    >`
      SELECT p.id::text, d.source_database_id::text AS source_id, p.workspace_id::text, p.scope::text, p.owner_id::text, p.deleted_at
        FROM databases d JOIN pages p ON p.id = d.id WHERE d.id = ${targetId}::uuid`;
    if (!db) throw new ConnectorError('config', 'Ziel-Datenbank existiert nicht mehr');
    if (db.source_id) return this.target(db.source_id, ownerId);
    if (db.deleted_at) throw new ConnectorError('config', 'Ziel-Datenbank liegt im Papierkorb');
    if (db.scope === 'PRIVATE' && db.owner_id !== ownerId)
      throw new ConnectorError('config', 'Kein Zugriff auf die Ziel-Datenbank');
    return { id: db.id, workspaceId: db.workspace_id, scope: db.scope, ownerId: db.owner_id };
  }

  async properties(databaseId: string): Promise<MapProperty[]> {
    const rows = await this.o.prisma.dbProperty.findMany({
      where: { databaseId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type as PropertyType,
      config: p.config,
    }));
  }

  private async syncSource(
    ownerId: string,
    connector: ConnectorDefinition,
    ctx: ConnectorContext,
    source: {
      id: string;
      name: string;
      remoteId: string;
      targetDatabaseId: string | null;
      mapping: unknown;
      options: unknown;
      deletionPolicy: string;
      cursor: unknown;
    },
    stats: SyncStats,
    addError: (e: { source?: string; externalId?: string; message: string }) => void,
    renew: () => Promise<void>,
  ) {
    const db = await this.target(source.targetDatabaseId!, ownerId);
    const mapping = mappingSchema.parse(source.mapping ?? {});
    const options: SourceOptions = sourceOptionsSchema.parse(source.options ?? {});
    const pulled = await connector.pull(
      ctx,
      { remoteId: source.remoteId, options },
      (source.cursor as Record<string, unknown> | null) ?? null,
    );
    for (const e of pulled.errors ?? [])
      addError({ source: source.name, message: `${e.ref}: ${e.message}` });
    const records = pulled.records.map((r) => ({
      ...r,
      fields: { ...r.fields, source: source.name },
    }));

    // Fehlende Optionen einmal je Lauf anlegen
    let props = await this.properties(db.id);
    const missing = collectMissingOptions(records, mapping, props);
    if (missing.size) {
      await this.addOptions(db, missing, ownerId);
      props = await this.properties(db.id);
    }
    const version = mappingHash(mapping, options);
    const policy = source.deletionPolicy as DeletionPolicy;
    const changedRows = new Set<string>();
    const seen = new Set<string>();
    let count = 0;
    for (const record of records) {
      seen.add(record.externalId);
      try {
        const r = await this.o.prisma.$transaction((tx) =>
          this.processRecord(tx, db, ownerId, source.id, record, mapping, props, version),
        );
        stats[r.result]++;
        if (r.conflicts) stats.conflicts += r.conflicts;
        if (r.rowId && r.result !== 'unchanged' && r.result !== 'skipped') changedRows.add(r.rowId);
        for (const m of r.errors)
          addError({ source: source.name, externalId: record.externalId, message: m });
      } catch (err) {
        addError({
          source: source.name,
          externalId: record.externalId,
          message: (err as Error).message,
        });
      }
      count++;
      await this.o.afterRecord?.(count);
      await renew();
    }

    // Löschungen
    const windowStart = this.now() - options.windowPastDays * 86_400_000;
    const candidates = await this.o.prisma.externalEntity.findMany({
      where: { sourceId: source.id, remoteDeletedAt: null, suppressed: false },
      select: { id: true, externalId: true, remoteRef: true, remoteStart: true },
    });
    // Phase 11: Datensätze vor dem Zeitfenster der Quelle fehlen absichtlich, nicht gelöscht
    const keepBefore = pulled.windowStart ? Date.parse(pulled.windowStart) : null;
    const beforeWindow = (d: Date | null) =>
      keepBefore !== null && d !== null && d.getTime() < keepBefore;
    const refreshed = new Set(pulled.refreshedRefs);
    const deletedRefs = new Set(pulled.deletedRefs);
    let gone = candidates.filter(
      (e) =>
        // Im selben Abruf wieder geliefert (z. B. Datei verschoben): nicht gelöscht
        (e.remoteRef !== null && deletedRefs.has(e.remoteRef) && !seen.has(e.externalId)) ||
        (!seen.has(e.externalId) &&
          !agedOut(e.externalId, windowStart) &&
          !beforeWindow(e.remoteStart) &&
          (pulled.complete || (e.remoteRef !== null && refreshed.has(e.remoteRef)))),
    );
    // Schutz: leere vollständige Antwort bei vorhandenen Einträgen ist eher ein Serverfehler
    if (pulled.complete && records.length === 0 && gone.length > 0 && !pulled.deletedRefs.length) {
      addError({
        source: source.name,
        message: 'Quelle lieferte keine Einträge; Löschungen übersprungen',
      });
      gone = [];
    }
    for (const e of gone) {
      try {
        const rowId = await this.o.prisma.$transaction((tx) =>
          this.markDeleted(tx, db, ownerId, e.id, policy, mapping),
        );
        stats.deleted++;
        if (rowId) changedRows.add(rowId);
      } catch (err) {
        addError({
          source: source.name,
          externalId: e.externalId,
          message: (err as Error).message,
        });
      }
      await renew();
    }

    // Cursor erst jetzt: ein abgebrochener Lauf holt beim nächsten Mal dieselben Daten erneut
    await this.o.prisma.integrationSource.update({
      where: { id: source.id },
      data: {
        cursor: (pulled.cursor ?? Prisma.DbNull) as Prisma.InputJsonValue,
        lastSyncedAt: new Date(this.now()),
      },
    });
    if (changedRows.size) {
      await this.o.prisma.$executeRaw`
        INSERT INTO change_events (workspace_id, type, entity_id, actor_id, audience_user_id, payload)
        VALUES (${db.workspaceId}::uuid, 'database.rows.changed', ${db.id}::uuid, ${ownerId}::uuid,
                ${db.scope === 'PRIVATE' ? db.ownerId : null}::uuid,
                ${JSON.stringify({ rowIds: [...changedRows].slice(0, 200), sync: true })}::jsonb)`;
      await this.o.onRowsChanged?.(db.id, [...changedRows], ownerId);
    }
  }

  /** Neue Optionen in Auswahl-Properties (Name aus der Quelle, Farbe stabil aus dem Namen). */
  async addOptions(db: TargetDb, missing: Map<string, string[]>, actorId: string) {
    await this.o.prisma.$transaction(async (tx) => {
      for (const [pid, names] of missing) {
        const [row] = await tx.$queryRaw<{ type: string; config: unknown }[]>`
          SELECT type::text, config FROM db_properties WHERE id = ${pid}::uuid FOR UPDATE`;
        if (!row) continue;
        const cfg = parsePropertyConfig(row.type as PropertyType, row.config) as {
          options: { id: string; name: string; color: string }[];
        };
        const options = [...cfg.options];
        for (const name of names) {
          if (options.some((o) => o.name.trim().toLowerCase() === name.trim().toLowerCase()))
            continue;
          if (options.length >= 500) break;
          options.push({
            id: randomUUID(),
            name: name.trim().slice(0, 100),
            color: optionColor(name),
          });
        }
        await tx.dbProperty.update({ where: { id: pid }, data: { config: { ...cfg, options } } });
      }
      await tx.$executeRaw`
        INSERT INTO change_events (workspace_id, type, entity_id, actor_id, audience_user_id, payload)
        VALUES (${db.workspaceId}::uuid, 'database.changed', ${db.id}::uuid, ${actorId}::uuid,
                ${db.scope === 'PRIVATE' ? db.ownerId : null}::uuid, '{}'::jsonb)`;
    });
  }

  // ---------------------------------------------------------------- Datensatz

  private async processRecord(
    tx: Tx,
    db: TargetDb,
    ownerId: string,
    sourceId: string,
    record: ExternalRecord,
    mapping: Mapping,
    props: MapProperty[],
    mapVersion: string,
  ): Promise<{
    result: 'created' | 'updated' | 'unchanged' | 'skipped';
    rowId: string | null;
    conflicts: number;
    errors: string[];
  }> {
    // Eintrag anlegen oder sperren: parallele Läufe warten hier aufeinander
    // Phase 11: Beginn des Datensatzes merken (Schutz vor Löschung, wenn er aus dem Zeitfenster fällt)
    const remoteStart = recordStart(record);
    await tx.$executeRaw`
      INSERT INTO external_entities (id, source_id, external_id, weak_id, remote_ref, remote_start, updated_at)
      VALUES (${randomUUID()}::uuid, ${sourceId}::uuid, ${record.externalId}, ${record.weakId}, ${record.remoteRef}, ${remoteStart}::timestamptz, now())
      ON CONFLICT (source_id, external_id) DO UPDATE SET remote_start = EXCLUDED.remote_start`;
    const [entity] = await tx.$queryRaw<Entity[]>`
      SELECT id::text, row_id::text, version, field_state, remote_deleted_at, suppressed
        FROM external_entities WHERE source_id = ${sourceId}::uuid AND external_id = ${record.externalId} FOR UPDATE`;
    if (!entity) throw new Error('Eintrag nicht gefunden');
    if (entity.suppressed) return { result: 'skipped', rowId: null, conflicts: 0, errors: [] };

    const version = `${record.version}:${mapVersion}`;
    const { values, errors: mapErrors } = mapRecord(record, mapping, props);
    const byId = new Map(props.map((p) => [p.id, p]));
    const errors = [...mapErrors];
    // Werte validieren; ungültige Felder auslassen
    for (const [target, v] of [...values]) {
      if (target === 'title') continue;
      try {
        values.set(target, validatePropertyValue(byId.get(target)!, v));
      } catch (err) {
        if (!(err instanceof PropertyValueError)) throw err;
        errors.push(`${byId.get(target)!.name}: ${err.message}`);
        values.delete(target);
      }
    }
    const typeOf = (target: string): PropertyType | 'title' =>
      target === 'title' ? 'title' : byId.get(target)!.type;

    // Zeile vorhanden?
    let row:
      { id: string; deleted_at: Date | null; archived_at: Date | null; title: string } | undefined;
    if (entity.row_id)
      [row] = await tx.$queryRaw<(typeof row)[]>`
        SELECT id::text, deleted_at, archived_at, title FROM pages WHERE id = ${entity.row_id}::uuid`;
    if (row && row.deleted_at && !entity.remote_deleted_at) {
      // Lokal gelöscht: nie wieder anlegen
      await tx.$executeRaw`UPDATE external_entities SET suppressed = true, updated_at = now() WHERE id = ${entity.id}::uuid`;
      return { result: 'skipped', rowId: null, conflicts: 0, errors: [] };
    }
    if (entity.row_id && !row && !entity.remote_deleted_at) {
      await tx.$executeRaw`UPDATE external_entities SET suppressed = true, updated_at = now() WHERE id = ${entity.id}::uuid`;
      return { result: 'skipped', rowId: null, conflicts: 0, errors: [] };
    }

    const state: Record<string, unknown> = {};
    for (const [k, v] of values) state[k] = v;

    if (row?.deleted_at) {
      // Nach Remote-Löschung (Richtlinie trash) in den Papierkorb gelegt und zurückgekehrt: wiederherstellen
      await tx.$executeRaw`
        UPDATE pages SET deleted_at = NULL, deleted_by_id = NULL, trash_root_id = NULL
         WHERE trash_root_id = ${row.id}::uuid`;
      await tx.$executeRaw`
        INSERT INTO change_events (workspace_id, type, entity_id, actor_id, audience_user_id, payload)
        VALUES (${db.workspaceId}::uuid, 'page.restored', ${row.id}::uuid, ${ownerId}::uuid,
                ${db.scope === 'PRIVATE' ? db.ownerId : null}::uuid, ${JSON.stringify({ parentId: db.id })}::jsonb)`;
      row = { ...row, deleted_at: null };
    }

    if (!row) {
      const rowId = await this.createRow(tx, db, ownerId, values, props, mapping, record);
      await tx.$executeRaw`
        UPDATE external_entities SET row_id = ${rowId}::uuid, version = ${version}, field_state = ${JSON.stringify(state)}::jsonb,
               remote_ref = ${record.remoteRef}, weak_id = ${record.weakId}, remote_deleted_at = NULL, updated_at = now()
         WHERE id = ${entity.id}::uuid`;
      return { result: 'created', rowId, conflicts: 0, errors };
    }

    if (entity.version === version && !entity.remote_deleted_at)
      return { result: 'unchanged', rowId: row.id, conflicts: 0, errors };

    // Drei-Wege-Vergleich je Feld
    const local = await this.localValues(tx, row.id, row.title, [...values.keys()], byId);
    const base = entity.field_state ?? {};
    const writes = new Map<string, PropertyValue>();
    let conflicts = 0;
    for (const f of mapping.fields) {
      if (!values.has(f.target)) continue;
      const type = typeOf(f.target);
      const remote = values.get(f.target) ?? null;
      const l = canonical(type, local.get(f.target));
      const r = canonical(type, remote);
      const hasBase = Object.prototype.hasOwnProperty.call(base, f.target);
      const b = canonical(type, base[f.target]);
      if (f.ownership === 'once') {
        // Nur beim Anlegen; Basis bleibt der erste Wert
        if (hasBase) state[f.target] = base[f.target];
        continue;
      }
      if (l === r) continue;
      if (f.ownership === 'remote' || !hasBase || l === b) {
        writes.set(f.target, remote);
        continue;
      }
      if (r === b) continue;
      // Beide geändert: lokal behalten, Konflikt protokollieren (ein offener je Feld)
      conflicts++;
      await tx.$executeRaw`DELETE FROM sync_conflicts WHERE entity_id = ${entity.id}::uuid AND field = ${f.target} AND resolved_at IS NULL`;
      await tx.syncConflict.create({
        data: {
          entityId: entity.id,
          field: f.target,
          localValue: (local.get(f.target) ?? null) as Prisma.InputJsonValue,
          remoteValue: remote as Prisma.InputJsonValue,
          baseValue: (base[f.target] ?? null) as Prisma.InputJsonValue,
        },
      });
    }
    // Zurückgekehrt nach Remote-Löschung: Status wieder aktiv, Archivierung aufheben
    if (entity.remote_deleted_at) {
      const statusWrite = this.syncStatusValue(mapping, byId, SYNC_STATUS_ACTIVE);
      if (statusWrite) writes.set(statusWrite[0], statusWrite[1]);
      if (row.archived_at)
        await tx.page.update({ where: { id: row.id }, data: { archivedAt: null } });
    }
    if (writes.size) await this.writeValues(tx, db, row.id, ownerId, writes, byId);
    await tx.$executeRaw`
      UPDATE external_entities SET version = ${version}, field_state = ${JSON.stringify(state)}::jsonb,
             remote_ref = ${record.remoteRef}, remote_deleted_at = NULL, updated_at = now()
       WHERE id = ${entity.id}::uuid`;
    return {
      result: writes.size || entity.remote_deleted_at ? 'updated' : 'unchanged',
      rowId: row.id,
      conflicts,
      errors,
    };
  }

  private syncStatusValue(
    mapping: Mapping,
    byId: Map<string, MapProperty>,
    name: string,
  ): [string, PropertyValue] | null {
    const p = mapping.syncStatusPropertyId ? byId.get(mapping.syncStatusPropertyId) : undefined;
    if (!p || p.type !== 'select') return null;
    const opts = (p.config as { options?: { id: string; name: string }[] })?.options ?? [];
    const o = opts.find((x) => x.name === name);
    return o ? [p.id, o.id] : null;
  }

  /** Aktuelle Werte der gemappten Felder einer Zeile. */
  async localValues(
    tx: Tx | PrismaClient,
    rowId: string,
    title: string,
    targets: string[],
    byId: Map<string, MapProperty>,
  ): Promise<Map<string, PropertyValue>> {
    const out = new Map<string, PropertyValue>();
    const pids = targets.filter((t) => t !== 'title');
    if (targets.includes('title')) out.set('title', title);
    if (!pids.length) return out;
    const rows = await tx.$queryRaw<ValueRow[]>`
      SELECT property_id::text, v_text, v_number, v_bool, v_date_start, v_date_end, v_date_has_time, v_tz,
             v_option_ids::text[] AS v_option_ids, v_user_ids::text[] AS v_user_ids, v_json
        FROM property_values WHERE row_id = ${rowId}::uuid AND property_id = ANY(${pids}::uuid[])`;
    for (const pid of pids) {
      const r = rows.find((x) => x.property_id === pid);
      out.set(pid, r ? fromStorage(byId.get(pid)!.type, columns(r)) : null);
    }
    return out;
  }

  /** Werte schreiben (wie RowsService.writeValues, ohne Relationen). */
  async writeValues(
    tx: Tx,
    db: TargetDb,
    rowId: string,
    actorId: string,
    values: Map<string, PropertyValue>,
    byId: Map<string, MapProperty>,
  ) {
    let title: string | undefined;
    for (const [target, v] of values) {
      if (target === 'title') {
        title = String(v ?? '');
        continue;
      }
      const prop = byId.get(target)!;
      const cols = toStorage(prop.type, v);
      if (!cols) {
        await tx.propertyValue.deleteMany({ where: { rowId, propertyId: target } });
        continue;
      }
      const data = {
        ...cols,
        vJson: cols.vJson === null ? Prisma.DbNull : (cols.vJson as Prisma.InputJsonValue),
      };
      await tx.propertyValue.upsert({
        where: { rowId_propertyId: { rowId, propertyId: target } },
        create: { rowId, propertyId: target, databaseId: db.id, ...data },
        update: data,
      });
    }
    await tx.page.update({
      where: { id: rowId },
      data: {
        ...(title !== undefined ? { title } : {}),
        lastEditedAt: new Date(),
        lastEditedById: actorId,
      },
    });
  }

  private async createRow(
    tx: Tx,
    db: TargetDb,
    ownerId: string,
    values: Map<string, PropertyValue>,
    props: MapProperty[],
    mapping: Mapping,
    record: ExternalRecord,
  ): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pages:${db.id}`}, 0))`;
    const [last] = await tx.$queryRaw<{ position: string }[]>`
      SELECT position FROM pages WHERE parent_id = ${db.id}::uuid ORDER BY position DESC LIMIT 1`;
    const byId = new Map(props.map((p) => [p.id, p]));
    const page = await tx.page.create({
      data: {
        workspaceId: db.workspaceId,
        parentId: db.id,
        databaseId: db.id,
        kind: 'DATABASE_ROW',
        position: keyBetween(last?.position ?? null, null),
        title: String(values.get('title') ?? ''),
        ownerId: db.ownerId,
        scope: db.scope as 'PRIVATE' | 'TEAM',
        createdById: ownerId,
        lastEditedById: ownerId,
      },
    });
    const rest = new Map([...values].filter(([k]) => k !== 'title'));
    const status = this.syncStatusValue(mapping, byId, SYNC_STATUS_ACTIVE);
    if (status && !rest.has(status[0])) rest.set(status[0], status[1]);
    await this.writeValues(tx, db, page.id, ownerId, rest, byId);
    // Fortlaufende IDs
    for (const p of props.filter((x) => x.type === 'unique_id')) {
      const [locked] = await tx.$queryRaw<{ config: unknown }[]>`
        SELECT config FROM db_properties WHERE id = ${p.id}::uuid FOR UPDATE`;
      const cfg = parsePropertyConfig('unique_id', locked?.config ?? {}) as {
        prefix: string | null;
        nextValue: number;
      };
      await tx.propertyValue.create({
        data: { rowId: page.id, propertyId: p.id, databaseId: db.id, vNumber: cfg.nextValue },
      });
      await tx.dbProperty.update({
        where: { id: p.id },
        data: { config: { ...cfg, nextValue: cfg.nextValue + 1 } },
      });
    }
    // Beschreibung als Seiteninhalt, nur beim Anlegen
    const description = record.fields.description;
    if (mapping.descriptionToContent && typeof description === 'string' && description.trim()) {
      const doc = new Y.Doc();
      if (appendTextParagraphs(doc, description.slice(0, 20_000), () => randomUUID()))
        await tx.pageDoc.create({
          data: { pageId: page.id, state: Buffer.from(Y.encodeStateAsUpdate(doc)) },
        });
      doc.destroy();
    }
    return page.id;
  }

  /** Remote gelöscht: Richtlinie anwenden, nie endgültig löschen. Liefert die Zeile. */
  private async markDeleted(
    tx: Tx,
    db: TargetDb,
    ownerId: string,
    entityId: string,
    policy: DeletionPolicy,
    mapping: Mapping,
  ): Promise<string | null> {
    const [e] = await tx.$queryRaw<{ row_id: string | null }[]>`
      SELECT row_id::text FROM external_entities WHERE id = ${entityId}::uuid FOR UPDATE`;
    await tx.$executeRaw`UPDATE external_entities SET remote_deleted_at = now(), updated_at = now() WHERE id = ${entityId}::uuid`;
    if (!e?.row_id) return null;
    const [row] = await tx.$queryRaw<{ id: string; deleted_at: Date | null }[]>`
      SELECT id::text, deleted_at FROM pages WHERE id = ${e.row_id}::uuid`;
    if (!row || row.deleted_at) return null;
    const props = await this.properties(db.id);
    const byId = new Map(props.map((p) => [p.id, p]));
    const status = this.syncStatusValue(mapping, byId, SYNC_STATUS_REMOVED);
    if (status) await this.writeValues(tx, db, row.id, ownerId, new Map([status]), byId);
    if (policy === 'archive')
      await tx.page.update({ where: { id: row.id }, data: { archivedAt: new Date() } });
    if (policy === 'trash') {
      await tx.$executeRaw`
        UPDATE pages SET deleted_at = now(), deleted_by_id = ${ownerId}::uuid, trash_root_id = ${row.id}::uuid
         WHERE path <@ (SELECT path FROM pages WHERE id = ${row.id}::uuid) AND deleted_at IS NULL`;
      await tx.$executeRaw`
        INSERT INTO change_events (workspace_id, type, entity_id, actor_id, audience_user_id, payload)
        VALUES (${db.workspaceId}::uuid, 'page.trashed', ${row.id}::uuid, ${ownerId}::uuid,
                ${db.scope === 'PRIVATE' ? db.ownerId : null}::uuid, ${JSON.stringify({ parentId: db.id })}::jsonb)`;
    }
    return row.id;
  }

  // ---------------------------------------------------------------- Konflikte

  /** Konflikt auflösen: "remote" schreibt den Remote-Wert, "local" behält den lokalen. */
  async resolveConflict(
    conflictId: string,
    resolution: 'remote' | 'local',
    actorId: string,
  ): Promise<string | null> {
    return this.o.prisma.$transaction(async (tx) => {
      const c = await tx.syncConflict.findUnique({
        where: { id: conflictId },
        include: { entity: { include: { source: true } } },
      });
      if (!c || c.resolvedAt) return null;
      const rowId = c.entity.rowId;
      if (resolution === 'remote' && rowId && c.entity.source.targetDatabaseId) {
        const db = await this.target(c.entity.source.targetDatabaseId, actorId).catch(() => null);
        if (db) {
          const props = await this.properties(db.id);
          const byId = new Map(props.map((p) => [p.id, p]));
          if (c.field === 'title' || byId.has(c.field))
            await this.writeValues(
              tx,
              db,
              rowId,
              actorId,
              new Map([[c.field, c.remoteValue as PropertyValue]]),
              byId,
            );
        }
      }
      await tx.syncConflict.update({
        where: { id: c.id },
        data: { resolvedAt: new Date(), resolution },
      });
      return rowId;
    });
  }
}
