import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RealtimeService } from '../src/events/realtime.service';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

let app: NestFastifyApplication;
let db: PrismaClient;
let c: Client;
let ws: string;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  await resetState(app);
  ({ client: c, workspaceId: ws } = await setupOwner(app));
});

const create = (body: object) => c.post(`/api/workspaces/${ws}/pages`, body).then((r) => r.body);
const sidebar = () => c.get(`/api/workspaces/${ws}/sidebar`).then((r) => r.body);
const titles = (nodes: { title: string }[]) => nodes.map((n) => n.title);

describe('Anlegen und Reihenfolge', () => {
  it('hängt neue Seiten ans Ende und fügt mit afterId/beforeId gezielt ein', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    const cc = await create({ title: 'C', scope: 'TEAM' });
    await create({ title: 'B', scope: 'TEAM', afterId: a.id });
    await create({ title: 'Anfang', scope: 'TEAM', beforeId: a.id });
    await create({ title: 'Ende', scope: 'TEAM', afterId: cc.id });
    expect(titles((await sidebar()).team)).toEqual(['Anfang', 'A', 'B', 'C', 'Ende']);
  });

  it('trennt private und Teamseiten in der Sidebar', async () => {
    await create({ title: 'Privat', scope: 'PRIVATE' });
    await create({ title: 'Team', scope: 'TEAM' });
    const s = await sidebar();
    expect(titles(s.private)).toEqual(['Privat']);
    expect(titles(s.team)).toEqual(['Team']);
  });

  it('liefert Kinder, hasChildren und Breadcrumbs', async () => {
    const root = await create({
      title: 'Wurzel',
      scope: 'TEAM',
      icon: { type: 'emoji', value: '📚' },
    });
    const mid = await create({ title: 'Mitte', parentId: root.id });
    const leaf = await create({ title: 'Blatt', parentId: mid.id });
    expect((await sidebar()).team[0].hasChildren).toBe(true);
    expect(titles((await c.get(`/api/pages/${root.id}/children`)).body)).toEqual(['Mitte']);
    const page = (await c.get(`/api/pages/${leaf.id}`)).body;
    expect(page.breadcrumbs.map((b: { title: string }) => b.title)).toEqual(['Wurzel', 'Mitte']);
    expect(page.breadcrumbs[0].icon).toEqual({ type: 'emoji', value: '📚' });
  });

  it('bleibt bei parallelem Anlegen eindeutig sortiert', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => create({ title: `P${i}`, scope: 'TEAM' })),
    );
    const positions = (await sidebar()).team.map((n: { position: string }) => n.position);
    expect(new Set(positions).size).toBe(20);
  });
});

describe('Verschieben', () => {
  it('verschiebt mit Teilbaum und verhindert Zyklen', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    const b = await create({ title: 'B', parentId: a.id });
    const x = await create({ title: 'X', scope: 'TEAM' });
    const cyc = await c.post(`/api/pages/${a.id}/move`, { parentId: b.id });
    expect(cyc.status).toBe(409);
    expect(cyc.body.error.code).toBe('cycle');
    expect((await c.post(`/api/pages/${a.id}/move`, { parentId: a.id })).status).toBe(409);

    await c.post(`/api/pages/${a.id}/move`, { parentId: x.id });
    const page = (await c.get(`/api/pages/${b.id}`)).body;
    expect(page.breadcrumbs.map((p: { title: string }) => p.title)).toEqual(['X', 'A']);
  });

  it('macht einen Teilbaum privat, wenn er in eine private Seite verschoben wird', async () => {
    const { client: member } = await addMember(app, c, ws, 'm@test.local');
    const team = await create({ title: 'Team', scope: 'TEAM' });
    const child = await create({ title: 'Kind', parentId: team.id });
    const priv = await create({ title: 'Privat', scope: 'PRIVATE' });
    expect((await member.get(`/api/pages/${child.id}`)).status).toBe(200);
    await c.post(`/api/pages/${team.id}/move`, { parentId: priv.id });
    expect((await member.get(`/api/pages/${child.id}`)).status).toBe(404);
    expect((await c.get(`/api/pages/${child.id}`)).body.scope).toBe('PRIVATE');
  });

  it('ordnet innerhalb derselben Ebene um', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    const b = await create({ title: 'B', scope: 'TEAM' });
    await create({ title: 'C', scope: 'TEAM' });
    await c.post(`/api/pages/${a.id}/move`, { afterId: b.id });
    expect(titles((await sidebar()).team)).toEqual(['B', 'A', 'C']);
  });

  it('lehnt afterId aus einer anderen Ebene ab', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    const b = await create({ title: 'B', parentId: a.id });
    const x = await create({ title: 'X', scope: 'TEAM' });
    expect(
      (await c.post(`/api/pages/${x.id}/move`, { parentId: null, afterId: b.id })).status,
    ).toBe(400);
  });
});

describe('Papierkorb und Archiv', () => {
  it('legt den Teilbaum in den Papierkorb und stellt ihn als Einheit wieder her', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    const b = await create({ title: 'B', parentId: a.id });
    const cc = await create({ title: 'C', parentId: b.id });
    await c.del(`/api/pages/${a.id}`);

    expect((await sidebar()).team).toEqual([]);
    const trash = (await c.get(`/api/workspaces/${ws}/trash`)).body;
    expect(titles(trash)).toEqual(['A']);
    // Unterseiten sind schreibgeschützt und einzeln nicht wiederherstellbar
    expect((await c.patch(`/api/pages/${cc.id}`, { title: 'x' })).status).toBe(404);
    expect((await c.post(`/api/pages/${b.id}/restore`)).status).toBe(400);
    expect((await c.get(`/api/pages/${cc.id}`)).body.deletedAt).not.toBeNull();

    await c.post(`/api/pages/${a.id}/restore`);
    expect(titles((await c.get(`/api/pages/${b.id}/children`)).body)).toEqual(['C']);
    expect((await c.get(`/api/workspaces/${ws}/trash`)).body).toEqual([]);
  });

  it('separat gelöschte Unterseite bleibt beim Wiederherstellen der Elternseite im Papierkorb', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    const b = await create({ title: 'B', parentId: a.id });
    await c.del(`/api/pages/${b.id}`);
    await c.del(`/api/pages/${a.id}`);
    expect(titles((await c.get(`/api/workspaces/${ws}/trash`)).body).sort()).toEqual(['A', 'B']);

    // B zuerst: Elternseite liegt im Papierkorb, also wird B zur Wurzelseite
    await c.post(`/api/pages/${b.id}/restore`);
    expect((await c.get(`/api/pages/${b.id}`)).body.parentId).toBeNull();
    expect(titles((await sidebar()).team)).toEqual(['B']);
    // A kehrt an ihre ursprüngliche Position zurück, B wurde ans Ende gehängt
    await c.post(`/api/pages/${a.id}/restore`);
    expect(titles((await sidebar()).team)).toEqual(['A', 'B']);
  });

  it('löscht endgültig samt Teilbaum', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    const b = await create({ title: 'B', parentId: a.id });
    expect((await c.del(`/api/pages/${a.id}/permanent`)).status).toBe(409);
    await c.del(`/api/pages/${a.id}`);
    expect((await c.del(`/api/pages/${a.id}/permanent`)).status).toBe(204);
    expect(await db.page.findUnique({ where: { id: b.id } })).toBeNull();
  });

  it('archiviert und holt zurück', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    await c.post(`/api/pages/${a.id}/archive`);
    expect((await sidebar()).team).toEqual([]);
    expect(titles((await c.get(`/api/workspaces/${ws}/archive`)).body)).toEqual(['A']);
    await c.post(`/api/pages/${a.id}/unarchive`);
    expect(titles((await sidebar()).team)).toEqual(['A']);
  });
});

describe('Bearbeiten', () => {
  it('ändert Titel, Icon, Cover und Einstellungen; gesperrte Seiten sind geschützt', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    const u = (
      await c.patch(`/api/pages/${a.id}`, {
        title: 'Neu',
        icon: { type: 'emoji', value: '🚀' },
        cover: { type: 'gradient', value: 'ocean' },
        settings: { fullWidth: true },
      })
    ).body;
    expect(u).toMatchObject({
      title: 'Neu',
      icon: { type: 'emoji', value: '🚀' },
      cover: { type: 'gradient', value: 'ocean' },
      settings: { fullWidth: true },
    });

    await c.patch(`/api/pages/${a.id}`, { settings: { locked: true } });
    expect((await c.patch(`/api/pages/${a.id}`, { title: 'gesperrt?' })).status).toBe(403);
    const unlocked = await c.patch(`/api/pages/${a.id}`, { settings: { locked: false } });
    expect(unlocked.body.settings).toEqual({ fullWidth: true, locked: false });
    expect((await c.patch(`/api/pages/${a.id}`, { icon: null, cover: null })).body).toMatchObject({
      icon: null,
      cover: null,
    });
  });

  it('lehnt unbekannte Felder und fremde Datei-IDs ab', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    expect((await c.patch(`/api/pages/${a.id}`, { settings: { evil: true } })).status).toBe(422);
    expect(
      (
        await c.patch(`/api/pages/${a.id}`, {
          icon: { type: 'file', fileId: '01900000-0000-7000-8000-000000000000' },
        })
      ).status,
    ).toBe(400);
    expect((await c.get('/api/pages/keine-uuid')).status).toBe(404);
  });
});

describe('Favoriten und Zuletzt', () => {
  it('verwaltet Favoriten mit Reihenfolge', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    const b = await create({ title: 'B', scope: 'TEAM' });
    await c.post(`/api/pages/${a.id}/favorite`);
    await c.post(`/api/pages/${b.id}/favorite`);
    await c.post(`/api/pages/${a.id}/favorite`); // doppelt ist harmlos
    expect(titles((await c.get(`/api/workspaces/${ws}/favorites`)).body)).toEqual(['A', 'B']);
    await c.post(`/api/pages/${b.id}/favorite/reorder`, { beforeId: a.id });
    expect(titles((await c.get(`/api/workspaces/${ws}/favorites`)).body)).toEqual(['B', 'A']);
    expect((await c.get(`/api/pages/${a.id}`)).body.isFavorite).toBe(true);
    await c.del(`/api/pages/${b.id}`);
    expect(titles((await c.get(`/api/workspaces/${ws}/favorites`)).body)).toEqual(['A']);
    await c.del(`/api/pages/${a.id}/favorite`);
    expect((await c.get(`/api/workspaces/${ws}/favorites`)).body).toEqual([]);
  });

  it('merkt zuletzt geöffnete Seiten', async () => {
    const a = await create({ title: 'A', scope: 'TEAM' });
    const b = await create({ title: 'B', scope: 'TEAM' });
    await c.get(`/api/pages/${a.id}`);
    await c.get(`/api/pages/${b.id}`);
    await c.get(`/api/pages/${a.id}`);
    expect(titles((await c.get(`/api/workspaces/${ws}/recent`)).body)).toEqual(['A', 'B']);
  });
});

describe('Realtime-Outbox', () => {
  it('schreibt Ereignisse transaktional und veröffentlicht sie mit Zielgruppe', async () => {
    const sub = new Redis(process.env.REDIS_URL!);
    const messages: { type: string; audienceUserId: string | null }[] = [];
    await sub.subscribe(`jotion:events:${ws}`);
    sub.on('message', (_ch, msg) => messages.push(JSON.parse(msg)));

    await create({ title: 'Team', scope: 'TEAM' });
    await create({ title: 'Privat', scope: 'PRIVATE' });
    expect(await db.changeEvent.count({ where: { publishedAt: null } })).toBe(2);

    expect(await app.get(RealtimeService).relayOnce()).toBe(2);
    await new Promise((r) => setTimeout(r, 100));
    expect(messages.map((m) => m.type)).toEqual(['page.created', 'page.created']);
    expect(messages[0]!.audienceUserId).toBeNull();
    expect(messages[1]!.audienceUserId).not.toBeNull();
    expect(await db.changeEvent.count({ where: { publishedAt: null } })).toBe(0);
    sub.disconnect();
  });
});

describe('Performance', () => {
  it('Sidebar und Kinder mit 1000 Seiten unter 100 ms', async () => {
    const root = await create({ title: 'Wurzel', scope: 'TEAM' });
    const me = (await c.get('/api/auth/me')).body.user.id;
    const { keysBetween } = await import('@jotion/shared');
    const keys = keysBetween(null, null, 1000);
    await db.page.createMany({
      data: keys.map((position, i) => ({
        workspaceId: ws,
        parentId: i < 500 ? root.id : null,
        title: `Seite ${i}`,
        position,
        scope: 'TEAM',
        ownerId: me,
        createdById: me,
        lastEditedById: me,
      })),
    });
    // Aufwärmen, dann messen
    await sidebar();
    let t = performance.now();
    const s = await sidebar();
    const sidebarMs = performance.now() - t;
    await c.get(`/api/pages/${root.id}/children`);
    t = performance.now();
    const kids = (await c.get(`/api/pages/${root.id}/children`)).body;
    const childrenMs = performance.now() - t;
    expect(s.team).toHaveLength(501);
    expect(kids).toHaveLength(500);
    expect(sidebarMs).toBeLessThan(100);
    expect(childrenMs).toBeLessThan(100);
  });
});
