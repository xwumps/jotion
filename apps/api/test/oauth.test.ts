import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { secretsContext } from '@jotion/integrations';
import { FakeCloud } from '@jotion/integrations/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SyncRunnerService } from '../src/integrations/sync-runner.service';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/**
 * Phase 11: OAuth über die API (Start, Rückleitung, Verbindung, Neu-Anmeldung), Sync mit
 * Token-Erneuerung, Telegram-Bot bis in die Datenbank. Alle Dienste als Fake-Server.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let owner: Client;
let ws: string;
let cloud: FakeCloud;

beforeAll(async () => {
  cloud = new FakeCloud();
  await cloud.start();
  process.env.JOTION_SSRF_ALLOWLIST = '127.0.0.1';
  process.env.JOTION_GOOGLE_CLIENT_ID = 'google-client';
  process.env.JOTION_GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.JOTION_MICROSOFT_CLIENT_ID = '';
  process.env.JOTION_INTEGRATION_ENDPOINTS = JSON.stringify({
    ...cloud.endpoints,
    'oauth:google:token': `${cloud.url}/oauth/token`,
  });
  ({ app, db: prisma } = await createTestApp());
});
afterAll(async () => {
  await app?.close();
  await cloud?.stop();
});
beforeEach(async () => {
  await resetState(app);
  const o = await setupOwner(app);
  owner = o.client;
  ws = o.workspaceId;
  cloud.accessToken = 'access-1';
  cloud.refreshToken = 'refresh-1';
});

const base = () => `/api/workspaces/${ws}/integrations`;

async function connectGoogle(c: Client = owner, extra: object = {}) {
  const start = await c.post(`${base()}/oauth/start`, { type: 'google', ...extra });
  expect(start.status).toBe(200);
  const url = new URL(start.body.url);
  const state = url.searchParams.get('state')!;
  const cb = await c.get(
    `/api/integrations/oauth/callback?code=good-code&state=${encodeURIComponent(state)}`,
  );
  return { start: url, state, cb, location: String(cb.headers.location ?? '') };
}

describe('OAuth-Anmeldung', () => {
  it('nur eingerichtete Anbieter, PKCE, Verbindung mit Quellen, Tokens verschlüsselt', async () => {
    const types = (await owner.get(`${base()}/connectors`)).body as {
      type: string;
      available: boolean;
      authKind: string;
    }[];
    expect(types.find((t) => t.type === 'google')).toMatchObject({
      available: true,
      authKind: 'oauth2',
    });
    expect(types.find((t) => t.type === 'microsoft')!.available).toBe(false);
    expect(types.find((t) => t.type === 'telegram')!.authKind).toBe('token');
    expect((await owner.post(`${base()}/oauth/start`, { type: 'microsoft' })).status).toBe(422);

    const { start, state, cb, location } = await connectGoogle();
    expect(start.searchParams.get('client_id')).toBe('google-client');
    expect(start.searchParams.get('redirect_uri')).toBe(
      'http://jotion.test/api/integrations/oauth/callback',
    );
    expect(start.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(cb.status).toBe(302);
    expect(location).toMatch(new RegExp(`^/w/${ws}/settings\\?tab=integrations&connected=`));
    const id = new URL(location, 'http://x').searchParams.get('connected')!;

    const conn = await prisma.integrationConnection.findUniqueOrThrow({ where: { id } });
    expect(conn).toMatchObject({ type: 'google', accountLabel: 'jarne@gmail.test' });
    expect(conn.secrets).toMatch(/^v1:/);
    expect(conn.secrets).not.toContain('refresh-1');
    const secrets = JSON.parse(
      app.get(SyncRunnerService).box.decrypt(conn.secrets!, secretsContext(id)),
    ) as Record<string, string>;
    expect(secrets.refreshToken).toBe('refresh-1');
    const list = (await owner.get(base())).body;
    expect(list[0].sources.map((s: { remoteId: string }) => s.remoteId)).toEqual([
      'calendar:primary',
      'gmail:INBOX',
      'gmail:STARRED',
      'drive',
    ]);
    expect(JSON.stringify(list)).not.toContain('access-');

    // Zustand ist einmalig
    const again = await owner.get(
      `/api/integrations/oauth/callback?code=good-code&state=${encodeURIComponent(state)}`,
    );
    expect(String(again.headers.location)).toContain('integrationError=state');
  });

  it('fremder Nutzer, abgelehnte Anmeldung und falscher Code legen nichts an', async () => {
    const member = (await addMember(app, owner, ws, 'member@test.local')).client;
    const start = await owner.post(`${base()}/oauth/start`, { type: 'google' });
    const state = new URL(start.body.url).searchParams.get('state')!;
    const other = await member.get(
      `/api/integrations/oauth/callback?code=good-code&state=${state}`,
    );
    expect(String(other.headers.location)).toContain('integrationError=user');

    const s2 = new URL(
      (await owner.post(`${base()}/oauth/start`, { type: 'google' })).body.url,
    ).searchParams.get('state')!;
    const denied = await owner.get(
      `/api/integrations/oauth/callback?error=access_denied&state=${s2}`,
    );
    expect(String(denied.headers.location)).toContain('integrationError=denied');

    const s3 = new URL(
      (await owner.post(`${base()}/oauth/start`, { type: 'google' })).body.url,
    ).searchParams.get('state')!;
    const bad = await owner.get(`/api/integrations/oauth/callback?code=falsch&state=${s3}`);
    expect(String(bad.headers.location)).toContain('integrationError=token');
    expect(await prisma.integrationConnection.count()).toBe(0);
  });
});

describe('Sync mit Token-Erneuerung', () => {
  it('Gmail in eine neue Datenbank, abgelaufenes Token wird erneuert, widerrufenes pausiert', async () => {
    cloud.gmail.put({
      id: 'g1',
      threadId: 't1',
      labelIds: ['INBOX', 'UNREAD'],
      snippet: 'Bitte bis Freitag zurückgeben',
      internalDate: String(Date.UTC(2026, 10, 7)),
      payload: {
        headers: [
          { name: 'Subject', value: 'Elternbrief' },
          { name: 'From', value: 'Schule <info@schule.test>' },
        ],
      },
    });
    const { location } = await connectGoogle();
    const id = new URL(location, 'http://x').searchParams.get('connected')!;
    const conn = (await owner.get(base())).body[0];
    const inbox = conn.sources.find((s: { remoteId: string }) => s.remoteId === 'gmail:INBOX');
    const src = await owner.post(`${base()}/${id}/sources/${inbox.id}/database`, { title: 'Post' });
    expect(src.status).toBe(201);
    const dbId = src.body.targetDatabaseId as string;
    const db = (await owner.get(`/api/databases/${dbId}`)).body as {
      properties: { id: string; name: string }[];
    };
    expect(db.properties.map((p) => p.name)).toEqual(
      expect.arrayContaining(['Eingang', 'Von', 'Gelesen']),
    );

    // Token als abgelaufen speichern: der Sync erneuert es zuerst
    const box = app.get(SyncRunnerService).box;
    const stored = await prisma.integrationConnection.findUniqueOrThrow({ where: { id } });
    const secrets = JSON.parse(box.decrypt(stored.secrets!, secretsContext(id))) as Record<
      string,
      string
    >;
    await prisma.integrationConnection.update({
      where: { id },
      data: {
        secrets: box.encrypt(JSON.stringify({ ...secrets, expiresAt: '0' }), secretsContext(id)),
      },
    });
    const before = cloud.requests.filter((r) => r.path === '/oauth/token').length;
    const run = await owner.post(`${base()}/${id}/sync`);
    expect(run.body.run.status).toBe('succeeded');
    expect(run.body.run.stats.created).toBe(1);
    expect(cloud.requests.filter((r) => r.path === '/oauth/token').length).toBe(before + 1);
    const after = JSON.parse(
      box.decrypt(
        (await prisma.integrationConnection.findUniqueOrThrow({ where: { id } })).secrets!,
        secretsContext(id),
      ),
    ) as Record<string, string>;
    expect(after.accessToken).toBe(cloud.accessToken);
    expect(Number(after.expiresAt)).toBeGreaterThan(Date.now());

    const rows = (await owner.post(`/api/databases/${dbId}/query`, {})).body.rows as {
      title: string;
      values: Record<string, unknown>;
    }[];
    expect(rows.map((r) => r.title)).toEqual(['Elternbrief']);
    const von = db.properties.find((p) => p.name === 'Von')!;
    expect(rows[0]!.values[von.id]).toBe('Schule <info@schule.test>');

    // Freigabe widerrufen: Anmeldefehler, Verbindung im Fehlerstatus, Neu-Anmeldung behebt es
    cloud.refreshToken = 'widerrufen';
    await prisma.integrationConnection.update({
      where: { id },
      data: {
        secrets: box.encrypt(JSON.stringify({ ...after, expiresAt: '0' }), secretsContext(id)),
      },
    });
    const failed = await owner.post(`${base()}/${id}/sync`);
    expect(failed.body.run.status).toBe('failed');
    expect((await prisma.integrationConnection.findUniqueOrThrow({ where: { id } })).status).toBe(
      'error',
    );
    cloud.refreshToken = 'refresh-1';
    const re = await connectGoogle(owner, { connectionId: id });
    expect(re.location).toContain(`connected=${id}`);
    expect((await prisma.integrationConnection.findUniqueOrThrow({ where: { id } })).status).toBe(
      'active',
    );
    expect(await prisma.integrationConnection.count()).toBe(1);
  });
});

describe('Telegram-Bot', () => {
  it('Nachrichten erlaubter Absender werden zu Zeilen', async () => {
    const res = await owner.post(base(), {
      type: 'telegram',
      name: 'Inbox-Bot',
      config: { allowedUsers: '@jarne' },
      secrets: { botToken: cloud.botToken },
    });
    expect(res.status).toBe(201);
    expect(res.body.accountLabel).toBe('@jotion_test_bot');
    cloud.tgUpdates.length = 0;
    cloud.tgUpdates.push(
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1_794_000_000,
          text: 'Zahnarzt anrufen',
          from: { id: 7, username: 'jarne' },
          chat: { id: 7, type: 'private' },
        },
      },
      {
        update_id: 2,
        message: {
          message_id: 2,
          date: 1_794_000_000,
          text: 'Werbung',
          from: { id: 8, username: 'spam' },
          chat: { id: 8, type: 'private' },
        },
      },
    );
    const sid = res.body.sources[0].id;
    const src = await owner.post(`${base()}/${res.body.id}/sources/${sid}/database`, {
      title: 'Inbox',
    });
    const run = await owner.post(`${base()}/${res.body.id}/sync`);
    expect(run.body.run.stats.created).toBe(1);
    const rows = (await owner.post(`/api/databases/${src.body.targetDatabaseId}/query`, {})).body
      .rows;
    expect(rows.map((r: { title: string }) => r.title)).toEqual(['Zahnarzt anrufen']);
    // Zweiter Lauf: Offset gespeichert, nichts Neues
    const run2 = await owner.post(`${base()}/${res.body.id}/sync`);
    expect(run2.body.run.stats).toMatchObject({ created: 0, updated: 0 });
    const ok = await owner.post(base(), {
      type: 'telegram',
      name: 'x',
      config: { allowedUsers: '' },
      secrets: { botToken: cloud.botToken },
    });
    expect(ok.status).toBe(422);
  });
});
