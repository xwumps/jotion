import {
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_MAX_AGE_MS,
  type WorkerHeartbeat,
} from '@jotion/shared';
import type { Redis } from 'ioredis';
import { WORKER_VERSION } from './version';

export async function writeHeartbeat(redis: Redis, now = Date.now()): Promise<WorkerHeartbeat> {
  const hb: WorkerHeartbeat = { at: now, pid: process.pid, version: WORKER_VERSION };
  // TTL als Sicherheitsnetz, falls der Worker hart beendet wird
  await redis.set(WORKER_HEARTBEAT_KEY, JSON.stringify(hb), 'PX', WORKER_HEARTBEAT_MAX_AGE_MS * 2);
  return hb;
}

export { WORKER_HEARTBEAT_INTERVAL_MS };
