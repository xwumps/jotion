import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DOC_FRAGMENT } from '@jotion/editor';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore } from '../src/collab/doc-store';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/** Phase 10: Kommentare, Erwähnungen, Antworten und Posteingang. */
let app: NestFastifyApplication;
let owner: Client;
let member: Client;
let viewer: Client;
let ws: string;
let ownerId: string;
let memberId: string;
let viewerId: string;

beforeAll(async () => {
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
  ownerId = o.userId;
  const m = await addMember(app, owner, ws, 'member@test.local');
  member = m.client;
  memberId = m.userId;
  const v = await addMember(app, owner, ws, 'viewer@test.local');
  viewer = v.client;
  viewerId = v.userId;
});

const newPage = async (body: object) =>
  (await owner.post(`/api/workspaces/${ws}/pages`, body)).body as { id: string };
const inbox = async (c: Client) => (await c.get(`/api/workspaces/${ws}/inbox`)).body;

/** Absatz mit Personen-Erwähnungen speichern wie der Collab-Server */
async function writeMentions(
  pageId: string,
  blocks: { id: string; users: string[] }[],
  actor: string,
) {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment(DOC_FRAGMENT);
  for (const b of blocks) {
    const p = new Y.XmlElement('paragraph');
    frag.push([p]);
    p.setAttribute('id', b.id);
    const t = new Y.XmlText();
    p.insert(0, [t]);
    t.insert(0, `Block ${b.id} `);
    for (const u of b.users) {
      const m = new Y.XmlElement('mention');
      p.push([m]);
      m.setAttribute('kind', 'user');
      m.setAttribute('targetId', u);
    }
  }
  await app.get(DocStore).compact(pageId, doc, actor);
}

describe('Kommentare', () => {
  it('Threads an Seite und Block, Antworten, Auflösen, Bearbeiten und Löschen', async () => {
    const page = await newPage({ title: 'Plan', scope: 'TEAM' });
    const pageThread = await member.post(`/api/pages/${page.id}/comments`, { body: 'Allgemein' });
    expect(pageThread.status).toBe(201);
    const block = (
      await owner.post(`/api/pages/${page.id}/comments`, {
        body: 'Stimmt das?',
        blockId: 'b1',
        quote: 'drei Tage',
      })
    ).body;
    const reply = await member.post(`/api/pages/${page.id}/comments`, {
      body: 'Ja',
      threadId: block.threadId,
    });
    expect(reply.body.threadId).toBe(block.id);

    let list = (await viewer.get(`/api/pages/${page.id}/comments`)).body;
    expect(list.threads).toHaveLength(2);
    const t = list.threads.find((x: { blockId: string }) => x.blockId === 'b1');
    expect(t.quote).toBe('drei Tage');
    expect(t.comments.map((c: { body: string }) => c.body)).toEqual(['Stimmt das?', 'Ja']);

    expect(
      (await member.put(`/api/comments/${block.id}/resolved`, { resolved: true })).status,
    ).toBe(204);
    list = (await owner.get(`/api/pages/${page.id}/comments`)).body;
    expect(list.threads.find((x: { id: string }) => x.id === block.id).resolvedBy.id).toBe(
      memberId,
    );

    // Nur der Autor ändert; löschen darf auch, wer volle Rechte hat
    expect((await member.patch(`/api/comments/${block.id}`, { body: 'x' })).status).toBe(403);
    expect(
      (await owner.patch(`/api/comments/${block.id}`, { body: 'Stimmt das wirklich?' })).body
        .editedAt,
    ).toBeTruthy();
    expect((await owner.del(`/api/comments/${reply.body.id}`)).status).toBe(204);
    list = (await owner.get(`/api/pages/${page.id}/comments`)).body;
    expect(list.threads.find((x: { id: string }) => x.id === block.id).comments).toHaveLength(1);
  });

  it('Stufen: ansehen liest nur, kommentieren darf schreiben, kein Zugriff sieht nichts', async () => {
    const page = await newPage({ title: 'Freigabe', scope: 'TEAM' });
    await owner.put(`/api/pages/${page.id}/permissions`, { userId: viewerId, level: 'view' });
    await owner.put(`/api/pages/${page.id}/permissions`, { userId: memberId, level: 'comment' });
    expect((await viewer.get(`/api/pages/${page.id}/comments`)).body.canComment).toBe(false);
    expect((await viewer.post(`/api/pages/${page.id}/comments`, { body: 'x' })).status).toBe(403);
    expect((await member.post(`/api/pages/${page.id}/comments`, { body: 'ok' })).status).toBe(201);
    expect((await member.patch(`/api/pages/${page.id}`, { title: 'x' })).status).toBe(403);
    await owner.put(`/api/pages/${page.id}/permissions`, { userId: viewerId, level: 'none' });
    expect((await viewer.get(`/api/pages/${page.id}/comments`)).status).toBe(404);
  });
});

describe('Benachrichtigungen', () => {
  it('Erwähnung im Kommentar und Antworten landen im Posteingang', async () => {
    const page = await newPage({ title: 'Urlaub', scope: 'TEAM' });
    const c = (
      await owner.post(`/api/pages/${page.id}/comments`, {
        body: '@member bitte prüfen',
        mentions: [memberId],
      })
    ).body;
    let box = await inbox(member);
    expect(box.unread).toBe(1);
    expect(box.items[0]).toMatchObject({
      type: 'mention_comment',
      page: { id: page.id, title: 'Urlaub' },
      actor: { id: ownerId },
      threadId: c.threadId,
      excerpt: '@member bitte prüfen',
    });
    // Antwort benachrichtigt den Autor, nicht den Antwortenden selbst
    await member.post(`/api/pages/${page.id}/comments`, { body: 'Erledigt', threadId: c.threadId });
    const ownerBox = await inbox(owner);
    expect(ownerBox.items.map((i: { type: string }) => i.type)).toEqual(['reply']);
    expect((await inbox(member)).items).toHaveLength(1);

    await member.post(`/api/workspaces/${ws}/inbox/read`, { all: true });
    box = await inbox(member);
    expect(box.unread).toBe(0);
    expect(box.items[0].readAt).toBeTruthy();
  });

  it('Erwähnung in der Seite benachrichtigt einmal, nur neue Erwähnungen zählen', async () => {
    const page = await newPage({ title: 'Protokoll', scope: 'TEAM' });
    await writeMentions(page.id, [{ id: 'a', users: [memberId, ownerId] }], ownerId);
    const box = await inbox(member);
    expect(box.items).toHaveLength(1);
    expect(box.items[0]).toMatchObject({ type: 'mention_page', blockId: 'a' });
    expect(box.items[0].excerpt).toContain('Block a');
    // Selbst-Erwähnung erzeugt nichts
    expect((await inbox(owner)).items).toEqual([]);
    // Erneutes Speichern ohne neue Erwähnung: keine weitere Benachrichtigung
    await writeMentions(
      page.id,
      [
        { id: 'a', users: [memberId] },
        { id: 'b', users: [memberId] },
      ],
      ownerId,
    );
    expect((await inbox(member)).items).toHaveLength(1);
    await writeMentions(page.id, [{ id: 'a', users: [memberId, viewerId] }], ownerId);
    expect((await inbox(viewer)).items).toHaveLength(1);
  });

  it('ohne Lesezugriff keine Benachrichtigung, entzogener Zugriff blendet sie aus', async () => {
    const page = await newPage({ title: 'Vertraulich', scope: 'TEAM' });
    await owner.put(`/api/pages/${page.id}/permissions`, { userId: viewerId, level: 'none' });
    await owner.post(`/api/pages/${page.id}/comments`, {
      body: '@viewer @member',
      mentions: [viewerId, memberId],
    });
    expect((await inbox(viewer)).items).toEqual([]);
    expect((await inbox(member)).items).toHaveLength(1);
    await owner.put(`/api/pages/${page.id}/permissions`, { userId: memberId, level: 'none' });
    expect((await inbox(member)).items).toEqual([]);
  });
});
