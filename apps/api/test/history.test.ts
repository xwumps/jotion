import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { DOC_FRAGMENT } from '@jotion/editor';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore } from '../src/collab/doc-store';
import { diffBlocks } from '../src/history/history.service';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/** Phase 10: Seitenhistorie (Versionen, Vergleich, Wiederherstellen). */
let app: NestFastifyApplication;
let db: PrismaClient;
let owner: Client;
let member: Client;
let ws: string;
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
});

/** Speichert Absätze wie der Collab-Server: Update anhängen, dann kompaktieren */
async function save(pageId: string, paras: [string, string][], userId: string | null = null) {
  const store = app.get(DocStore);
  const doc = await store.loadDoc(pageId);
  const before = Y.encodeStateVector(doc);
  doc.transact(() => {
    const frag = doc.getXmlFragment(DOC_FRAGMENT);
    if (frag.length) frag.delete(0, frag.length);
    for (const [id, text] of paras) {
      const p = new Y.XmlElement('paragraph');
      frag.push([p]);
      p.setAttribute('id', id);
      const t = new Y.XmlText();
      p.insert(0, [t]);
      t.insert(0, text);
    }
  });
  await store.append(pageId, Y.encodeStateAsUpdate(doc, before), userId);
  await store.compact(pageId, doc, userId);
  doc.destroy();
}

/** Letzte Version künstlich altern lassen, damit die nächste Speicherung eine neue anlegt */
const age = (pageId: string) =>
  db.$executeRaw`UPDATE page_snapshots SET created_at = created_at - interval '11 minutes' WHERE page_id = ${pageId}::uuid`;

const texts = async (c: Client, pageId: string) => {
  const doc = (await c.get(`/api/pages/${pageId}/content`)).body.doc;
  return (doc.content ?? []).map((n: { content?: { text: string }[] }) =>
    (n.content ?? []).map((x) => x.text).join(''),
  );
};

describe('Seitenhistorie', () => {
  it('legt höchstens eine Version je Intervall an, vergleicht und stellt wieder her', async () => {
    const page = (await owner.post(`/api/workspaces/${ws}/pages`, { title: 'Plan', scope: 'TEAM' }))
      .body;
    await save(page.id, [
      ['a', 'Eins'],
      ['b', 'Zwei'],
    ]);
    await save(page.id, [
      ['a', 'Eins'],
      ['b', 'Zwei!'],
    ]);
    expect((await owner.get(`/api/pages/${page.id}/history`)).body).toHaveLength(1);
    await age(page.id);
    await save(page.id, [
      ['a', 'Eins'],
      ['b', 'Zwei?'],
      ['c', 'Drei'],
    ]);
    const list = (await owner.get(`/api/pages/${page.id}/history`)).body;
    expect(list).toHaveLength(2);
    const [latest, first] = list;

    const detail = (await owner.get(`/api/pages/${page.id}/history/${latest.id}`)).body;
    expect(detail.diff.map((d: { id: string; status: string }) => [d.id, d.status])).toEqual([
      ['a', 'same'],
      ['b', 'changed'],
      ['c', 'added'],
    ]);
    expect(detail.diff[1].before).toBe('Zwei');

    // Mitglied mit "ansehen" liest die Historie, darf aber nicht wiederherstellen
    await owner.put(`/api/pages/${page.id}/permissions`, { userId: memberId, level: 'view' });
    expect((await member.get(`/api/pages/${page.id}/history`)).status).toBe(200);
    expect((await member.post(`/api/pages/${page.id}/history/${first.id}/restore`)).status).toBe(
      403,
    );

    const res = await owner.post(`/api/pages/${page.id}/history/${first.id}/restore`);
    expect(res.status).toBe(201);
    expect(res.body.reason).toBe('restore');
    expect(await texts(owner, page.id)).toEqual(['Eins', 'Zwei']);
    // Stand vor der Wiederherstellung bleibt als Version erhalten
    const after = (await owner.get(`/api/pages/${page.id}/history`)).body;
    expect(after[0].reason).toBe('restore');
    const backup = (await owner.get(`/api/pages/${page.id}/history/${after[0].id}`)).body;
    expect(JSON.stringify(backup.doc)).toContain('Drei');
  });

  it('Vergleich setzt entfernte Blöcke hinter ihren Vorgänger', () => {
    const b = (id: string, text: string) => ({
      id,
      parentId: null,
      type: 'paragraph',
      position: 0,
      text,
      props: {},
    });
    const diff = diffBlocks([b('a', '1'), b('x', 'weg'), b('c', '3')], [b('a', '1'), b('c', '3')]);
    expect(diff.map((d) => `${d.id}:${d.status}`)).toEqual(['a:same', 'x:removed', 'c:same']);
  });

  it('Versionen anderer Seiten und ohne Zugriff bleiben verborgen', async () => {
    const page = (await owner.post(`/api/workspaces/${ws}/pages`, { title: 'P', scope: 'PRIVATE' }))
      .body;
    await save(page.id, [['a', 'Geheim']]);
    const [v] = (await owner.get(`/api/pages/${page.id}/history`)).body;
    expect((await member.get(`/api/pages/${page.id}/history`)).status).toBe(404);
    expect((await member.get(`/api/pages/${page.id}/history/${v.id}`)).status).toBe(404);
    const other = (await owner.post(`/api/workspaces/${ws}/pages`, { title: 'Q', scope: 'TEAM' }))
      .body;
    expect((await owner.get(`/api/pages/${other.id}/history/${v.id}`)).status).toBe(404);
  });
});
