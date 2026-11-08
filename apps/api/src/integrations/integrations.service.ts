import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type IntegrationConnection,
  type IntegrationSource,
  type SyncRun,
} from '@jotion/db';
import {
  CONNECTORS,
  ConnectorError,
  connectorFor,
  mapRecord,
  collectMissingOptions,
  secretsContext,
  suggestMapping,
  suggestedProperties,
  type ConnectorDefinition,
  type ExternalRecord,
  type MapProperty,
  type RecordKind,
} from '@jotion/integrations';
import {
  createConnectionSchema,
  createTargetDatabaseSchema,
  disconnectSchema,
  mappingSchema,
  resolveConflictSchema,
  sourceOptionsSchema,
  testConnectionSchema,
  updateConnectionSchema,
  updateSourceSchema,
  type ConflictDto,
  type ConnectionDto,
  type ConnectionTestDto,
  type ConnectorType,
  type DeletionPolicy,
  type Mapping,
  type MappingPreviewDto,
  type MappingField,
  type PropertyType,
  type SourceDto,
  type SyncRunDto,
} from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import { AppError, notFound } from '../common/errors';
import { RateLimitService } from '../common/rate-limit.service';
import type { AuthUser } from '../common/request-context';
import { parse } from '../common/validation';
import { SERVER_ENV } from '../config/config.module';
import { DatabaseAccessService } from '../databases/database-access';
import { DatabasesService } from '../databases/databases.service';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../permissions/permission.service';
import { SyncRunnerService } from './sync-runner.service';

const runDto = (r: SyncRun): SyncRunDto => ({
  id: r.id,
  trigger: r.trigger as SyncRunDto['trigger'],
  status: r.status as SyncRunDto['status'],
  stats: r.stats as SyncRunDto['stats'],
  errors: (r.errors as SyncRunDto['errors']) ?? [],
  errorMessage: r.errorMessage,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
});

const connectorError = (err: unknown): { code: string; message: string } => {
  if (err instanceof ConnectorError) return { code: err.code, message: err.message };
  return { code: 'internal', message: (err as Error).message };
};

/**
 * Phase 8: Integrationen eines Nutzers im Workspace. Verbindungen gehören ihrem Ersteller
 * (Zugangsdaten sind persönlich); synchronisiert wird in Datenbanken, die er bearbeiten darf.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly access: DatabaseAccessService,
    private readonly databases: DatabasesService,
    private readonly runner: SyncRunnerService,
    private readonly limits: RateLimitService,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
  ) {}

  connectors() {
    return Object.values(CONNECTORS).map((c) => ({
      type: c.type,
      displayName: c.displayName,
      configFields: c.configFields,
      secretFields: c.secretFields,
      capabilities: c.capabilities,
    }));
  }

  // ---------------------------------------------------------------- Laden

  private async requireConnection(user: AuthUser, workspaceId: string, id: string) {
    await this.perms.requireMember(user.id, workspaceId);
    const c = await this.prisma.client.integrationConnection.findUnique({ where: { id } });
    if (!c || c.workspaceId !== workspaceId || c.ownerId !== user.id) throw notFound('Verbindung');
    return c;
  }

  private async requireSource(
    user: AuthUser,
    workspaceId: string,
    connectionId: string,
    sourceId: string,
  ) {
    const conn = await this.requireConnection(user, workspaceId, connectionId);
    const source = await this.prisma.client.integrationSource.findUnique({
      where: { id: sourceId },
    });
    if (!source || source.connectionId !== conn.id) throw notFound('Quelle');
    return { conn, source };
  }

  private sourceDto(
    s: IntegrationSource,
    titles: Map<string, string>,
    counts: Map<string, number>,
  ): SourceDto {
    return {
      id: s.id,
      remoteId: s.remoteId,
      name: s.name,
      kinds: s.kinds,
      enabled: s.enabled,
      targetDatabaseId: s.targetDatabaseId,
      targetDatabaseTitle: s.targetDatabaseId ? (titles.get(s.targetDatabaseId) ?? null) : null,
      mapping: mappingSchema.parse(s.mapping ?? {}),
      options: sourceOptionsSchema.parse(s.options ?? {}),
      deletionPolicy: s.deletionPolicy as DeletionPolicy,
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
      entityCount: counts.get(s.id) ?? 0,
    };
  }

  private async toDtos(conns: IntegrationConnection[]): Promise<ConnectionDto[]> {
    if (!conns.length) return [];
    const ids = conns.map((c) => c.id);
    const [sources, runs, conflicts] = await Promise.all([
      this.prisma.client.integrationSource.findMany({
        where: { connectionId: { in: ids } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.client.$queryRaw<SyncRun[]>`
        SELECT DISTINCT ON (connection_id) id, connection_id AS "connectionId", trigger, status, stats, errors,
               error_message AS "errorMessage", started_at AS "startedAt", finished_at AS "finishedAt"
          FROM sync_runs WHERE connection_id = ANY(${ids}::uuid[]) ORDER BY connection_id, started_at DESC`,
      this.prisma.client.$queryRaw<{ connection_id: string; n: number }[]>`
        SELECT s.connection_id::text, count(*)::int AS n FROM sync_conflicts c
          JOIN external_entities e ON e.id = c.entity_id JOIN integration_sources s ON s.id = e.source_id
         WHERE s.connection_id = ANY(${ids}::uuid[]) AND c.resolved_at IS NULL GROUP BY s.connection_id`,
    ]);
    const sourceIds = sources.map((s) => s.id);
    const counts = new Map(
      (
        await this.prisma.client.$queryRaw<{ source_id: string; n: number }[]>`
          SELECT source_id::text, count(*)::int AS n FROM external_entities
           WHERE source_id = ANY(${sourceIds}::uuid[]) AND row_id IS NOT NULL AND NOT suppressed GROUP BY source_id`
      ).map((r) => [r.source_id, r.n]),
    );
    const dbIds = [
      ...new Set(sources.map((s) => s.targetDatabaseId).filter((x): x is string => !!x)),
    ];
    const titles = new Map(
      (
        await this.prisma.client.page.findMany({
          where: { id: { in: dbIds }, deletedAt: null },
          select: { id: true, title: true },
        })
      ).map((p) => [p.id, p.title]),
    );
    return conns.map((c) => {
      const run = runs.find((r) => r.connectionId === c.id);
      return {
        id: c.id,
        type: c.type as ConnectorType,
        name: c.name,
        config: c.config as Record<string, unknown>,
        secretKeys: this.secretKeys(c),
        status: c.status as ConnectionDto['status'],
        statusMessage: c.statusMessage,
        accountLabel: c.accountLabel,
        syncEnabled: c.syncEnabled,
        intervalMinutes: c.intervalMinutes,
        nextSyncAt: c.nextSyncAt?.toISOString() ?? null,
        lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
        sources: sources
          .filter((s) => s.connectionId === c.id)
          .map((s) => this.sourceDto(s, titles, counts)),
        lastRun: run ? runDto(run) : null,
        openConflicts: conflicts.find((x) => x.connection_id === c.id)?.n ?? 0,
      };
    });
  }

  /** Namen der gespeicherten Geheimnisse (Werte verlassen den Server nie) */
  private secretKeys(c: IntegrationConnection): string[] {
    if (!c.secrets) return [];
    try {
      return Object.keys(
        JSON.parse(this.runner.box.decrypt(c.secrets, secretsContext(c.id))) as object,
      );
    } catch {
      return [];
    }
  }

  async list(user: AuthUser, workspaceId: string): Promise<ConnectionDto[]> {
    await this.perms.requireMember(user.id, workspaceId);
    const conns = await this.prisma.client.integrationConnection.findMany({
      where: { workspaceId, ownerId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    return this.toDtos(conns);
  }

  async get(user: AuthUser, workspaceId: string, id: string): Promise<ConnectionDto> {
    const c = await this.requireConnection(user, workspaceId, id);
    return (await this.toDtos([c]))[0]!;
  }

  // ---------------------------------------------------------------- Verbindung

  private validate(connector: ConnectorDefinition, config: Record<string, unknown>) {
    try {
      return connector.validateConfig(config);
    } catch (err) {
      if (err instanceof ConnectorError) throw new AppError('validation_failed', err.message);
      throw err;
    }
  }

  private async runTest(
    connector: ConnectorDefinition,
    config: Record<string, unknown>,
    secrets: Record<string, string>,
  ): Promise<ConnectionTestDto> {
    try {
      const r = await connector.testConnection(this.runner.engine.context(config, secrets));
      return {
        ok: true,
        accountLabel: r.accountLabel,
        sources: r.sources.map((s) => ({ remoteId: s.remoteId, name: s.name, kinds: s.kinds })),
        capabilities: r.capabilities,
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        accountLabel: null,
        sources: [],
        capabilities: {},
        error: connectorError(err),
      };
    }
  }

  /** Verbindung testen, ohne zu speichern. */
  async test(user: AuthUser, workspaceId: string, body: unknown): Promise<ConnectionTestDto> {
    await this.perms.requireMember(user.id, workspaceId);
    const input = parse(testConnectionSchema, body);
    await this.limits.hit(`integration-test:${user.id}`, 20, 60);
    const connector = connectorFor(input.type);
    return this.runTest(connector, this.validate(connector, input.config), input.secrets);
  }

  async create(user: AuthUser, workspaceId: string, body: unknown): Promise<ConnectionDto> {
    await this.perms.requireMember(user.id, workspaceId);
    const input = parse(createConnectionSchema, body);
    await this.limits.hit(`integration-test:${user.id}`, 20, 60);
    const connector = connectorFor(input.type);
    const config = this.validate(connector, input.config);
    const secrets = Object.fromEntries(Object.entries(input.secrets).filter(([, v]) => v !== ''));
    const test = await this.runTest(connector, config, secrets);
    if (!test.ok)
      throw new AppError('validation_failed', test.error!.message, { connector: test.error });
    const id = randomUUID();
    const created = await this.prisma.client.$transaction(async (tx) => {
      const c = await tx.integrationConnection.create({
        data: {
          id,
          workspaceId,
          ownerId: user.id,
          type: input.type,
          name: input.name,
          config: config as Prisma.InputJsonValue,
          secrets: Object.keys(secrets).length
            ? this.runner.box.encrypt(JSON.stringify(secrets), secretsContext(id))
            : null,
          accountLabel: test.accountLabel,
          intervalMinutes: input.intervalMinutes,
          nextSyncAt: new Date(Date.now() + input.intervalMinutes * 60_000),
        },
      });
      for (const s of test.sources)
        await tx.integrationSource.create({
          data: {
            connectionId: c.id,
            remoteId: s.remoteId,
            name: s.name,
            kinds: s.kinds,
            // Erst nach Wahl der Ziel-Datenbank aktiv
            enabled: false,
            options: sourceOptionsSchema.parse({}) as Prisma.InputJsonValue,
          },
        });
      return c;
    });
    return (await this.toDtos([created]))[0]!;
  }

  async update(
    user: AuthUser,
    workspaceId: string,
    id: string,
    body: unknown,
  ): Promise<ConnectionDto> {
    const c = await this.requireConnection(user, workspaceId, id);
    const input = parse(updateConnectionSchema, body);
    const connector = connectorFor(c.type);
    const data: Prisma.IntegrationConnectionUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.intervalMinutes !== undefined) {
      data.intervalMinutes = input.intervalMinutes;
      data.nextSyncAt = new Date(Date.now() + input.intervalMinutes * 60_000);
    }
    if (input.syncEnabled !== undefined) data.syncEnabled = input.syncEnabled;
    let credentialsChanged = false;
    let config = c.config as Record<string, unknown>;
    let secrets = await this.runner.engine.secretsOf(c);
    if (input.config) {
      config = this.validate(connector, { ...config, ...input.config });
      data.config = config as Prisma.InputJsonValue;
      credentialsChanged = true;
    }
    if (input.secrets) {
      secrets = { ...secrets, ...input.secrets };
      for (const [k, v] of Object.entries(secrets)) if (v === '') delete secrets[k];
      data.secrets = Object.keys(secrets).length
        ? this.runner.box.encrypt(JSON.stringify(secrets), secretsContext(c.id))
        : null;
      credentialsChanged = true;
    }
    if (credentialsChanged) {
      // Neue Zugangsdaten: prüfen und Fehlerstatus aufheben
      const test = await this.runTest(connector, config, secrets);
      if (!test.ok)
        throw new AppError('validation_failed', test.error!.message, { connector: test.error });
      data.accountLabel = test.accountLabel;
      data.status = 'active';
      data.statusMessage = null;
      data.consecutiveFailures = 0;
    } else if (input.syncEnabled === true && c.status !== 'active') {
      // Wieder einschalten nach Pause
      data.status = 'active';
      data.statusMessage = null;
      data.consecutiveFailures = 0;
    }
    const updated = await this.prisma.client.integrationConnection.update({
      where: { id: c.id },
      data,
    });
    return (await this.toDtos([updated]))[0]!;
  }

  /** Gespeicherte Verbindung testen; neue Quellen werden ergänzt, Fehlerstatus aufgehoben. */
  async retest(user: AuthUser, workspaceId: string, id: string): Promise<ConnectionTestDto> {
    const c = await this.requireConnection(user, workspaceId, id);
    await this.limits.hit(`integration-test:${user.id}`, 20, 60);
    const connector = connectorFor(c.type);
    const test = await this.runTest(
      connector,
      c.config as Record<string, unknown>,
      await this.runner.engine.secretsOf(c),
    );
    if (test.ok) {
      await this.prisma.client.$transaction(async (tx) => {
        for (const s of test.sources)
          await tx.integrationSource.upsert({
            where: { connectionId_remoteId: { connectionId: c.id, remoteId: s.remoteId } },
            create: {
              connectionId: c.id,
              remoteId: s.remoteId,
              name: s.name,
              kinds: s.kinds,
              enabled: false,
              options: sourceOptionsSchema.parse({}) as Prisma.InputJsonValue,
            },
            update: { name: s.name, kinds: s.kinds },
          });
        await tx.integrationConnection.update({
          where: { id: c.id },
          data: {
            accountLabel: test.accountLabel,
            ...(c.status === 'error'
              ? { status: 'active', statusMessage: null, consecutiveFailures: 0 }
              : {}),
          },
        });
      });
    }
    return test;
  }

  async sync(
    user: AuthUser,
    workspaceId: string,
    id: string,
  ): Promise<{ queued: boolean; run: SyncRunDto | null }> {
    const c = await this.requireConnection(user, workspaceId, id);
    await this.limits.hit(`integration-sync:${user.id}`, 30, 60);
    const outcome = await this.runner.trigger(c.id);
    if (!outcome) return { queued: true, run: null };
    if ('skipped' in outcome) {
      if (outcome.skipped === 'locked')
        throw new AppError('conflict', 'Synchronisierung läuft bereits');
      throw notFound('Verbindung');
    }
    const run = await this.prisma.client.syncRun.findUnique({ where: { id: outcome.runId } });
    return { queued: false, run: run ? runDto(run) : null };
  }

  async runs(user: AuthUser, workspaceId: string, id: string): Promise<SyncRunDto[]> {
    const c = await this.requireConnection(user, workspaceId, id);
    const runs = await this.prisma.client.syncRun.findMany({
      where: { connectionId: c.id },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return runs.map(runDto);
  }

  /** Verbindung trennen. Zeilen bleiben (Standard) oder werden archiviert, nie gelöscht. */
  async disconnect(user: AuthUser, workspaceId: string, id: string, body: unknown): Promise<void> {
    const c = await this.requireConnection(user, workspaceId, id);
    const input = parse(disconnectSchema, body);
    await this.prisma.client.$transaction(async (tx) => {
      if (input.rows === 'archive')
        await tx.$executeRaw`
          UPDATE pages SET archived_at = now() WHERE archived_at IS NULL AND deleted_at IS NULL AND id IN (
            SELECT e.row_id FROM external_entities e JOIN integration_sources s ON s.id = e.source_id
             WHERE s.connection_id = ${c.id}::uuid AND e.row_id IS NOT NULL)`;
      await tx.integrationConnection.delete({ where: { id: c.id } });
    });
  }

  // ---------------------------------------------------------------- Quellen

  private async requireTarget(user: AuthUser, workspaceId: string, databaseId: string) {
    const a = await this.access.requireData(user.id, databaseId, { level: 'edit' });
    if (a.page.workspaceId !== workspaceId) throw notFound('Datenbank');
    return a;
  }

  async updateSource(
    user: AuthUser,
    workspaceId: string,
    connectionId: string,
    sourceId: string,
    body: unknown,
  ): Promise<SourceDto> {
    const { source } = await this.requireSource(user, workspaceId, connectionId, sourceId);
    const input = parse(updateSourceSchema, body);
    const data: Prisma.IntegrationSourceUpdateInput = {};
    let targetId = source.targetDatabaseId;
    if (input.targetDatabaseId !== undefined) {
      if (input.targetDatabaseId) {
        const a = await this.requireTarget(user, workspaceId, input.targetDatabaseId);
        targetId = a.data.db.id;
      } else targetId = null;
      if (targetId !== source.targetDatabaseId) {
        data.targetDatabaseId = targetId;
        // Neues Ziel: Zuordnungen und Cursor zurücksetzen (alles neu anlegen)
        data.cursor = Prisma.DbNull;
        await this.prisma.client.externalEntity.deleteMany({ where: { sourceId: source.id } });
        if (input.mapping === undefined && targetId) {
          const props = await this.mapProps(targetId);
          data.mapping = suggestMapping(
            source.kinds as RecordKind[],
            props,
          ) as unknown as Prisma.InputJsonValue;
        }
      }
    }
    if (input.mapping !== undefined) {
      if (targetId) await this.checkMapping(targetId, input.mapping);
      data.mapping = input.mapping as unknown as Prisma.InputJsonValue;
    }
    if (input.options !== undefined) data.options = input.options as Prisma.InputJsonValue;
    if (input.deletionPolicy !== undefined) data.deletionPolicy = input.deletionPolicy;
    if (input.enabled !== undefined) {
      if (input.enabled && !targetId)
        throw new AppError('validation_failed', 'Zuerst eine Ziel-Datenbank wählen');
      data.enabled = input.enabled;
    } else if (input.targetDatabaseId) data.enabled = true;
    if (input.targetDatabaseId === null) data.enabled = false;
    const updated = await this.prisma.client.integrationSource.update({
      where: { id: source.id },
      data,
    });
    const title = targetId
      ? (
          await this.prisma.client.page.findUnique({
            where: { id: targetId },
            select: { title: true },
          })
        )?.title
      : undefined;
    return this.sourceDto(
      updated,
      new Map(targetId && title !== undefined ? [[targetId, title]] : []),
      new Map(),
    );
  }

  private async mapProps(databaseId: string): Promise<MapProperty[]> {
    const props = await this.access.properties(databaseId);
    return props.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type as PropertyType,
      config: p.config,
    }));
  }

  private async checkMapping(databaseId: string, mapping: Mapping) {
    const props = new Map((await this.mapProps(databaseId)).map((p) => [p.id, p]));
    for (const f of mapping.fields)
      if (f.target !== 'title' && !props.has(f.target))
        throw new AppError('validation_failed', 'Property gehört nicht zur Ziel-Datenbank', {
          propertyId: f.target,
        });
    if (mapping.syncStatusPropertyId && props.get(mapping.syncStatusPropertyId)?.type !== 'select')
      throw new AppError('validation_failed', 'Sync-Status muss ein Auswahl-Property sein');
  }

  /** Mapping-Vorschlag für eine Datenbank. */
  async suggest(
    user: AuthUser,
    workspaceId: string,
    connectionId: string,
    sourceId: string,
    databaseId: string,
  ): Promise<Mapping> {
    const { source } = await this.requireSource(user, workspaceId, connectionId, sourceId);
    const a = await this.requireTarget(user, workspaceId, databaseId);
    return suggestMapping(source.kinds as RecordKind[], await this.mapProps(a.data.db.id));
  }

  /** Neue Ziel-Datenbank mit vorgeschlagenen Properties; Quelle wird darauf eingestellt. */
  async createTarget(
    user: AuthUser,
    workspaceId: string,
    connectionId: string,
    sourceId: string,
    body: unknown,
  ): Promise<SourceDto> {
    const { source } = await this.requireSource(user, workspaceId, connectionId, sourceId);
    const input = parse(createTargetDatabaseSchema, body);
    const db = await this.databases.create(user, workspaceId, {
      title: input.title,
      parentId: input.parentId,
      inline: false,
      insertBlock: true,
    });
    const kinds = source.kinds as RecordKind[];
    const fields: MappingField[] = [
      { source: 'title', target: 'title', ownership: 'local_preserve', autoCreateOptions: true },
    ];
    let syncStatusPropertyId: string | null = null;
    const tags = db.properties.find((p) => p.type === 'multi_select');
    for (const s of suggestedProperties(kinds)) {
      let pid: string;
      if (s.key === 'categories' && tags) {
        await this.databases.updateProperty(user, db.id, tags.id, { name: s.name });
        pid = tags.id;
      } else {
        const config = s.options
          ? { options: s.options.map((o) => ({ id: randomUUID(), name: o.name, color: o.color })) }
          : undefined;
        const p = await this.databases.createProperty(user, db.id, {
          name: s.name,
          type: s.type as never,
          ...(config ? { config } : {}),
        });
        pid = p.id;
      }
      if (s.key === 'syncStatus') syncStatusPropertyId = pid;
      else
        fields.push({
          source: s.key,
          target: pid,
          // Erledigt-Haken gehört dem Nutzer, sobald er ihn setzt
          ownership: 'local_preserve',
          autoCreateOptions: true,
        });
    }
    return this.updateSource(user, workspaceId, connectionId, sourceId, {
      targetDatabaseId: db.id,
      mapping: { fields, descriptionToContent: true, syncStatusPropertyId },
      enabled: true,
    });
  }

  /** Vorschau: erste 10 Datensätze mit den Werten, die geschrieben würden. */
  async preview(
    user: AuthUser,
    workspaceId: string,
    connectionId: string,
    sourceId: string,
    body: unknown,
  ): Promise<MappingPreviewDto> {
    const { conn, source } = await this.requireSource(user, workspaceId, connectionId, sourceId);
    const input = parse(
      updateSourceSchema.pick({ mapping: true, targetDatabaseId: true, options: true }),
      body,
    );
    await this.limits.hit(`integration-test:${user.id}`, 20, 60);
    const targetId = input.targetDatabaseId ?? source.targetDatabaseId;
    if (!targetId) throw new AppError('validation_failed', 'Zuerst eine Ziel-Datenbank wählen');
    const a = await this.requireTarget(user, workspaceId, targetId);
    const props = await this.mapProps(a.data.db.id);
    const mapping = input.mapping ?? mappingSchema.parse(source.mapping ?? {});
    const options = input.options ?? sourceOptionsSchema.parse(source.options ?? {});
    const connector = connectorFor(conn.type);
    const ctx = this.runner.engine.context(
      conn.config as Record<string, unknown>,
      await this.runner.engine.secretsOf(conn),
    );
    let records: ExternalRecord[];
    try {
      records = (await connector.pull(ctx, { remoteId: source.remoteId, options }, null)).records;
    } catch (err) {
      return { rows: [], newOptions: {}, errors: [connectorError(err).message] };
    }
    const first = records
      .map((r): ExternalRecord => ({ ...r, fields: { ...r.fields, source: source.name } }))
      .sort((x, y) =>
        String(fieldStart(x.fields.date)).localeCompare(String(fieldStart(y.fields.date))),
      )
      .slice(0, 10);
    const missing = collectMissingOptions(first, mapping, props);
    const names = new Map(props.map((p) => [p.id, p.name]));
    const errors: string[] = [];
    const rows = first.map((r) => {
      const m = mapRecord(r, mapping, props);
      errors.push(...m.errors);
      const values: Record<string, unknown> = {};
      for (const [k, v] of m.values) values[k] = v;
      // Neue Optionen in der Vorschau mit Namen zeigen
      for (const [pid, opts] of m.missingOptions) values[pid] = { newOptions: opts };
      return {
        externalId: r.externalId,
        kind: r.kind,
        title: String(m.values.get('title') ?? ''),
        values,
        raw: r.fields,
      };
    });
    return {
      rows,
      newOptions: Object.fromEntries([...missing].map(([pid, n]) => [names.get(pid) ?? pid, n])),
      errors: [...new Set(errors)],
    };
  }

  // ---------------------------------------------------------------- Konflikte

  async conflicts(
    user: AuthUser,
    workspaceId: string,
    connectionId: string,
  ): Promise<ConflictDto[]> {
    const c = await this.requireConnection(user, workspaceId, connectionId);
    const rows = await this.prisma.client.$queryRaw<
      {
        id: string;
        row_id: string | null;
        row_title: string | null;
        source_name: string;
        target_id: string | null;
        field: string;
        local_value: unknown;
        remote_value: unknown;
        created_at: Date;
      }[]
    >`
      SELECT c.id::text, e.row_id::text, p.title AS row_title, s.name AS source_name, s.target_database_id::text AS target_id,
             c.field, c.local_value, c.remote_value, c.created_at
        FROM sync_conflicts c JOIN external_entities e ON e.id = c.entity_id
        JOIN integration_sources s ON s.id = e.source_id LEFT JOIN pages p ON p.id = e.row_id
       WHERE s.connection_id = ${c.id}::uuid AND c.resolved_at IS NULL
       ORDER BY c.created_at DESC LIMIT 200`;
    const pids = [...new Set(rows.map((r) => r.field).filter((f) => f !== 'title'))];
    const names = new Map(
      (
        await this.prisma.client.dbProperty.findMany({
          where: { id: { in: pids } },
          select: { id: true, name: true },
        })
      ).map((p) => [p.id, p.name]),
    );
    return rows.map((r) => ({
      id: r.id,
      rowId: r.row_id,
      rowTitle: r.row_title,
      sourceName: r.source_name,
      field: r.field,
      fieldName: r.field === 'title' ? 'Titel' : (names.get(r.field) ?? r.field),
      localValue: r.local_value,
      remoteValue: r.remote_value,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async resolveConflict(
    user: AuthUser,
    workspaceId: string,
    connectionId: string,
    conflictId: string,
    body: unknown,
  ) {
    const c = await this.requireConnection(user, workspaceId, connectionId);
    const input = parse(resolveConflictSchema, body);
    const [owned] = await this.prisma.client.$queryRaw<{ target_id: string | null }[]>`
      SELECT s.target_database_id::text AS target_id FROM sync_conflicts c JOIN external_entities e ON e.id = c.entity_id
        JOIN integration_sources s ON s.id = e.source_id WHERE c.id = ${conflictId}::uuid AND s.connection_id = ${c.id}::uuid`;
    if (!owned) throw notFound('Konflikt');
    if (input.resolution === 'remote' && owned.target_id)
      await this.requireTarget(user, workspaceId, owned.target_id);
    const rowId = await this.runner.engine.resolveConflict(conflictId, input.resolution, user.id);
    if (rowId && owned.target_id && input.resolution === 'remote') {
      await this.prisma.client.changeEvent.create({
        data: {
          workspaceId,
          type: 'database.rows.changed',
          entityId: owned.target_id,
          actorId: user.id,
          payload: { rowIds: [rowId] },
        },
      });
    }
    return { ok: true };
  }
}

const fieldStart = (d: unknown) =>
  d && typeof d === 'object' && 'start' in d ? (d as { start: string }).start : '';
