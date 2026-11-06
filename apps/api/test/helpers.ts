import 'reflect-metadata';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OutgoingHttpHeaders } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { createApp } from '../src/main';

export const PUBLIC_URL = 'http://jotion.test';

/** Startet die API für Tests. Datenbank muss auf "_test" enden (Schutz vor Datenverlust). */
export async function createTestApp(
  opts: { listen?: boolean } = {},
): Promise<{ app: NestFastifyApplication; db: PrismaClient; port: number }> {
  const dbName = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Tests leeren die Datenbank. DATABASE_URL muss auf eine *_test-Datenbank zeigen (ist: ${dbName})`,
    );
  }
  process.env.NODE_ENV = 'test';
  process.env.JOTION_DISABLE_RELAY = '1';
  // Abhängige Berechnungen direkt in der API (kein Worker im Test)
  process.env.JOTION_COMPUTE_INLINE = 'true';
  process.env.JOTION_PUBLIC_URL = PUBLIC_URL;
  process.env.JOTION_FILES_DIR = mkdtempSync(join(tmpdir(), 'jotion-files-'));
  const app = await createApp();
  let port = 0;
  if (opts.listen) {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.getHttpServer().address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  } else {
    await app.init();
  }
  await app.getHttpAdapter().getInstance().ready();
  return { app, db: app.get(PrismaService).client, port };
}

export async function resetState(app: NestFastifyApplication): Promise<void> {
  const db = app.get(PrismaService).client;
  await db.$executeRawUnsafe(
    'TRUNCATE users, workspaces, change_events, system_settings RESTART IDENTITY CASCADE',
  );
  const redis = app.get(RedisService).client;
  const keys = await redis.keys('jotion:rl:*');
  if (keys.length) await redis.del(...keys);
}

interface Res {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: OutgoingHttpHeaders;
}

/** HTTP-Client mit Cookie-Speicher über app.inject (kein echter Netzwerkport). */
export class Client {
  cookie: string | null = null;
  constructor(private readonly app: NestFastifyApplication) {}

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Res> {
    const res = await this.app.inject({
      method,
      url,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    const setCookie = res.headers['set-cookie'];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (first?.startsWith('jotion_session=')) {
      const value = first.split(';')[0]!;
      this.cookie = value === 'jotion_session=' ? null : value;
    }
    let parsed: unknown = res.body;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      /* kein JSON */
    }
    return { status: res.statusCode, body: parsed, headers: res.headers };
  }

  get = (url: string, headers?: Record<string, string>) =>
    this.request('GET', url, undefined, headers);
  post = (url: string, body: unknown = {}, headers?: Record<string, string>) =>
    this.request('POST', url, body, headers);
  patch = (url: string, body: unknown = {}) => this.request('PATCH', url, body);
  put = (url: string, body: unknown = {}) => this.request('PUT', url, body);
  del = (url: string) => this.request('DELETE', url);
}

export const PASSWORD = 'sehr-geheimes-passwort';

/** Richtet Jotion mit einem Owner ein und liefert Client + Workspace-ID. */
export async function setupOwner(app: NestFastifyApplication, email = 'owner@test.local') {
  const c = new Client(app);
  const res = await c.post('/api/auth/setup', {
    name: 'Olivia Owner',
    email,
    password: PASSWORD,
    workspaceName: 'Team',
  });
  if (res.status !== 201) throw new Error(`Setup fehlgeschlagen: ${JSON.stringify(res.body)}`);
  const me = await c.get('/api/auth/me');
  return {
    client: c,
    workspaceId: me.body.workspaces[0].id as string,
    userId: me.body.user.id as string,
  };
}

/** Lädt per Einladung ein neues Mitglied ein und liefert dessen Client. */
export async function addMember(
  app: NestFastifyApplication,
  owner: Client,
  workspaceId: string,
  email: string,
  role: 'OWNER' | 'MEMBER' = 'MEMBER',
) {
  const inv = await owner.post(`/api/workspaces/${workspaceId}/invitations`, { role });
  const token = new URL(inv.body.url).pathname.split('/').pop()!;
  const c = new Client(app);
  const res = await c.post('/api/auth/register', {
    token,
    name: email.split('@')[0],
    email,
    password: PASSWORD,
  });
  if (res.status !== 201)
    throw new Error(`Registrierung fehlgeschlagen: ${JSON.stringify(res.body)}`);
  const me = await c.get('/api/auth/me');
  return { client: c, userId: me.body.user.id as string };
}

export function tokenFromUrl(url: string): string {
  return new URL(url).pathname.split('/').pop()!;
}
