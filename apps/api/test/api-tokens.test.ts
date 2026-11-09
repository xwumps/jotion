import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, Client, createTestApp, resetState, setupOwner } from './helpers';

/** Phase 12: API-Tokens (lesen/schreiben, Ablauf, gesperrte Bereiche, Rechte des Nutzers). */
let app: NestFastifyApplication;
let db: PrismaClient;
let owner: Client;
let ws: string;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
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

const bearer = (token: string) => {
  const c = new Client(app);
  const req = c.request.bind(c);
  c.request = (method, url, body, headers = {}) =>
    req(method, url, body, { authorization: `Bearer ${token}`, ...headers });
  return c;
};

describe('API-Tokens', () => {
  it('einmal sichtbar, nur als Hash gespeichert, lesen und schreiben nach Umfang', async () => {
    const r = await owner.post('/api/me/tokens', { name: 'Skript', scope: 'read' });
    expect(r.status).toBe(201);
    expect(r.body.token).toMatch(/^jtn_[\w-]{43}$/);
    expect(r.body.prefix).toBe(r.body.token.slice(0, 10));
    const stored = await db.apiToken.findFirstOrThrow();
    expect(stored.tokenHash).not.toContain(r.body.token);
    expect(JSON.stringify((await owner.get('/api/me/tokens')).body)).not.toContain(r.body.token);

    const read = bearer(r.body.token);
    expect((await read.get('/api/auth/me')).body.user.email).toBe('owner@test.local');
    expect((await read.get(`/api/workspaces/${ws}/sidebar`)).status).toBe(200);
    const denied = await read.post(`/api/workspaces/${ws}/pages`, { title: 'x', scope: 'TEAM' });
    expect(denied.status).toBe(403);

    const w = (await owner.post('/api/me/tokens', { name: 'Import', scope: 'write' })).body;
    const write = bearer(w.token);
    const page = await write.post(`/api/workspaces/${ws}/pages`, {
      title: 'Per API',
      scope: 'TEAM',
    });
    expect(page.status).toBe(201);
    expect(page.body.createdBy.name).toBe('Olivia Owner');
    expect(
      (await db.apiToken.findUniqueOrThrow({ where: { id: w.id } })).lastUsedAt,
    ).not.toBeNull();
  });

  it('gesperrte Bereiche, Widerruf, Ablauf, fremde Workspaces', async () => {
    const t = (await owner.post('/api/me/tokens', { name: 'x', scope: 'write' })).body;
    const c = bearer(t.token);
    expect((await c.post('/api/me/tokens', { name: 'y' })).status).toBe(403);
    expect((await c.post('/api/auth/password', { current: 'a', next: 'b' })).status).toBe(403);
    expect((await c.post('/api/auth/logout')).status).toBe(403);
    expect((await c.get('/api/admin/status')).status).toBe(403);
    // Rechte des Nutzers gelten: fremder Workspace unsichtbar
    const other = await addMember(app, owner, ws, 'm@test.local');
    const foreign = (await other.client.post('/api/workspaces', { name: 'Privat' })).body.id;
    expect((await c.get(`/api/workspaces/${foreign}/sidebar`)).status).toBe(404);

    expect((await owner.del(`/api/me/tokens/${t.id}`)).status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await bearer('jtn_falsch').get('/api/auth/me')).status).toBe(401);

    const e = (await owner.post('/api/me/tokens', { name: 'kurz', expiresInDays: 1 })).body;
    await db.apiToken.update({
      where: { id: e.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await bearer(e.token).get('/api/auth/me')).status).toBe(401);
    // Deaktiviertes Konto: Tokens ungültig
    const d = (await owner.post('/api/me/tokens', { name: 'd' })).body;
    await db.user.update({
      where: { email: 'owner@test.local' },
      data: { disabledAt: new Date() },
    });
    expect((await bearer(d.token).get('/api/auth/me')).status).toBe(401);
  });

  it('erstes Konto ist Instanz-Admin, weitere nicht', async () => {
    expect((await owner.get('/api/auth/me')).body.user.isAdmin).toBe(true);
    const m = await addMember(app, owner, ws, 'm@test.local');
    expect((await m.client.get('/api/auth/me')).body.user.isAdmin).toBe(false);
  });
});
