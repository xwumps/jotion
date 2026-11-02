import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  Client,
  createTestApp,
  PASSWORD,
  PUBLIC_URL,
  resetState,
  setupOwner,
  tokenFromUrl,
} from './helpers';

let app: NestFastifyApplication;
let db: PrismaClient;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  await resetState(app);
});

describe('Ersteinrichtung', () => {
  it('ist nur einmal möglich und macht den ersten Nutzer zum Owner', async () => {
    const anon = new Client(app);
    expect((await anon.get('/api/auth/setup-status')).body).toEqual({ setupRequired: true });

    const { client } = await setupOwner(app);
    const me = await client.get('/api/auth/me');
    expect(me.body.user.email).toBe('owner@test.local');
    expect(me.body.workspaces).toEqual([expect.objectContaining({ name: 'Team', role: 'OWNER' })]);
    expect((await anon.get('/api/auth/setup-status')).body).toEqual({ setupRequired: false });

    const again = await anon.post('/api/auth/setup', {
      name: 'X',
      email: 'x@test.local',
      password: PASSWORD,
      workspaceName: 'W',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_set_up');
  });

  it('lässt bei parallelen Versuchen genau einen gewinnen', async () => {
    const attempts = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        new Client(app).post('/api/auth/setup', {
          name: `U${i}`,
          email: `u${i}@test.local`,
          password: PASSWORD,
          workspaceName: 'W',
        }),
      ),
    );
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.user.count()).toBe(1);
  });

  it('validiert Eingaben', async () => {
    const res = await new Client(app).post('/api/auth/setup', {
      name: '',
      email: 'kaputt',
      password: 'kurz',
      workspaceName: '',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

describe('Login und Sessions', () => {
  it('meldet an, setzt ein sicheres Cookie und meldet ab', async () => {
    await setupOwner(app);
    const c = new Client(app);
    const res = await c.post('/api/auth/login', { email: 'OWNER@test.local ', password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect((await c.get('/api/auth/me')).status).toBe(200);

    const saved = c.cookie;
    await c.post('/api/auth/logout');
    c.cookie = saved; // altes Cookie darf nicht mehr gelten
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('gibt für falsches Passwort und unbekannte E-Mail denselben Fehler', async () => {
    await setupOwner(app);
    const wrong = await new Client(app).post('/api/auth/login', {
      email: 'owner@test.local',
      password: 'falsch-falsch',
    });
    const unknown = await new Client(app).post('/api/auth/login', {
      email: 'niemand@test.local',
      password: 'falsch-falsch',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('begrenzt Fehlversuche pro E-Mail', async () => {
    await setupOwner(app);
    const c = new Client(app);
    for (let i = 0; i < 10; i++)
      await c.post('/api/auth/login', { email: 'owner@test.local', password: 'falsch-falsch' });
    const blocked = await c.post('/api/auth/login', {
      email: 'owner@test.local',
      password: PASSWORD,
    });
    expect(blocked.status).toBe(429);
  });

  it('verlangt Anmeldung für geschützte Routen', async () => {
    const res = await new Client(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('ignoriert manipulierte Cookies', async () => {
    const c = new Client(app);
    c.cookie = 'jotion_session=gefaelscht';
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('Passwortänderung beendet andere Sessions, nicht die aktuelle', async () => {
    const { client } = await setupOwner(app);
    const other = new Client(app);
    await other.post('/api/auth/login', { email: 'owner@test.local', password: PASSWORD });

    const bad = await client.post('/api/auth/password', {
      currentPassword: 'falsch',
      newPassword: 'neues-passwort-123',
    });
    expect(bad.status).toBe(401);
    expect(
      (
        await client.post('/api/auth/password', {
          currentPassword: PASSWORD,
          newPassword: 'neues-passwort-123',
        })
      ).status,
    ).toBe(200);
    expect((await client.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect(
      (
        await new Client(app).post('/api/auth/login', {
          email: 'owner@test.local',
          password: 'neues-passwort-123',
        })
      ).status,
    ).toBe(200);
  });
});

describe('Einladungen', () => {
  it('registriert über Link, der danach verbraucht ist', async () => {
    const { client, workspaceId } = await setupOwner(app);
    const inv = await client.post(`/api/workspaces/${workspaceId}/invitations`, {
      note: 'Für Max',
    });
    expect(inv.status).toBe(201);
    expect(inv.body.url).toMatch(new RegExp(`^${PUBLIC_URL}/invite/`));
    const token = tokenFromUrl(inv.body.url);

    const preview = await new Client(app).get(`/api/auth/invitations/${token}`);
    expect(preview.body).toEqual({ workspaceName: 'Team', role: 'MEMBER' });

    const max = new Client(app);
    expect(
      (
        await max.post('/api/auth/register', {
          token,
          name: 'Max',
          email: 'max@test.local',
          password: PASSWORD,
        })
      ).status,
    ).toBe(201);
    expect((await max.get('/api/auth/me')).body.workspaces[0]).toMatchObject({
      id: workspaceId,
      role: 'MEMBER',
    });

    const reuse = await new Client(app).post('/api/auth/register', {
      token,
      name: 'Eve',
      email: 'eve@test.local',
      password: PASSWORD,
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('token_invalid');
  });

  it('respektiert maxUses auch bei parallelen Registrierungen', async () => {
    const { client, workspaceId } = await setupOwner(app);
    const inv = await client.post(`/api/workspaces/${workspaceId}/invitations`, { maxUses: 2 });
    const token = tokenFromUrl(inv.body.url);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        new Client(app).post('/api/auth/register', {
          token,
          name: `N${i}`,
          email: `n${i}@test.local`,
          password: PASSWORD,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await db.workspaceMember.count({ where: { workspaceId } })).toBe(3);
  });

  it('widerrufene und abgelaufene Einladungen gelten nicht', async () => {
    const { client, workspaceId } = await setupOwner(app);
    const a = await client.post(`/api/workspaces/${workspaceId}/invitations`, {});
    await client.del(`/api/workspaces/${workspaceId}/invitations/${a.body.id}`);
    expect(
      (await new Client(app).get(`/api/auth/invitations/${tokenFromUrl(a.body.url)}`)).status,
    ).toBe(400);

    const b = await client.post(`/api/workspaces/${workspaceId}/invitations`, {});
    await db.invitation.update({
      where: { id: b.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await new Client(app).get(`/api/auth/invitations/${tokenFromUrl(b.body.url)}`)).status,
    ).toBe(400);
  });

  it('bestehendes Konto tritt per Einladung einem weiteren Workspace bei', async () => {
    const { client } = await setupOwner(app);
    const ws2 = await client.post('/api/workspaces', { name: 'Familie' });
    const other = await addMember(
      app,
      client,
      (await client.get('/api/auth/me')).body.workspaces[0].id,
      'max@test.local',
    );
    const inv = await client.post(`/api/workspaces/${ws2.body.id}/invitations`, {});
    const res = await other.client.post(
      `/api/auth/invitations/${tokenFromUrl(inv.body.url)}/accept`,
    );
    expect(res.body.workspaceId).toBe(ws2.body.id);
    expect((await other.client.get('/api/auth/me')).body.workspaces).toHaveLength(2);
  });

  it('E-Mail bereits registriert: Konflikt statt zweitem Konto', async () => {
    const { client, workspaceId } = await setupOwner(app);
    const inv = await client.post(`/api/workspaces/${workspaceId}/invitations`, {});
    const res = await new Client(app).post('/api/auth/register', {
      token: tokenFromUrl(inv.body.url),
      name: 'X',
      email: 'owner@test.local',
      password: PASSWORD,
    });
    expect(res.status).toBe(409);
  });
});

describe('Passwort-Reset durch Owner', () => {
  it('setzt Passwort zurück und beendet alte Sessions', async () => {
    const { client, workspaceId } = await setupOwner(app);
    const max = await addMember(app, client, workspaceId, 'max@test.local');
    const link = await client.post(
      `/api/workspaces/${workspaceId}/members/${max.userId}/reset-link`,
    );
    expect(link.status).toBe(201);

    const reset = await new Client(app).post('/api/auth/password-reset', {
      token: tokenFromUrl(link.body.url),
      newPassword: 'ganz-neues-pw-1',
    });
    expect(reset.status).toBe(200);
    expect((await max.client.get('/api/auth/me')).status).toBe(401);
    expect(
      (
        await new Client(app).post('/api/auth/login', {
          email: 'max@test.local',
          password: 'ganz-neues-pw-1',
        })
      ).status,
    ).toBe(200);
    // Link nur einmal verwendbar
    expect(
      (
        await new Client(app).post('/api/auth/password-reset', {
          token: tokenFromUrl(link.body.url),
          newPassword: 'noch-ein-pw-12',
        })
      ).status,
    ).toBe(400);
  });

  it('verweigert Reset für Mitglieder, die anderswo Owner sind', async () => {
    const { client, workspaceId } = await setupOwner(app);
    const max = await addMember(app, client, workspaceId, 'max@test.local');
    await max.client.post('/api/workspaces', { name: 'Max privat' });
    const link = await client.post(
      `/api/workspaces/${workspaceId}/members/${max.userId}/reset-link`,
    );
    expect(link.status).toBe(403);
  });

  it('nur Owner dürfen Reset-Links erzeugen', async () => {
    const { client, workspaceId, userId } = await setupOwner(app);
    const max = await addMember(app, client, workspaceId, 'max@test.local');
    expect(
      (await max.client.post(`/api/workspaces/${workspaceId}/members/${userId}/reset-link`)).status,
    ).toBe(403);
  });
});

describe('CSRF-Schutz', () => {
  it('lehnt schreibende Requests von fremden Origins ab', async () => {
    const { client, workspaceId } = await setupOwner(app);
    const evil = await client.post(
      `/api/workspaces/${workspaceId}/pages`,
      { title: 'x' },
      { origin: 'https://boese.example' },
    );
    expect(evil.status).toBe(403);
    const ok = await client.post(
      `/api/workspaces/${workspaceId}/pages`,
      { title: 'x' },
      { origin: PUBLIC_URL },
    );
    expect(ok.status).toBe(201);
    const crossSite = await client.post(
      `/api/workspaces/${workspaceId}/pages`,
      { title: 'x' },
      { 'sec-fetch-site': 'cross-site' },
    );
    expect(crossSite.status).toBe(403);
  });
});
