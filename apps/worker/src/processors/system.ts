import { SYSTEM_JOBS } from '@jotion/shared';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { writeHeartbeat } from '../heartbeat';

/** Verarbeitet Jobs der System-Queue. Weitere Queues (Sync, Automations) folgen phasenweise. */
export function createSystemProcessor(redis: Redis) {
  return async (job: Job): Promise<unknown> => {
    switch (job.name) {
      case SYSTEM_JOBS.heartbeat:
        return writeHeartbeat(redis);
      default:
        throw new Error(`Unbekannter Job: ${job.name}`);
    }
  };
}
