import { ComputeEngine } from '@jotion/compute';
import type { PrismaClient } from '@jotion/db';
import {
  SafeHttpClient,
  SecretBox,
  SyncEngine,
  endpointsFromEnv,
  oauthClientFromEnv,
} from '@jotion/integrations';
import { COMPUTE_JOBS, INTEGRATION_JOBS, type PropagateJob, type SyncJob } from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { logger } from '../logger';

/** Höchstzahl Verbindungen, die ein Planungslauf einreiht */
const SCHEDULE_BATCH = 100;

export function createSyncEngine(
  prisma: PrismaClient,
  redis: Redis,
  computeQueue: Queue,
  env: ServerEnv,
): SyncEngine {
  return new SyncEngine({
    prisma,
    box: new SecretBox(env.JOTION_MASTER_KEY, env.JOTION_MASTER_KEY_PREVIOUS),
    http: () =>
      new SafeHttpClient({
        allowlist: env.JOTION_SSRF_ALLOWLIST,
        timeoutMs: 30_000,
        maxBytes: 20 * 1024 * 1024,
        maxRedirects: 3,
        userAgent: 'Jotion/1.0 (Kalender-Sync)',
        accept: 'text/calendar, application/xml, text/xml, */*;q=0.5',
      }),
    timeZone: env.JOTION_TIMEZONE,
    // Phase 11: OAuth-Apps und (nur Tests) Basis-URLs der Dienste
    oauthClient: (provider) => oauthClientFromEnv(env, provider),
    endpoints: endpointsFromEnv(env),
    onRowsChanged: async (databaseId, rowIds, actorId) => {
      void redis.incr(`jotion:chartv:${databaseId}`).catch(() => undefined);
      // Formeln und Rollups der geänderten Zeilen sofort, abhängige Zeilen über die Queue
      const engine = new ComputeEngine(prisma, { timeZone: env.JOTION_TIMEZONE });
      const own = await engine.recomputeRows(databaseId, rowIds);
      if (own.length) await engine.emitRowsChanged(new Map([[databaseId, new Set(own)]]), actorId);
      const job: PropagateJob = { databaseId, rowIds, actorId };
      await computeQueue.add(COMPUTE_JOBS.propagate, job, {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
      });
    },
  });
}

/**
 * Integrationen: "schedule" findet fällige Verbindungen und reiht je Verbindung einen Sync ein
 * (Job-ID = Verbindung, also nie doppelt), "sync" führt ihn aus.
 */
export function createIntegrationsProcessor(
  prisma: PrismaClient,
  engine: SyncEngine,
  queue: Queue,
) {
  return async (job: Job) => {
    switch (job.name) {
      case INTEGRATION_JOBS.schedule: {
        const due = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM integration_connections
           WHERE status = 'active' AND sync_enabled AND (next_sync_at IS NULL OR next_sync_at <= now())
             AND (sync_locked_until IS NULL OR sync_locked_until < now())
           ORDER BY next_sync_at NULLS FIRST LIMIT ${SCHEDULE_BATCH}`;
        for (const { id } of due) {
          const data: SyncJob = { connectionId: id, trigger: 'schedule' };
          await queue.add(INTEGRATION_JOBS.sync, data, {
            jobId: `sync-${id}`,
            removeOnComplete: true,
            removeOnFail: true,
          });
        }
        return { queued: due.length };
      }
      case INTEGRATION_JOBS.sync: {
        const data = job.data as SyncJob;
        const started = Date.now();
        const outcome = await engine.run(data.connectionId, data.trigger);
        if ('skipped' in outcome) return outcome;
        logger.info(
          {
            connection: data.connectionId,
            status: outcome.status,
            stats: outcome.stats,
            ms: Date.now() - started,
          },
          'Synchronisierung abgeschlossen',
        );
        return outcome;
      }
      default:
        logger.warn({ job: job.name }, 'Unbekannter Integrationsjob');
        return null;
    }
  };
}
