/**
 * Docker-Healthcheck: Exit 0, wenn der Worker kürzlich einen Heartbeat geschrieben hat.
 * Nutzt nur REDIS_URL, damit der Check schnell und ohne vollständige Konfiguration läuft.
 */
import { isHeartbeatFresh, parseHeartbeat, WORKER_HEARTBEAT_KEY } from '@jotion/shared';
import { Redis } from 'ioredis';

async function check(): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) return false;
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    lazyConnect: true,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    return isHeartbeatFresh(parseHeartbeat(await redis.get(WORKER_HEARTBEAT_KEY)));
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

check().then((ok) => process.exit(ok ? 0 : 1));
