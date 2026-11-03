import type { PrismaClient } from '@jotion/db';
import { SYSTEM_JOBS } from '@jotion/shared';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { writeHeartbeat } from '../heartbeat';
import { runMaintenance } from './maintenance';

/** Verarbeitet Jobs der System-Queue. Weitere Queues (Sync, Automations) folgen phasenweise. */
export function createSystemProcessor(redis: Redis, db?: PrismaClient) {
  return async (job: Job): Promise<unknown> => {
    switch (job.name) {
      case SYSTEM_JOBS.heartbeat:
        return writeHeartbeat(redis);
      case SYSTEM_JOBS.maintenance:
        if (!db) throw new Error('Datenbank nicht verfügbar');
        return runMaintenance(db);
      default:
        throw new Error(`Unbekannter Job: ${job.name}`);
    }
  };
}
