import { createPrismaClient, pingDatabase } from '@jotion/db';
import {
  COMPUTE_JOBS,
  MAINTENANCE_INTERVAL_MS,
  VOLATILE_REFRESH_INTERVAL_MS,
  QUEUE_PREFIX,
  QUEUES,
  SYSTEM_JOBS,
  WORKER_HEARTBEAT_INTERVAL_MS,
} from '@jotion/shared';
import { parseEnv, serverEnvSchema } from '@jotion/shared/env';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { writeHeartbeat } from './heartbeat';
import { logger } from './logger';
import { createComputeProcessor } from './processors/compute';
import { createSystemProcessor } from './processors/system';
import { WORKER_VERSION } from './version';

async function main(): Promise<void> {
  const env = parseEnv(serverEnvSchema);

  // BullMQ verlangt maxRetriesPerRequest: null für blockierende Verbindungen
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const redis = new Redis(env.REDIS_URL);
  const prisma = createPrismaClient({ url: env.DATABASE_URL });
  await pingDatabase(prisma);

  const systemQueue = new Queue(QUEUES.system, { connection, prefix: QUEUE_PREFIX });
  await systemQueue.upsertJobScheduler(
    'system-heartbeat',
    { every: WORKER_HEARTBEAT_INTERVAL_MS },
    {
      name: SYSTEM_JOBS.heartbeat,
      opts: { removeOnComplete: 10, removeOnFail: 50 },
    },
  );

  await systemQueue.upsertJobScheduler(
    'system-maintenance',
    { every: MAINTENANCE_INTERVAL_MS },
    { name: SYSTEM_JOBS.maintenance, opts: { removeOnComplete: 20, removeOnFail: 50 } },
  );

  const systemWorker = new Worker(QUEUES.system, createSystemProcessor(redis, prisma), {
    connection,
    prefix: QUEUE_PREFIX,
    concurrency: 1,
  });
  systemWorker.on('completed', (job, result) => {
    if (job.name === SYSTEM_JOBS.maintenance) logger.info({ result }, 'Wartung abgeschlossen');
  });
  systemWorker.on('failed', (job, err) =>
    logger.error({ job: job?.name, err: err.message }, 'Job fehlgeschlagen'),
  );

  // Phase 6: Berechnete Properties (Rollups, Formeln)
  const computeQueue = new Queue(QUEUES.compute, { connection, prefix: QUEUE_PREFIX });
  await computeQueue.upsertJobScheduler(
    'compute-volatile',
    { every: VOLATILE_REFRESH_INTERVAL_MS },
    { name: COMPUTE_JOBS.refreshVolatile, opts: { removeOnComplete: 10, removeOnFail: 50 } },
  );
  const computeWorker = new Worker(
    QUEUES.compute,
    createComputeProcessor(prisma, env.JOTION_TIMEZONE),
    { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
  );
  computeWorker.on('completed', (job, result) =>
    logger.debug({ job: job.name, result }, 'Berechnung abgeschlossen'),
  );
  computeWorker.on('failed', (job, err) =>
    logger.error({ job: job?.name, err: err.message }, 'Berechnung fehlgeschlagen'),
  );

  // Sofortiger Heartbeat, damit der Healthcheck nicht auf den ersten Job warten muss
  await writeHeartbeat(redis);
  logger.info({ version: WORKER_VERSION }, 'Worker gestartet');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Worker wird beendet');
    await systemWorker.close();
    await computeWorker.close();
    await systemQueue.close();
    await computeQueue.close();
    await prisma.$disconnect();
    redis.disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, 'Start fehlgeschlagen');
  process.exit(1);
});
