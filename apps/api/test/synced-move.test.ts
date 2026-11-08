import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/** Phase 10: Synced Blocks und Verschieben in einen anderen Workspace. */
let app: NestFastifyApplication;
let db: PrismaClient;
let owner: Client;
let member: Client;
let ws: string;
let ws2: string;
let memberId: string;

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
  const m = await addMember(app, owner, ws, 'member@test.local');
  member = m.client;
  memberId = m.userId;
  ws2 = (await owner.post('/api/workspaces', { name: 'Zweiter' })).body.id;
});

const create = (body: object, w = ws) => owner.post(`/api/workspaces/${w}/pages`, body);

describe('Synced Blocks', () => {
  it('Inhaltsseite unter der Ursprungsseite, unsichtbar in Baum und Suche, Rechte vererbt', async () => {
    const origin = (await create({ title: 'Ursprung', scope: 'TEAM' })).body;
    const res = await owner.post(`/api/pages/${origin.id}/synced-blocks`);
    expect(res.status).toBe(201);
    const synced = res.body;
    expect(synced).toMatchObject({ originId: origin.id, originTitle: 'Ursprung', canEdit: true });
    const page = await db.page.findUniqueOrThrow({ where: { id: synced.pageId } });
    expect(page).toMatchObject({ kind: 'SYNCED_BLOCK', parentId: origin.id, scope: 'TEAM' });

    expect((await owner.get(`/api/pages/${origin.id}/children`)).body).toEqual([]);
    expect(
      (await owner.get(`/api/workspaces/${ws}/search?q=`)).body.map((p: { id: string }) => p.id),
    ).not.toContain(synced.pageId);
    // Keine Unterseiten im Synced Block, nicht verschiebbar
    expect((await create({ parentId: synced.pageId, title: 'x' })).status).toBe(400);
    expect(
      (await owner.post(`/api/pages/${synced.pageId}/move`, { parentId: null, scope: 'TEAM' }))
        .status,
    ).toBe(400);

    // Rechte folgen der Ursprungsseite
    await owner.put(`/api/pages/${origin.id}/permissions`, { userId: memberId, level: 'view' });
    expect((await member.get(`/api/pages/${synced.pageId}/synced`)).body.canEdit).toBe(false);
    await owner.put(`/api/pages/${origin.id}/permissions`, { userId: memberId, level: 'none' });
    expect((await member.get(`/api/pages/${synced.pageId}/synced`)).status).toBe(404);
    // Ursprung in den Papierkorb: Synced Block mit
    await owner.del(`/api/pages/${origin.id}`);
    expect((await owner.get(`/api/pages/${synced.pageId}/synced`)).status).toBe(404);
  });

  it('nur mit Bearbeitungsrecht anlegen', async () => {
    const origin = (await create({ title: 'Nur lesen', scope: 'TEAM' })).body;
    await owner.put(`/api/pages/${origin.id}/permissions`, { userId: memberId, level: 'comment' });
    expect((await member.post(`/api/pages/${origin.id}/synced-blocks`)).status).toBe(403);
  });
});

describe('In anderen Workspace verschieben', () => {
  it('nimmt Unterseiten, Datenbanken, Zeilen, Kommentare und Versionen mit', async () => {
    const root = (await create({ title: 'Umzug', scope: 'TEAM' })).body;
    const child = (await create({ title: 'Kind', parentId: root.id })).body;
    const dbPage = (
      await owner.post(`/api/workspaces/${ws}/databases`, { title: 'Liste', parentId: root.id })
    ).body;
    const row = (await owner.post(`/api/databases/${dbPage.id}/rows`, { title: 'Eintrag' })).body;
    await owner.post(`/api/pages/${child.id}/comments`, { body: 'Hallo' });
    await owner.put(`/api/pages/${root.id}/permissions`, { userId: memberId, level: 'view' });
    await owner.post(`/api/pages/${root.id}/favorite`);

    // Mitglied ohne volle Rechte und ohne Mitgliedschaft im Ziel: verboten
    expect(
      (await member.post(`/api/pages/${root.id}/move-workspace`, { workspaceId: ws2 })).status,
    ).toBe(403);

    const res = await owner.post(`/api/pages/${root.id}/move-workspace`, {
      workspaceId: ws2,
      scope: 'TEAM',
    });
    expect(res.status).toBe(201);
    expect(res.body.workspaceId).toBe(ws2);
    expect(res.body.parentId ?? null).toBeNull();

    const moved = await db.page.findMany({
      where: { id: { in: [root.id, child.id, dbPage.id, row.id] } },
    });
    expect(new Set(moved.map((p) => p.workspaceId))).toEqual(new Set([ws2]));
    expect((await db.database.findUniqueOrThrow({ where: { id: dbPage.id } })).workspaceId).toBe(
      ws2,
    );
    expect((await db.comment.findFirstOrThrow({ where: { pageId: child.id } })).workspaceId).toBe(
      ws2,
    );
    // Angabe für ein Mitglied, das im Ziel fehlt, entfällt
    expect(await db.pagePermission.count({ where: { pageId: root.id } })).toBe(0);

    // Altes Workspace zeigt nichts mehr, Mitglied sieht nichts
    const old = (await owner.get(`/api/workspaces/${ws}/sidebar`)).body;
    expect(old.team.map((n: { id: string }) => n.id)).not.toContain(root.id);
    expect((await member.get(`/api/pages/${root.id}`)).status).toBe(404);
    const now = (await owner.get(`/api/workspaces/${ws2}/sidebar`)).body;
    expect(now.team.map((n: { id: string }) => n.id)).toContain(root.id);
    expect((await owner.post(`/api/databases/${dbPage.id}/query`, {})).body.rows).toHaveLength(1);
  });

  it('verhindert das Verschieben bei Relationen über die Grenze', async () => {
    const root = (await create({ title: 'Mit Relation', scope: 'TEAM' })).body;
    const inner = (
      await owner.post(`/api/workspaces/${ws}/databases`, { title: 'Innen', parentId: root.id })
    ).body;
    const outer = (
      await owner.post(`/api/workspaces/${ws}/databases`, { title: 'Außen', scope: 'TEAM' })
    ).body;
    await owner.post(`/api/databases/${inner.id}/properties`, {
      name: 'Link',
      type: 'relation',
      config: { targetDatabaseId: outer.id },
    });
    const res = await owner.post(`/api/pages/${root.id}/move-workspace`, { workspaceId: ws2 });
    expect(res.status).toBe(422);
    expect(res.body.message ?? JSON.stringify(res.body)).toContain('Relationen');
    expect((await db.page.findUniqueOrThrow({ where: { id: root.id } })).workspaceId).toBe(ws);
  });
});
