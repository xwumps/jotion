import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { WORKER_HEARTBEAT_KEY } from '@jotion/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisService } from '../src/infra/redis.service';
import { createApp } from '../src/main';

// Benötigt laufende Datenbank und Redis (DATABASE_URL, REDIS_URL), siehe docs/development.md
describe('Health-Endpunkte', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health/live', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'api' });
  });

  it('GET /api/health/ready prüft Datenbank und Redis', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.redis.status).toBe('ok');
  });

  it('GET /api/health/system meldet fehlenden Worker mit 503', async () => {
    const redis = app.get(RedisService).client;
    await redis.del(WORKER_HEARTBEAT_KEY);
    const res = await app.inject({ method: 'GET', url: '/api/health/system' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.worker.status).toBe('error');
  });

  it('GET /api/health/system ist ok mit frischem Heartbeat', async () => {
    const redis = app.get(RedisService).client;
    await redis.set(WORKER_HEARTBEAT_KEY, JSON.stringify({ at: Date.now(), pid: 1, version: 't' }));
    const res = await app.inject({ method: 'GET', url: '/api/health/system' });
    expect(res.statusCode).toBe(200);
    await redis.del(WORKER_HEARTBEAT_KEY);
  });

  it('unbekannte Routen liefern 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/gibt-es-nicht' });
    expect(res.statusCode).toBe(404);
  });
});
