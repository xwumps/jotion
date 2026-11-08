import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '@jotion/db';
import { ComputeEngine } from '@jotion/compute';
import {
  COMPUTE_JOBS,
  QUEUE_PREFIX,
  QUEUES,
  type PropagateJob,
  type RecomputeDatabaseJob,
} from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { SERVER_ENV } from '../config/config.module';
import { PrismaService } from '../infra/prisma.service';

/** Ab so vielen Zeilen rechnet bei Schemaänderungen der Worker statt der API. */
const SYNC_DATABASE_LIMIT = 2000;

/**
 * Berechnete Properties (Rollups, Formeln) nach Änderungen aktualisieren:
 * die geänderten Zeilen sofort (Antwort und nächste Abfrage zeigen das Ergebnis), abhängige
 * Zeilen in anderen Datenbanken im Worker (Queue "compute"), in Tests direkt.
 */
@Injectable()
export class ComputeService implements OnModuleDestroy {
  private readonly logger = new Logger(ComputeService.name);
  private queue: Queue | null = null;
  private connection: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
  ) {}

  get timeZone(): string {
    return this.env.JOTION_TIMEZONE;
  }

  engine(
    db: Prisma.TransactionClient | PrismaService['client'] = this.prisma.client,
  ): ComputeEngine {
    return new ComputeEngine(db, { timeZone: this.env.JOTION_TIMEZONE });
  }

  private getQueue(): Queue {
    if (!this.queue) {
      this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
      this.connection.on('error', () => undefined);
      this.queue = new Queue(QUEUES.compute, { connection: this.connection, prefix: QUEUE_PREFIX });
    }
    return this.queue;
  }

  async onModuleDestroy() {
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /**
   * Zeilen haben sich geändert (Werte, Relationen, Papierkorb). extra: weitere direkt betroffene
   * Zeilen, z. B. alte und neue Ziele einer Relation (deren Gegen-Relation sich änderte).
   */
  async rowsChanged(
    databaseId: string,
    rowIds: string[],
    actorId: string | null,
    extra: Record<string, string[]> = {},
  ): Promise<void> {
    if (!rowIds.length && !Object.keys(extra).length) return;
    const engine = this.engine();
    const own = await engine.recomputeRows(databaseId, rowIds);
    const touched = new Map<string, Set<string>>();
    if (own.length) touched.set(databaseId, new Set(own));
    // Gegen-Relationen derselben Anfrage sofort (meist wenige Zeilen)
    for (const [db, ids] of Object.entries(extra)) {
      const ch = await engine.recomputeRows(db, ids);
      if (ch.length) touched.set(db, new Set([...(touched.get(db) ?? []), ...ch]));
    }
    await engine.emitRowsChanged(touched, actorId);
    const job: PropagateJob = {
      databaseId,
      rowIds: [...rowIds, ...Object.values(extra).flat()],
      actorId,
    };
    if (this.env.JOTION_COMPUTE_INLINE) await this.propagateInline(job);
    else await this.enqueue(COMPUTE_JOBS.propagate, job);
  }

  /** Schema einer Datenbank geändert (Formel, Rollup, Relation): alle Zeilen neu berechnen. */
  async databaseChanged(databaseId: string, actorId: string | null): Promise<void> {
    const [count] = await this.prisma.client.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pages WHERE database_id = ${databaseId}::uuid AND kind = 'DATABASE_ROW' AND deleted_at IS NULL`;
    if ((count?.n ?? 0) > SYNC_DATABASE_LIMIT && !this.env.JOTION_COMPUTE_INLINE) {
      const job: RecomputeDatabaseJob = { databaseId, actorId };
      await this.enqueue(COMPUTE_JOBS.recomputeDatabase, job);
      return;
    }
    const engine = this.engine();
    const changed = await engine.recomputeRows(databaseId);
    await engine.emitRowsChanged(new Map([[databaseId, new Set(changed)]]), actorId);
    if (changed.length) {
      const job: PropagateJob = { databaseId, rowIds: changed, actorId };
      if (this.env.JOTION_COMPUTE_INLINE) await this.propagateInline(job);
      else await this.enqueue(COMPUTE_JOBS.propagate, job);
    }
  }

  private async propagateInline(job: PropagateJob) {
    const engine = this.engine();
    const touched = await engine.propagate(job.databaseId, job.rowIds, { includeSeed: false });
    await engine.emitRowsChanged(touched, job.actorId ?? null);
  }

  private async enqueue(name: string, data: object) {
    try {
      await this.getQueue().add(name, data, {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
      });
    } catch (err) {
      // Ohne Redis: direkt rechnen, damit nichts verloren geht
      this.logger.warn(`Queue nicht erreichbar, rechne direkt: ${(err as Error).message}`);
      if (name === COMPUTE_JOBS.propagate) await this.propagateInline(data as PropagateJob);
    }
  }
}
