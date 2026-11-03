import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { DOC_FRAGMENT, pageDocName } from '@jotion/editor';
import { projectDoc, subpageIds } from '@jotion/editor/projection';
import type { PrismaClient } from '@jotion/db';
import * as encoding from 'lib0/encoding';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { DocStore } from '../src/collab/doc-store';
import {
  addMember,
  type Client,
  createTestApp,
  PUBLIC_URL,
  resetState,
  setupOwner,
} from './helpers';

let app: NestFastifyApplication;
let db: PrismaClient;
let port: number;
let owner: Client;
let ws: string;
const providers: HocuspocusProvider[] = [];
const sockets: HocuspocusProviderWebsocket[] = [];

beforeAll(async () => {
  ({ app, db, port } = await createTestApp({ listen: true }));
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  await resetState(app);
  ({ client: owner, workspaceId: ws } = await setupOwner(app));
});
afterEach(() => {
  for (const p of providers.splice(0)) p.destroy();
  for (const s of sockets.splice(0)) s.destroy();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('Zeitüberschreitung');
    await wait(25);
  }
}

/** Hocuspocus-Client wie im Browser, mit Session-Cookie und Origin. */
function connect(
  c: Client | null,
  pageId: string,
  opts: { origin?: string; retry?: boolean } = {},
) {
  const cookie = c?.cookie ?? '';
  const origin = opts.origin ?? PUBLIC_URL;
  class CookieSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie, origin } });
    }
  }
  const doc = new Y.Doc();
  const state = { synced: false, authFailed: false, closed: 0 };
  const socket = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${port}/collab`,
    WebSocketPolyfill: CookieSocket,
    maxAttempts: opts.retry ? 0 : 1,
    delay: 50,
    minDelay: 50,
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: pageDocName(pageId),
    document: doc,
    token: 'cookie',
    onSynced: () => (state.synced = true),
    onAuthenticationFailed: () => (state.authFailed = true),
    onClose: () => {
      state.closed++;
      state.synced = false;
    },
  });
  provider.attach();
  providers.push(provider);
  sockets.push(socket);
  return { doc, provider, state, socket };
}

function typeParagraph(doc: Y.Doc, text: string, id = crypto.randomUUID()) {
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    p.setAttribute('id', id);
    p.insert(0, [new Y.XmlText(text)]);
    doc.getXmlFragment(DOC_FRAGMENT).push([p]);
  });
  return id;
}

async function storedDoc(pageId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  await app.get(DocStore).loadInto(pageId, doc);
  return doc;
}

const textOf = (doc: Y.Doc) => projectDoc(doc).text;
const newPage = async (body: object = {}) =>
  (await owner.post(`/api/workspaces/${ws}/pages`, { scope: 'TEAM', title: 'Seite', ...body }))
    .body;

describe('Speichern ohne Datenverlust', () => {
  it('speichert jedes Update, bevor der Server es bestätigt', async () => {
    const page = await newPage();
    const a = connect(owner, page.id);
    await until(() => a.state.synced);
    typeParagraph(a.doc, 'Wichtiger Satz');
    // Sobald der Client "gespeichert" weiß, muss das Update in der Datenbank liegen
    await until(() => !a.provider.hasUnsyncedChanges);
    const rows = await db.pageDocUpdate.count({ where: { pageId: page.id } });
    const docRow = await db.pageDoc.findUnique({ where: { pageId: page.id } });
    expect(rows > 0 || docRow !== null).toBe(true);
    // Unabhängig vom laufenden Server aus der Datenbank wiederherstellbar
    expect(textOf(await storedDoc(page.id))).toContain('Wichtiger Satz');
  });

  it('zweiter Client sieht Änderungen live und nach Neuladen', async () => {
    const page = await newPage();
    const a = connect(owner, page.id);
    const b = connect(owner, page.id);
    await until(() => a.state.synced && b.state.synced);
    typeParagraph(a.doc, 'Von A');
    typeParagraph(b.doc, 'Von B');
    await until(() => textOf(a.doc).includes('Von B') && textOf(b.doc).includes('Von A'));
    a.provider.destroy();
    b.provider.destroy();
    await wait(100);
    const c = connect(owner, page.id);
    await until(() => c.state.synced);
    expect(textOf(c.doc)).toContain('Von A');
    expect(textOf(c.doc)).toContain('Von B');
  });

  it('kompaktiert: Zustand gespeichert, enthaltene Updates entfernt, Blöcke projiziert', async () => {
    const page = await newPage();
    const a = connect(owner, page.id);
    await until(() => a.state.synced);
    const h = new Y.XmlElement('heading');
    h.setAttribute('id', 'h-1');
    h.setAttribute('level', 2 as unknown as string);
    h.insert(0, [new Y.XmlText('Überschrift')]);
    a.doc.getXmlFragment(DOC_FRAGMENT).push([h]);
    await until(
      async () => (await db.pageDoc.findUnique({ where: { pageId: page.id } })) !== null,
      15_000,
    );
    await until(
      async () => (await db.pageDocUpdate.count({ where: { pageId: page.id } })) === 0,
      15_000,
    );
    const block = await db.block.findUnique({
      where: { pageId_id: { pageId: page.id, id: 'h-1' } },
    });
    expect(block).toMatchObject({ type: 'heading', plainText: 'Überschrift' });
    const p = await db.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(p.lastEditedAt.getTime()).toBeGreaterThan(new Date(page.lastEditedAt).getTime());
  }, 30_000);

  it('Kompaktierung löscht keine Updates, die im Dokument fehlen', async () => {
    const page = await newPage();
    const other = new Y.Doc();
    typeParagraph(other, 'Noch nicht angewendet');
    await app.get(DocStore).append(page.id, Y.encodeStateAsUpdate(other), null);
    const inMemory = new Y.Doc();
    typeParagraph(inMemory, 'Im Speicher');
    await app.get(DocStore).compact(page.id, inMemory, null);
    expect(await db.pageDocUpdate.count({ where: { pageId: page.id } })).toBe(1);
    const restored = await storedDoc(page.id);
    expect(textOf(restored)).toContain('Noch nicht angewendet');
    expect(textOf(restored)).toContain('Im Speicher');
  });

  it('überspringt beschädigte Einträge beim Laden statt die Seite unlesbar zu machen', async () => {
    const page = await newPage();
    const good = new Y.Doc();
    typeParagraph(good, 'Gesund');
    await app.get(DocStore).append(page.id, Y.encodeStateAsUpdate(good), null);
    await db.pageDocUpdate.create({
      data: { pageId: page.id, update: Buffer.from([1, 2, 3, 250, 251]) },
    });
    const doc = new Y.Doc();
    const res = await app.get(DocStore).loadInto(page.id, doc);
    expect(res.skipped).toBe(1);
    expect(textOf(doc)).toContain('Gesund');
  });

  it('beschädigte Nachrichten werden weder gespeichert noch angewendet', async () => {
    const page = await newPage();
    const a = connect(owner, page.id);
    await until(() => a.state.synced);
    const before = await db.pageDocUpdate.count({ where: { pageId: page.id } });
    const enc = encoding.createEncoder();
    encoding.writeVarString(enc, pageDocName(page.id));
    encoding.writeVarUint(enc, 0); // Sync
    encoding.writeVarUint(enc, 2); // Update
    encoding.writeVarUint8Array(enc, new Uint8Array([9, 9, 9, 9, 9, 9]));
    a.socket.send(encoding.toUint8Array(enc));
    await wait(300);
    expect(await db.pageDocUpdate.count({ where: { pageId: page.id } })).toBe(before);
  });
});

describe('Rechte im Live-Editor', () => {
  it('ohne Session keine Verbindung', async () => {
    const page = await newPage();
    const anon = connect(null, page.id);
    await until(() => anon.state.authFailed || anon.state.closed > 0);
    expect(anon.state.synced).toBe(false);
  });

  it('private Seiten sind für andere Mitglieder gesperrt', async () => {
    const { client: member } = await addMember(app, owner, ws, 'm@test.local');
    const priv = await newPage({ scope: 'PRIVATE' });
    const m = connect(member, priv.id);
    await until(() => m.state.authFailed || m.state.closed > 0);
    expect(m.state.synced).toBe(false);
  });

  it('fremde Origins werden beim Handshake abgewiesen', async () => {
    const handshake = (origin: string) =>
      new Promise<number>((resolve) => {
        const sock = new WebSocket(`ws://127.0.0.1:${port}/collab`, {
          headers: { cookie: owner.cookie!, origin },
        });
        sock.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        sock.on('open', () => {
          sock.close();
          resolve(101);
        });
        sock.on('error', () => undefined);
      });
    expect(await handshake('https://boese.example')).toBe(403);
    expect(await handshake(PUBLIC_URL)).toBe(101);
  });

  it('Seiten im Papierkorb sind schreibgeschützt; Änderungen werden nicht gespeichert', async () => {
    const page = await newPage();
    await owner.del(`/api/pages/${page.id}`);
    const a = connect(owner, page.id);
    await until(() => a.state.synced);
    typeParagraph(a.doc, 'Darf nicht gespeichert werden');
    await wait(400);
    expect(await db.pageDocUpdate.count({ where: { pageId: page.id } })).toBe(0);
    expect(textOf(await storedDoc(page.id))).not.toContain('Darf nicht');
  });

  it('Sperren trennt offene Editoren und verbindet sie schreibgeschützt neu', async () => {
    const page = await newPage();
    const a = connect(owner, page.id, { retry: true });
    await until(() => a.state.synced);
    typeParagraph(a.doc, 'Vor der Sperre');
    await until(() => !a.provider.hasUnsyncedChanges);
    const closedBefore = a.state.closed;
    await owner.patch(`/api/pages/${page.id}`, { settings: { locked: true } });
    await until(() => a.state.closed > closedBefore);
    // Automatisch neu verbunden, jetzt schreibgeschützt
    await until(() => a.state.synced);
    expect(a.provider.authorizedScope).toBe('readonly');
    const rows = await db.pageDocUpdate.count({ where: { pageId: page.id } });
    typeParagraph(a.doc, 'Nach der Sperre');
    await wait(300);
    expect(await db.pageDocUpdate.count({ where: { pageId: page.id } })).toBe(rows);
    expect(textOf(await storedDoc(page.id))).toContain('Vor der Sperre');
  });
});

describe('Unterseiten-Blöcke', () => {
  it('erscheinen in der Elternseite und folgen Verschieben, Papierkorb und Wiederherstellen', async () => {
    const parent = await newPage({ title: 'Eltern' });
    const other = await newPage({ title: 'Andere' });
    const child = await newPage({ parentId: parent.id, title: 'Kind' });
    expect(subpageIds(await storedDoc(parent.id))).toEqual([child.id]);
    expect(
      (await db.blockReference.findMany({ where: { pageId: parent.id } })).map((r) => r.targetId),
    ).toEqual([child.id]);

    await owner.post(`/api/pages/${child.id}/move`, { parentId: other.id });
    expect(subpageIds(await storedDoc(parent.id))).toEqual([]);
    expect(subpageIds(await storedDoc(other.id))).toEqual([child.id]);

    await owner.del(`/api/pages/${child.id}`);
    expect(subpageIds(await storedDoc(other.id))).toEqual([]);
    await owner.post(`/api/pages/${child.id}/restore`);
    expect(subpageIds(await storedDoc(other.id))).toEqual([child.id]);
  });

  it('insertBlock=false überlässt das Einfügen dem Editor', async () => {
    const parent = await newPage();
    await newPage({ parentId: parent.id, insertBlock: false });
    expect(subpageIds(await storedDoc(parent.id))).toEqual([]);
  });

  it('landen auch in einem gerade geöffneten Dokument ohne Konflikt', async () => {
    const parent = await newPage();
    const a = connect(owner, parent.id);
    await until(() => a.state.synced);
    typeParagraph(a.doc, 'Text vom Nutzer');
    const child = await newPage({ parentId: parent.id });
    await until(() => subpageIds(a.doc).includes(child.id));
    expect(textOf(a.doc)).toContain('Text vom Nutzer');
  });
});

describe('Schnellsuche', () => {
  it('findet Titel, ohne private Seiten anderer zu zeigen', async () => {
    const { client: member } = await addMember(app, owner, ws, 'm@test.local');
    await newPage({ title: 'Projektplanung 2027' });
    await newPage({ title: 'Geheime Projektidee', scope: 'PRIVATE' });
    const child = await newPage({ title: 'Unterprojekt' });
    await newPage({ title: 'Projekt Kind', parentId: child.id });
    const res = (await member.get(`/api/workspaces/${ws}/search?q=projekt`)).body as {
      title: string;
      path: string;
    }[];
    expect(res.map((r) => r.title)).toEqual(
      expect.arrayContaining(['Projektplanung 2027', 'Unterprojekt', 'Projekt Kind']),
    );
    expect(res.map((r) => r.title)).not.toContain('Geheime Projektidee');
    expect(res.find((r) => r.title === 'Projekt Kind')?.path).toBe('Unterprojekt');
    expect((await owner.get(`/api/workspaces/${ws}/search?q=geheim`)).body).toHaveLength(1);
    expect((await owner.get(`/api/workspaces/${ws}/search?q=%25`)).body).toHaveLength(0);
  });
});
