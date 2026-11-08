import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { SafeHttpClient, SecretBox, SyncEngine, type SyncOutcome } from '@jotion/integrations';
import { INTEGRATION_JOBS, QUEUE_PREFIX, QUEUES, type SyncJob } from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { SERVER_ENV } from '../config/config.module';
import { ComputeService } from '../databases/compute.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

/** HTTP-Client für Connectoren: SSRF-Schutz wie die Link-Vorschau, größere Antworten. */
export function integrationHttp(env: ServerEnv): SafeHttpClient {
  return new SafeHttpClient({
    allowlist: env.JOTION_SSRF_ALLOWLIST,
    timeoutMs: 30_000,
    maxBytes: 20 * 1024 * 1024,
    maxRedirects: 3,
    userAgent: 'Jotion/1.0 (Kalender-Sync)',
    accept: 'text/calendar, application/xml, text/xml, */*;q=0.5',
  });
}

/**
 * Startet Syncs: im Worker (Queue "integrations", Job-ID = Verbindung, also nie parallel) oder
 * mit JOTION_SYNC_INLINE direkt in der API (Tests).
 */
@Injectable()
export class SyncRunnerService implements OnModuleDestroy {
  private readonly logger = new Logger('Integrations');
  readonly box: SecretBox;
  readonly engine: SyncEngine;
  private queue: Queue | null = null;
  private connection: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly compute: ComputeService,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
  ) {
    this.box = new SecretBox(env.JOTION_MASTER_KEY, env.JOTION_MASTER_KEY_PREVIOUS);
    this.engine = new SyncEngine({
      prisma: prisma.client,
      box: this.box,
      http: () => integrationHttp(env),
      timeZone: env.JOTION_TIMEZONE,
      onRowsChanged: async (databaseId, rowIds, actorId) => {
        void this.redis.client.incr(`jotion:chartv:${databaseId}`).catch(() => undefined);
        await this.compute.rowsChanged(databaseId, rowIds, actorId);
      },
    });
  }

  get inline(): boolean {
    return this.env.JOTION_SYNC_INLINE;
  }

  private getQueue(): Queue {
    if (!this.queue) {
      this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
      this.connection.on('error', () => undefined);
      this.queue = new Queue(QUEUES.integrations, {
        connection: this.connection,
        prefix: QUEUE_PREFIX,
      });
    }
    return this.queue;
  }

  async onModuleDestroy() {
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /** Sync anstoßen. Inline: Ergebnis; sonst null (Job eingereiht oder läuft bereits). */
  async trigger(connectionId: string): Promise<SyncOutcome | null> {
    if (this.inline) return this.engine.run(connectionId, 'manual');
    const job: SyncJob = { connectionId, trigger: 'manual' };
    try {
      await this.getQueue().add(INTEGRATION_JOBS.sync, job, {
        jobId: `sync-${connectionId}`,
        removeOnComplete: true,
        removeOnFail: true,
      });
      return null;
    } catch (err) {
      this.logger.warn(`Queue nicht erreichbar, synchronisiere direkt: ${(err as Error).message}`);
      return this.engine.run(connectionId, 'manual');
    }
  }
}
