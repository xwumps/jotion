import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, Client, createTestApp, resetState, setupOwner } from './helpers';

/** Phase 12: Admin-Bereich (Status, Sicherungen, Konten) und Prometheus-Metriken. */
let app: NestFastifyApplication;
let owner: Client;
let ws: string;
const BACKUPS = mkdtempSync(join(tmpdir(), 'jotion-backups-'));

beforeAll(async () => {
  process.env.JOTION_BACKUP_DIR = BACKUPS;
  process.env.JOTION_METRICS_TOKEN = 'metrik-geheim';
  ({ app } = await createTestApp());
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  await resetState(app);
  const o = await setupOwner(app);
  owner = o.client;
  ws = o.workspaceId;
});

describe('Admin-Bereich', () => {
  it('Status mit Prüfungen, Zahlen und Sicherungen; Sicherung anfordern', async () => {
    writeFileSync(join(BACKUPS, 'jotion-20261108-031500-auto.tar'), 'x'.repeat(100));
    writeFileSync(join(BACKUPS, 'jotion-20261109-031500-auto.tar'), 'x'.repeat(200));
    writeFileSync(join(BACKUPS, 'fremd.txt'), 'x');
    writeFileSync(
      join(BACKUPS, 'status.json'),
      JSON.stringify({
        lastRun: '2026-11-09T02:15:00Z',
        ok: true,
        trigger: 'auto',
        file: 'jotion-20261109-031500-auto.tar',
      }),
    );
    const s = (await owner.get('/api/admin/status')).body;
    expect(s.checks.database.status).toBe('ok');
    expect(s.counts).toMatchObject({ users: 1, workspaces: 1 });
    expect(s.storage.databaseBytes).toBeGreaterThan(0);
    expect(s.backups.list.map((b: { name: string }) => b.name)).toEqual([
      'jotion-20261109-031500-auto.tar',
      'jotion-20261108-031500-auto.tar',
    ]);
    expect(s.backups.list[0]).toMatchObject({
      size: 200,
      createdAt: '2026-11-09T03:15:00Z',
      trigger: 'auto',
    });
    expect(s.backups.last).toMatchObject({ ok: true });
    expect((await owner.post('/api/admin/backups')).status).toBe(202);
    expect(readdirSync(BACKUPS)).toContain('.request');
    expect((await owner.get('/api/admin/status')).body.backups.requested).toBe(true);
  });

  it('nur Admins; Konten sperren und Admin-Recht vergeben, letzter Admin bleibt', async () => {
    const m = await addMember(app, owner, ws, 'm@test.local');
    expect((await m.client.get('/api/admin/status')).status).toBe(403);
    expect((await m.client.get('/api/admin/users')).status).toBe(403);
    const users = (await owner.get('/api/admin/users')).body;
    expect(users.map((u: { email: string; isAdmin: boolean }) => [u.email, u.isAdmin])).toEqual([
      ['owner@test.local', true],
      ['m@test.local', false],
    ]);
    const me = users[0].id;
    expect((await owner.patch(`/api/admin/users/${me}`, { disabled: true })).status).toBe(422);
    expect((await owner.patch(`/api/admin/users/${me}`, { isAdmin: false })).status).toBe(422);

    // Sperren beendet Sitzungen sofort
    expect((await m.client.get('/api/auth/me')).status).toBe(200);
    const locked = await owner.patch(`/api/admin/users/${m.userId}`, { disabled: true });
    expect(locked.body.disabled).toBe(true);
    expect((await m.client.get('/api/auth/me')).status).toBe(401);
    const login = await new Client(app).post('/api/auth/login', {
      email: 'm@test.local',
      password: 'sehr-geheimes-passwort',
    });
    expect(login.status).not.toBe(200);
    await owner.patch(`/api/admin/users/${m.userId}`, { disabled: false, isAdmin: true });
    const m2 = new Client(app);
    expect(
      (
        await m2.post('/api/auth/login', {
          email: 'm@test.local',
          password: 'sehr-geheimes-passwort',
        })
      ).status,
    ).toBe(200);
    expect((await m2.get('/api/admin/status')).status).toBe(200);
  });
});

describe('Metriken', () => {
  it('nur mit Token, Prometheus-Textformat', async () => {
    const anon = new Client(app);
    expect((await anon.get('/api/metrics')).status).toBe(401);
    expect((await anon.get('/api/metrics', { authorization: 'Bearer falsch' })).status).toBe(401);
    const r = await app.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { authorization: 'Bearer metrik-geheim' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/plain');
    expect(r.body).toContain('# TYPE jotion_users gauge');
    expect(r.body).toMatch(/^jotion_users 1$/m);
    expect(r.body).toMatch(/^jotion_backup_last_success_timestamp \d+$/m);
  });
});
