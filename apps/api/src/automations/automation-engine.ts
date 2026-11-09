import { createHmac, randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, type Automation } from '@jotion/db';
import {
  endpointsFromEnv,
  SafeHttpClient,
  SecretBox,
  secretsContext as integrationSecretsContext,
  telegramSend,
} from '@jotion/integrations';
import {
  addDays,
  dayInZone,
  filterRows,
  queryProperties,
  valueDay,
  type RowRecord,
} from '@jotion/query';
import {
  actionSchema,
  AUTOMATION_RATE_LIMIT,
  dateValueMs,
  filterSchema,
  MAX_AUTOMATION_DEPTH,
  QUEUE_PREFIX,
  queryRowsSchema,
  triggerSchema,
  type AutomationAction,
  type AutomationTrigger,
  type DateValue,
  type PropertyValue,
  type RowDto,
  type ValueSpec,
} from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { AuthUser } from '../common/request-context';
import { RowEventsBus, type RowEvent } from '../common/row-events';
import { SERVER_ENV } from '../config/config.module';
import { ComputeService } from '../databases/compute.service';
import { DatabaseAccessService, type LoadedProperty } from '../databases/database-access';
import { RowsService } from '../databases/rows.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { nextRecurrence, TemplatesService } from '../templates/templates.service';

export const AUTOMATIONS_QUEUE = 'automations';

export interface RunJob {
  automationId: string;
  /** Eindeutig je Auslösung; mit der Automatisierung zusammen der Idempotenzschlüssel */
  eventKey: string;
  rowId: string | null;
  /** Wer ausgelöst hat (Nutzer der Änderung oder des Buttons) */
  actorId: string | null;
  depth: number;
}

export interface RunResult {
  runId: string | null;
  status: 'succeeded' | 'failed' | 'skipped' | 'stopped' | 'duplicate';
}

type FormulaValue =
  | number
  | string
  | boolean
  | { kind: 'date'; start: number; end: number | null; hasTime: boolean }
  | { kind: 'person'; id: string; name: string }
  | { kind: 'page'; id: string; title: string }
  | FormulaValue[]
  | null;

export const secretContext = (id: string) => `automation:${id}`;

/** Nächster Lauf eines Zeit-Auslösers nach `after`. */
export function nextTriggerRun(
  t: AutomationTrigger,
  after: number,
  timeZone: string,
): number | null {
  if (t.type === 'schedule') return nextRecurrence(t, after, timeZone);
  if (t.type === 'date_reached')
    return nextRecurrence({ every: 'day', time: t.time, weekday: 1, monthday: 1 }, after, timeZone);
  return null;
}

/**
 * Phase 9: Automation-Engine. Hört auf Zeilenänderungen (RowEventsBus), prüft Auslöser und
 * Bedingung und führt die Aktionen als Ersteller der Automatisierung aus. Läuft über die Queue
 * "automations" im API-Prozess (dieselbe Schreiblogik wie Nutzeränderungen), in Tests direkt.
 *  - Idempotenz: (automation_id, event_key) ist eindeutig; eine Wiederholung läuft nicht doppelt
 *  - Schleifenschutz: Änderungen einer Automatisierung tragen die Kettentiefe; ab Tiefe 5 gestoppt
 *  - Rate-Limit: höchstens 60 Läufe je Automatisierung und Minute
 */
@Injectable()
export class AutomationEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Automations');
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private connection: Redis | null = null;
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rows: RowsService,
    private readonly access: DatabaseAccessService,
    private readonly compute: ComputeService,
    private readonly bus: RowEventsBus,
    private readonly redis: RedisService,
    private readonly templates: TemplatesService,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
  ) {
    this.box = new SecretBox(env.JOTION_MASTER_KEY, env.JOTION_MASTER_KEY_PREVIOUS);
  }

  get inline(): boolean {
    return this.env.JOTION_AUTOMATIONS_INLINE;
  }

  async onModuleInit() {
    this.bus.subscribe((e) => this.onRowEvent(e));
    if (this.inline) return;
    try {
      this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
      this.connection.on('error', () => undefined);
      this.queue = new Queue(AUTOMATIONS_QUEUE, {
        connection: this.connection,
        prefix: QUEUE_PREFIX,
      });
      await this.queue.upsertJobScheduler(
        'automations-tick',
        { every: 60_000 },
        { name: 'tick', opts: { removeOnComplete: 10, removeOnFail: 50 } },
      );
      this.worker = new Worker(
        AUTOMATIONS_QUEUE,
        async (job: Job) => (job.name === 'tick' ? this.tick() : this.execute(job.data as RunJob)),
        { connection: this.connection, prefix: QUEUE_PREFIX, concurrency: 4 },
      );
      this.worker.on('failed', (job, err) =>
        this.logger.error(`Job ${job?.name} fehlgeschlagen: ${err.message}`),
      );
    } catch (err) {
      this.logger.warn(
        `Queue nicht verfügbar, Automatisierungen laufen direkt: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  // ---------------------------------------------------------------- Auslösen

  private async onRowEvent(e: RowEvent) {
    if (e.kind === 'trashed') return;
    const autos = await this.prisma.client.automation.findMany({
      where: { databaseId: e.databaseId, enabled: true },
    });
    const eventId = randomUUID();
    for (const a of autos) {
      const t = triggerSchema.safeParse(a.trigger);
      if (!t.success) continue;
      const fires =
        (t.data.type === 'row_created' && e.kind === 'created') ||
        (t.data.type === 'property_changed' &&
          e.kind === 'updated' &&
          e.changed.includes(t.data.propertyId));
      if (!fires) continue;
      for (const rowId of e.rowIds)
        await this.dispatch({
          automationId: a.id,
          eventKey: `${e.kind}:${eventId}:${rowId}`,
          rowId,
          actorId: e.actorId,
          depth: e.depth,
        });
    }
  }

  /** Ausführung anstoßen (Queue oder direkt). */
  async dispatch(job: RunJob): Promise<RunResult | null> {
    if (this.inline || !this.queue) return this.execute(job);
    await this.queue.add('run', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    });
    return null;
  }

  // ---------------------------------------------------------------- Ausführen

  async execute(job: RunJob): Promise<RunResult> {
    const a = await this.prisma.client.automation.findUnique({ where: { id: job.automationId } });
    if (!a || !a.enabled) return { runId: null, status: 'skipped' };
    const trigger = triggerSchema.parse(a.trigger);
    const actions = (a.actions as unknown[]).map((x) => actionSchema.parse(x));
    const user = await this.templates.actor(a.createdById);
    if (!user) return { runId: null, status: 'skipped' };

    // Bedingung (gilt für die auslösende Zeile); nicht erfüllt: kein Protokolleintrag
    let row: RowDto | null = null;
    let props: LoadedProperty[] = [];
    if (job.rowId && a.databaseId) {
      const page = await this.prisma.client.page.findUnique({
        where: { id: job.rowId },
        select: { deletedAt: true },
      });
      if (!page || page.deletedAt) return { runId: null, status: 'skipped' };
      try {
        row = await this.rows.get(user, a.databaseId, job.rowId);
      } catch {
        return { runId: null, status: 'skipped' };
      }
      props = await this.access.properties(a.databaseId);
      const conditions = a.conditions ? filterSchema.safeParse(a.conditions) : null;
      if (conditions?.success && conditions.data && !this.matches(row, props, conditions.data))
        return { runId: null, status: 'skipped' };
    }

    // Idempotenz: dieselbe Auslösung läuft nie zweimal
    const run = await this.prisma.client.$queryRaw<{ id: string }[]>`
      INSERT INTO automation_runs (id, automation_id, event_key, chain_depth, row_id, actor_id)
      VALUES (${randomUUID()}::uuid, ${a.id}::uuid, ${job.eventKey}, ${job.depth}, ${job.rowId}::uuid, ${job.actorId}::uuid)
      ON CONFLICT (automation_id, event_key) DO NOTHING RETURNING id::text`;
    const runId = run[0]?.id;
    if (!runId) return { runId: null, status: 'duplicate' };
    const finish = async (
      status: RunResult['status'],
      details: unknown[],
      error: string | null,
    ) => {
      await this.prisma.client.automationRun.update({
        where: { id: runId },
        data: { status, details: details as Prisma.InputJsonValue, error, finishedAt: new Date() },
      });
      await this.prisma.client.automation.update({
        where: { id: a.id },
        data: { lastRunAt: new Date() },
      });
      return { runId, status };
    };

    if (job.depth >= MAX_AUTOMATION_DEPTH)
      return finish(
        'stopped',
        [],
        `Kettentiefe ${MAX_AUTOMATION_DEPTH} erreicht: Schleife gestoppt`,
      );
    const minute = Math.floor(Date.now() / 60_000);
    const key = `jotion:autorl:${a.id}:${minute}`;
    const count = await this.redis.client.incr(key).catch(() => 0);
    if (count === 1) void this.redis.client.expire(key, 120).catch(() => undefined);
    if (count > AUTOMATION_RATE_LIMIT)
      return finish('skipped', [], `Mehr als ${AUTOMATION_RATE_LIMIT} Ausführungen pro Minute`);

    const details: { action: string; ok: boolean; message?: string }[] = [];
    let failed = false;
    for (const action of actions) {
      try {
        const message = await this.runAction(a, trigger, action, user, row, props, job);
        details.push({ action: action.type, ok: true, ...(message ? { message } : {}) });
      } catch (err) {
        failed = true;
        details.push({ action: action.type, ok: false, message: (err as Error).message });
        break;
      }
    }
    return finish(
      failed ? 'failed' : 'succeeded',
      details,
      failed ? (details.at(-1)?.message ?? null) : null,
    );
  }

  private matches(
    row: RowDto,
    props: LoadedProperty[],
    filter: NonNullable<ReturnType<typeof filterSchema.parse>>,
  ): boolean {
    const record: RowRecord = { ...row, values: row.values };
    return (
      filterRows([record], {
        databaseId: '',
        viewerId: '',
        properties: queryProperties(props),
        filter,
        timeZone: this.compute.timeZone,
      }).length === 1
    );
  }

  // ---------------------------------------------------------------- Aktionen

  private async runAction(
    a: Automation,
    trigger: AutomationTrigger,
    action: AutomationAction,
    user: AuthUser,
    row: RowDto | null,
    props: LoadedProperty[],
    job: RunJob,
  ): Promise<string | undefined> {
    const ctx = { depth: job.depth + 1 };
    switch (action.type) {
      case 'set_property': {
        if (!row || !a.databaseId) throw new Error('Keine auslösende Zeile');
        if (action.target.kind === 'trigger') {
          const change = await this.change(
            action.propertyId,
            action.value,
            props,
            row,
            a.databaseId,
            job,
            row,
          );
          await this.rows.update(user, a.databaseId, row.id, change, ctx);
          return undefined;
        }
        const rel = props.find(
          (p) => p.id === (action.target as { relationPropertyId: string }).relationPropertyId,
        );
        if (!rel || rel.type !== 'relation') throw new Error('Relation nicht gefunden');
        const targetDb = String((rel.config as { targetDatabaseId: string }).targetDatabaseId);
        const targetProps = await this.access.properties(targetDb);
        const ids = ((row.values[rel.id] as string[] | undefined) ?? []).slice(0, 100);
        for (const id of ids) {
          const target = await this.rows.get(user, targetDb, id);
          const change = await this.change(
            action.propertyId,
            action.value,
            targetProps,
            target,
            targetDb,
            job,
            row,
            props,
          );
          await this.rows.update(user, targetDb, id, change, ctx);
        }
        return `${ids.length} verknüpfte Zeilen`;
      }
      case 'create_row': {
        const targetProps = await this.access.properties(action.databaseId);
        const values: Record<string, unknown> = {};
        for (const [pid, spec] of Object.entries(action.values)) {
          const prop = targetProps.find((p) => p.id === pid);
          if (!prop) continue;
          values[pid] = await this.resolve(spec, prop, null, action.databaseId, job, row, props);
        }
        if (action.linkPropertyId && row) values[action.linkPropertyId] = [row.id];
        const created = await this.rows.create(
          user,
          action.databaseId,
          {
            title: this.interpolate(action.title, row, props, job),
            values,
            templateId: action.templateId ?? 'none',
          },
          ctx,
        );
        return created.id;
      }
      case 'telegram': {
        // Phase 11: Verbindung muss weiter dem Ersteller gehören (läuft in dessen Namen)
        const c = await this.prisma.client.integrationConnection.findUnique({
          where: { id: action.connectionId },
        });
        if (!c || c.type !== 'telegram' || c.ownerId !== a.createdById || !c.secrets)
          throw new Error('Telegram-Verbindung nicht verfügbar');
        const secrets = JSON.parse(
          this.box.decrypt(c.secrets, integrationSecretsContext(c.id)),
        ) as Record<string, string>;
        await telegramSend(
          {
            config: c.config as Record<string, unknown>,
            secrets,
            http: new SafeHttpClient({
              allowlist: this.env.JOTION_SSRF_ALLOWLIST,
              timeoutMs: 10_000,
              maxBytes: 256 * 1024,
              maxRedirects: 0,
              userAgent: 'Jotion/1.0 (Automatisierung)',
            }),
            timeZone: this.env.JOTION_TIMEZONE,
            now: Date.now,
            endpoints: endpointsFromEnv(this.env),
          },
          action.chatId,
          this.interpolate(action.text, row, props, job),
        );
        return `Telegram ${action.chatId}`;
      }
      case 'webhook': {
        const secret = a.secret ? this.box.decrypt(a.secret, secretContext(a.id)) : '';
        const body = JSON.stringify({
          automation: { id: a.id, name: a.name },
          trigger: trigger.type,
          eventKey: job.eventKey,
          timestamp: new Date().toISOString(),
          ...(action.includeRow && row
            ? {
                row: {
                  id: row.id,
                  title: row.title,
                  databaseId: a.databaseId,
                  values: this.namedValues(row, props),
                },
              }
            : {}),
        });
        const signature = createHmac('sha256', secret).update(body).digest('hex');
        const http = new SafeHttpClient({
          allowlist: this.env.JOTION_SSRF_ALLOWLIST,
          timeoutMs: 10_000,
          maxBytes: 64 * 1024,
          maxRedirects: 0,
          userAgent: 'Jotion/1.0 (Automatisierung)',
          accept: '*/*',
        });
        const res = await http.fetch(action.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Jotion-Signature': `sha256=${signature}`,
          },
          body,
        });
        if (res.status < 200 || res.status >= 300)
          throw new Error(`Webhook antwortet mit ${res.status}`);
        return `HTTP ${res.status}`;
      }
    }
  }

  /** Änderung für ein Property (Titel oder Wert) einer Zeile */
  private async change(
    propertyId: string,
    spec: ValueSpec,
    props: LoadedProperty[],
    target: RowDto,
    databaseId: string,
    job: RunJob,
    triggerRow: RowDto | null,
    triggerProps: LoadedProperty[] = props,
  ): Promise<{ title?: string; values: Record<string, unknown> }> {
    if (propertyId === 'title') {
      const v = await this.resolve(
        spec,
        { id: 'title', name: 'title', type: 'text', config: {}, position: '' },
        target,
        databaseId,
        job,
        triggerRow,
        triggerProps,
      );
      return { title: String(v ?? ''), values: {} };
    }
    const prop = props.find((p) => p.id === propertyId);
    if (!prop) throw new Error('Property nicht gefunden');
    return {
      values: {
        [prop.id]: await this.resolve(
          spec,
          prop,
          target,
          databaseId,
          job,
          triggerRow,
          triggerProps,
        ),
      },
    };
  }

  /** Wert aus einer Wertangabe für ein Ziel-Property */
  private async resolve(
    spec: ValueSpec,
    prop: LoadedProperty,
    target: RowDto | null,
    databaseId: string,
    job: RunJob,
    triggerRow: RowDto | null,
    triggerProps: LoadedProperty[],
  ): Promise<unknown> {
    const tz = this.compute.timeZone;
    switch (spec.kind) {
      case 'static':
        return spec.value;
      case 'clear':
        return prop.type === 'checkbox'
          ? false
          : ['multi_select', 'person', 'relation', 'files'].includes(prop.type)
            ? []
            : null;
      case 'today':
        return {
          start: addDays(dayInZone(Date.now(), tz), spec.offsetDays),
          end: null,
          hasTime: false,
          timeZone: null,
        };
      case 'now':
        return { start: new Date().toISOString(), end: null, hasTime: true, timeZone: null };
      case 'trigger_user':
        if (!job.actorId) return prop.type === 'person' ? [] : null;
        return prop.type === 'person' ? [job.actorId] : job.actorId;
      case 'toggle':
        return !(target?.values[prop.id] === true);
      case 'text':
        return this.toProperty(prop, this.interpolate(spec.text, triggerRow, triggerProps, job));
      case 'formula': {
        const value = (await this.compute
          .engine()
          .evaluateFor(
            triggerRow ? databaseId : null,
            triggerRow?.id ?? null,
            spec.expression,
          )) as FormulaValue;
        return this.toProperty(prop, value);
      }
    }
  }

  /** Formel- oder Textwert in den Wert eines Properties umwandeln */
  private toProperty(prop: LoadedProperty, v: FormulaValue): unknown {
    const text = (x: FormulaValue): string =>
      x === null
        ? ''
        : Array.isArray(x)
          ? x.map(text).join(', ')
          : typeof x === 'object'
            ? x.kind === 'date'
              ? new Date(x.start).toISOString()
              : 'title' in x
                ? x.title
                : x.name
            : String(x);
    const options = (prop.config as { options?: { id: string; name: string }[] }).options ?? [];
    const option = (name: string) => {
      const o = options.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
      if (!o) throw new Error(`Option "${name}" gibt es in "${prop.name}" nicht`);
      return o.id;
    };
    switch (prop.type) {
      case 'number':
        return v === null || v === '' ? null : Number(Array.isArray(v) ? v[0] : v);
      case 'checkbox':
        return v === true || v === 'true' || (typeof v === 'number' && v !== 0);
      case 'date': {
        if (v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'date') {
          const f = (ms: number) =>
            v.hasTime ? new Date(ms).toISOString() : new Date(ms).toISOString().slice(0, 10);
          return {
            start: f(v.start),
            end: v.end !== null ? f(v.end) : null,
            hasTime: v.hasTime,
            timeZone: null,
          };
        }
        const s = text(v);
        return s ? { start: s, end: null, hasTime: s.includes('T'), timeZone: null } : null;
      }
      case 'select':
      case 'status':
        return text(v) ? option(text(v)) : null;
      case 'multi_select':
        return (Array.isArray(v) ? v.map(text) : text(v).split(','))
          .map((s) => s.trim())
          .filter(Boolean)
          .map(option);
      case 'person':
        return (Array.isArray(v) ? v : [v])
          .filter(
            (x): x is { kind: 'person'; id: string; name: string } =>
              !!x && typeof x === 'object' && !Array.isArray(x) && x.kind === 'person',
          )
          .map((x) => x.id);
      case 'relation':
        return (Array.isArray(v) ? v : [v])
          .filter(
            (x): x is { kind: 'page'; id: string; title: string } =>
              !!x && typeof x === 'object' && !Array.isArray(x) && x.kind === 'page',
          )
          .map((x) => x.id);
      default:
        return text(v) || null;
    }
  }

  /** Platzhalter {{title}}, {{Property}}, {{user}}, {{today}}, {{now}} */
  private interpolate(
    template: string,
    row: RowDto | null,
    props: LoadedProperty[],
    job: RunJob,
  ): string {
    const tz = this.compute.timeZone;
    const named = row ? this.namedValues(row, props) : {};
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
      if (key === 'title') return row?.title ?? '';
      if (key === 'today') return dayInZone(Date.now(), tz);
      if (key === 'now') return new Date().toISOString();
      if (key === 'user') return job.actorId ?? '';
      const v = named[key];
      return v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
    });
  }

  /** Werte einer Zeile nach Property-Namen, Optionen als Namen (Webhooks, Platzhalter) */
  private namedValues(row: RowDto, props: LoadedProperty[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const p of props) {
      if (p.type === 'title') {
        out[p.name] = row.title;
        continue;
      }
      const v = row.values[p.id] as PropertyValue | undefined;
      if (v === undefined) continue;
      const options = (p.config as { options?: { id: string; name: string }[] }).options;
      if (options && typeof v === 'string')
        out[p.name] = options.find((o) => o.id === v)?.name ?? v;
      else if (options && Array.isArray(v))
        out[p.name] = (v as string[]).map((id) => options.find((o) => o.id === id)?.name ?? id);
      else if (v && typeof v === 'object' && 'start' in v) out[p.name] = (v as DateValue).start;
      else out[p.name] = v;
    }
    return out;
  }

  // ---------------------------------------------------------------- Zeitplan

  /** Fällige Zeit-Auslöser und wiederkehrende Vorlagen (jede Minute). */
  async tick(now = Date.now()): Promise<{ automations: number; rows: number }> {
    const tz = this.compute.timeZone;
    const due = await this.prisma.client.automation.findMany({
      where: { enabled: true, nextRunAt: { lte: new Date(now) } },
      take: 100,
    });
    let dispatched = 0;
    for (const a of due) {
      const trigger = triggerSchema.safeParse(a.trigger);
      if (!trigger.success) continue;
      const slot = a.nextRunAt!.toISOString();
      // Zuerst weiterschalten: ein Fehler darf keine Endlosschleife auslösen
      const next = nextTriggerRun(trigger.data, now, tz);
      await this.prisma.client.automation.update({
        where: { id: a.id },
        data: { nextRunAt: next ? new Date(next) : null },
      });
      try {
        const t = trigger.data;
        if (t.type === 'schedule' && !t.forEachRow) {
          await this.dispatch({
            automationId: a.id,
            eventKey: `schedule:${slot}`,
            rowId: null,
            actorId: null,
            depth: 0,
          });
          dispatched++;
          continue;
        }
        if (!a.databaseId) continue;
        const user = await this.templates.actor(a.createdById);
        if (!user) continue;
        const rowIds = await this.matchingRows(user, a, t, now);
        for (const rowId of rowIds) {
          await this.dispatch({
            automationId: a.id,
            eventKey: `${t.type}:${slot}:${rowId}`,
            rowId,
            actorId: null,
            depth: 0,
          });
          dispatched++;
        }
      } catch (err) {
        this.logger.warn(`Zeitplan ${a.id}: ${(err as Error).message}`);
      }
    }
    await this.templates.runDueRecurring(now);
    return { automations: due.length, rows: dispatched };
  }

  /** Zeilen eines Zeit-Auslösers (Bedingung prüft die Ausführung selbst). */
  private async matchingRows(
    user: AuthUser,
    a: Automation,
    t: AutomationTrigger,
    now: number,
  ): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null = null;
    const targetDay =
      t.type === 'date_reached'
        ? addDays(dayInZone(now, this.compute.timeZone), -t.offsetDays)
        : null;
    for (let page = 0; page < 20; page++) {
      const res = await this.rows.query(
        user,
        a.databaseId!,
        queryRowsSchema.parse({ limit: 200, ...(cursor ? { cursor } : {}) }),
      );
      for (const r of res.rows) {
        if (t.type === 'date_reached') {
          const d = r.values[t.propertyId] as DateValue | undefined;
          if (!d?.start) continue;
          if (
            valueDay(dateValueMs(d.start, d.hasTime), d.hasTime, this.compute.timeZone) !==
            targetDay
          )
            continue;
        }
        ids.push(r.id);
      }
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return ids.slice(0, 1000);
  }
}
