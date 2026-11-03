import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DOC_FRAGMENT } from '@jotion/editor';
import { projectDoc, subpageIds } from '@jotion/editor/projection';
import type { PrismaClient } from '@jotion/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore } from '../src/collab/doc-store';
import { isBlockedAddress, SafeHttpClient, SsrfError } from '../src/common/safe-http';
import { parseOpenGraph } from '../src/content/og-parser';
import { makeSnippet } from '../src/content/search.service';
import { parseRange } from '../src/files/files.controller';
import { sniff } from '../src/files/sniff';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

let app: NestFastifyApplication;
let db: PrismaClient;
let owner: Client;
let ownerId: string;
let ws: string;
let member: Client;
let memberId: string;
let site: Server;
let sitePort: number;

const SITE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>Fallback-Titel</title>
<meta property="og:title" content="Jotion &amp; Freunde">
<meta property="og:description" content="Eine Beschreibung mit &quot;Zitat&quot;">
<meta property="og:image" content="/bild.png">
<meta property="og:site_name" content="Beispiel">
<link rel="icon" href="/fav.ico">
</head><body>Inhalt</body></html>`;

beforeAll(async () => {
  // Lokale Testseite. 127.0.0.1 ist privat, daher nur über die Allowlist erreichbar.
  site = createServer((req, res) => {
    if (req.url === '/redirect-private') {
      res.writeHead(302, { location: 'http://10.0.0.1/' });
      return res.end();
    }
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write(`<html><head><title>Groß</title></head>`);
      const chunk = 'x'.repeat(64 * 1024);
      let n = 0;
      const iv = setInterval(() => {
        if (n++ > 200 || res.destroyed) {
          clearInterval(iv);
          res.end();
        } else res.write(chunk);
      }, 1);
      return;
    }
    if (req.url === '/slow') {
      setTimeout(() => res.end('<title>spät</title>'), 10_000);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SITE_HTML);
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  sitePort = (site.address() as AddressInfo).port;
  process.env.JOTION_SSRF_ALLOWLIST = '127.0.0.1';
  process.env.JOTION_MAX_UPLOAD_MB = '1';
  ({ app, db } = await createTestApp());
});
afterAll(async () => {
  delete process.env.JOTION_SSRF_ALLOWLIST;
  delete process.env.JOTION_MAX_UPLOAD_MB;
  await app?.close();
  site?.closeAllConnections();
  await new Promise((r) => site?.close(r));
});
beforeEach(async () => {
  await resetState(app);
  ({ client: owner, workspaceId: ws, userId: ownerId } = await setupOwner(app));
  ({ client: member, userId: memberId } = await addMember(
    app,
    owner,
    ws,
    'mia@test.local',
  ));
});

async function newPage(c: Client, body: Record<string, unknown>) {
  const res = await c.post(`/api/workspaces/${ws}/pages`, body);
  expect(res.status).toBe(201);
  return res.body as { id: string; title: string };
}

type B = { type: string; id: string; text?: string; attrs?: Record<string, string | number> };

/** Speichert Inhalt wie der Collab-Server (Zustand + Projektion). */
async function writeContent(pageId: string, blocks: B[], extra?: (doc: Y.Doc) => void) {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment(DOC_FRAGMENT);
  for (const b of blocks) {
    const el = new Y.XmlElement(b.type);
    frag.push([el]);
    el.setAttribute('id', b.id);
    for (const [k, v] of Object.entries(b.attrs ?? {})) el.setAttribute(k, v as string);
    if (b.text) {
      const t = new Y.XmlText();
      el.insert(0, [t]);
      t.insert(0, b.text);
    }
  }
  extra?.(doc);
  await app.get(DocStore).compact(pageId, doc, null);
}

function multipart(data: Buffer, filename: string, contentType: string) {
  const boundary = '----jotiontest';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(c: Client, data: Buffer, filename: string, type: string, workspace = ws) {
  const { body, headers } = multipart(data, filename, type);
  const res = await app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspace}/uploads`,
    payload: body,
    headers: { ...headers, cookie: c.cookie! },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

const fetchFile = (c: Client, url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { cookie: c.cookie!, ...headers } });

const search = (c: Client, params: Record<string, string>) =>
  c.get(`/api/workspaces/${ws}/search/content?${new URLSearchParams(params).toString()}`);

// ---------------------------------------------------------------------------------------

describe('Allgemeine Uploads', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

  it('erkennt den Typ am Inhalt, nicht am angegebenen Content-Type', async () => {
    const res = await upload(owner, pdf, 'handbuch.pdf', 'image/png');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'pdf', mime: 'application/pdf', name: 'handbuch.pdf' });
    const dl = await fetchFile(owner, res.body.url);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(String(dl.headers['content-disposition'])).toMatch(/^attachment; filename="handbuch.pdf"/);
    // Inline nur auf ausdrücklichen Wunsch und nur für echte PDFs
    const inline = await fetchFile(owner, `${res.body.url}?inline=1`);
    expect(String(inline.headers['content-disposition'])).toMatch(/^inline/);
  });

  it('liefert HTML und SVG nie inline und nie mit eigenem Typ aus', async () => {
    for (const [data, name, type] of [
      ['<html><script>alert(1)</script></html>', 'x.png', 'image/png'],
      ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'x.svg', 'image/svg+xml'],
      ['<?xml version="1.0"?><svg/>', 'x.svg', 'image/svg+xml'],
    ] as const) {
      const res = await upload(owner, Buffer.from(data), name, type);
      expect(res.status).toBe(201);
      expect(res.body.kind).toBe('file');
      const dl = await fetchFile(owner, `${res.body.url}?inline=1`);
      expect(dl.headers['content-type']).toBe('application/octet-stream');
      expect(String(dl.headers['content-disposition'])).toMatch(/^attachment/);
      expect(String(dl.headers['content-security-policy'])).toContain('sandbox');
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('unterstützt Byte-Bereiche (Video spulen)', async () => {
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.alloc(200, 7),
    ]);
    const res = await upload(owner, mp4, 'film.mp4', 'application/octet-stream');
    expect(res.body).toMatchObject({ kind: 'video', mime: 'video/mp4' });
    const part = await fetchFile(owner, res.body.url, { range: 'bytes=4-11' });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 4-11/${mp4.length}`);
    expect(part.body).toBe('ftypisom');
    const bad = await fetchFile(owner, res.body.url, { range: 'bytes=9999-' });
    expect(bad.statusCode).toBe(416);
  });

  it('lehnt zu große und leere Dateien ab', async () => {
    const big = await upload(owner, Buffer.alloc(1024 * 1024 + 10, 1), 'gross.bin', 'x/y');
    expect(big.status).toBe(413);
    const empty = await upload(owner, Buffer.alloc(0), 'leer.txt', 'text/plain');
    expect(empty.status).toBe(400);
  });

  it('Fremde erhalten 404, auch beim Hochladen', async () => {
    const other = await setupForeignWorkspace();
    const res = await upload(owner, pdf, 'a.pdf', 'application/pdf');
    expect((await fetchFile(other, res.body.url)).statusCode).toBe(404);
    expect((await upload(other, pdf, 'a.pdf', 'application/pdf')).status).toBe(404);
  });

  it('Bilder laufen weiter über die Neukodierung', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({
      create: { width: 8, height: 4, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    const res = await upload(owner, png, 'rot.png', 'application/octet-stream');
    expect(res.body).toMatchObject({ kind: 'image', mime: 'image/png', width: 8, height: 4 });
    const dl = await fetchFile(owner, res.body.url);
    expect(String(dl.headers['content-disposition'])).toMatch(/^inline/);
  });
});

/** Nutzer in einem fremden Workspace (eigene Instanz über Einladung in neuen Workspace). */
async function setupForeignWorkspace(): Promise<Client> {
  const { client } = await addMember(app, owner, ws, 'fremd@test.local');
  const created = await client.post('/api/workspaces', { name: 'Fremd' });
  expect(created.status).toBe(201);
  // aus dem ursprünglichen Workspace entfernen
  const me = await client.get('/api/auth/me');
  await owner.del(`/api/workspaces/${ws}/members/${me.body.user.id}`);
  return client;
}

describe('Typerkennung und Bereiche', () => {
  it('sniff', () => {
    expect(sniff(Buffer.from('ID3\x03\x00')).kind).toBe('audio');
    expect(sniff(Buffer.from('OggS\x00')).mime).toBe('audio/ogg');
    expect(sniff(Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt ')).mime).toBe('audio/wav');
    expect(sniff(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from('....webm')])).mime).toBe(
      'video/webm',
    );
    expect(sniff(Buffer.from('PK\x03\x04xxxx'), 'a.docx').ext).toBe('docx');
    expect(sniff(Buffer.from('Hallo Welt'), 'notiz.txt').mime).toBe('text/plain');
    expect(sniff(Buffer.from('  <!DOCTYPE html><p>x')).mime).toBe('application/octet-stream');
    expect(sniff(Buffer.from([0, 1, 2, 3, 250])).mime).toBe('application/octet-stream');
  });

  it('parseRange', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=0-1000', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-9', 100)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------

describe('SSRF-Schutz', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
  ])('blockt %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111'])('erlaubt %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );

  it('lehnt private Ziele, fremde Protokolle, Ports und Zugangsdaten ab', async () => {
    const client = new SafeHttpClient();
    for (const url of [
      `http://127.0.0.1:${sitePort}/`,
      'http://localhost/',
      'http://[::1]/',
      'http://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
      'gopher://example.com/',
      'http://example.com:22/',
      'http://user:pw@example.com/',
    ]) {
      await expect(client.get(url), url).rejects.toBeInstanceOf(SsrfError);
    }
  });

  it('prüft jede Weiterleitung', async () => {
    const client = new SafeHttpClient({ allowlist: ['127.0.0.1'] });
    await expect(client.get(`http://127.0.0.1:${sitePort}/redirect-private`)).rejects.toThrow(
      /nicht erlaubt/,
    );
  });

  it('begrenzt Größe und Zeit', async () => {
    const client = new SafeHttpClient({ allowlist: ['127.0.0.1'], maxBytes: 100_000, timeoutMs: 500 });
    const big = await client.get(`http://127.0.0.1:${sitePort}/big`);
    expect(big.truncated).toBe(true);
    expect(big.body.length).toBe(100_000);
    const started = Date.now();
    await expect(client.get(`http://127.0.0.1:${sitePort}/slow`)).rejects.toThrow(/Zeit/);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('Link-Vorschau', () => {
  it('liest OpenGraph-Daten (über die Allowlist) und speichert sie zwischen', async () => {
    const url = `http://127.0.0.1:${sitePort}/artikel`;
    const res = await owner.get(`/api/workspaces/${ws}/link-preview?url=${encodeURIComponent(url)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      url,
      title: 'Jotion & Freunde',
      description: 'Eine Beschreibung mit "Zitat"',
      image: `http://127.0.0.1:${sitePort}/bild.png`,
      siteName: 'Beispiel',
      favicon: `http://127.0.0.1:${sitePort}/fav.ico`,
    });
  });

  it('meldet blockierte Ziele als Fehler, nur für Mitglieder', async () => {
    const res = await owner.get(
      `/api/workspaces/${ws}/link-preview?url=${encodeURIComponent('http://10.0.0.5/')}`,
    );
    expect(res.status).toBe(400);
    const other = await setupForeignWorkspace();
    const denied = await other.get(
      `/api/workspaces/${ws}/link-preview?url=${encodeURIComponent('https://example.com')}`,
    );
    expect(denied.status).toBe(404);
  });

  it('parseOpenGraph verwirft unsichere Bildadressen', () => {
    const r = parseOpenGraph(
      '<head><meta property="og:image" content="javascript:alert(1)"><title>T</title></head>',
      'https://example.com/a',
    );
    expect(r.image).toBeNull();
    expect(r.title).toBe('T');
    expect(r.siteName).toBe('example.com');
  });
});

// ---------------------------------------------------------------------------------------

describe('Volltextsuche', () => {
  it('findet Inhalte mit Ausschnitt, Rangfolge und Akzent-Toleranz', async () => {
    const a = await newPage(owner, { scope: 'TEAM', title: 'Rezepte' });
    const b = await newPage(owner, { scope: 'TEAM', title: 'Kuchen backen' });
    await writeContent(a.id, [
      { type: 'paragraph', id: 'p1', text: 'Ein Rezept für Apfelkuchen mit Zimt und Sahne.' },
      { type: 'paragraph', id: 'p2', text: 'Anderes Thema' },
    ]);
    await writeContent(b.id, [{ type: 'paragraph', id: 'x', text: 'Schokolade' }]);

    const res = await search(owner, { q: 'zimt' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: a.id, blockId: 'p1' });
    expect(res.body[0].snippet).toContain('Zimt');
    const [s, e] = res.body[0].highlights[0];
    expect(res.body[0].snippet.slice(s, e)).toBe('Zimt');

    // Teilwort über Trigramme, Titeltreffer zählen stärker
    expect((await search(owner, { q: 'kuchen' })).body.map((r: { id: string }) => r.id)).toEqual([
      b.id,
      a.id,
    ]);
    // Akzente und Umlaute
    expect((await search(owner, { q: 'fur' })).body[0]?.id).toBe(a.id);
    // Nur Titel
    expect((await search(owner, { q: 'zimt', titleOnly: 'true' })).body).toEqual([]);
  });

  it('zeigt nie private Seiten anderer, nie Papierkorb, und beachtet Filter', async () => {
    const mine = await newPage(owner, { scope: 'PRIVATE', title: 'Geheim' });
    await writeContent(mine.id, [{ type: 'paragraph', id: 'g', text: 'Tresorcode Banane' }]);
    const team = await newPage(owner, { scope: 'TEAM', title: 'Team' });
    await writeContent(team.id, [{ type: 'paragraph', id: 't', text: 'Banane fürs Team' }]);
    const child = await newPage(owner, { parentId: team.id, title: 'Unterseite' });
    await writeContent(child.id, [{ type: 'paragraph', id: 'c', text: 'Banane unten' }]);
    const trashed = await newPage(owner, { scope: 'TEAM', title: 'Weg' });
    await writeContent(trashed.id, [{ type: 'paragraph', id: 'w', text: 'Banane weg' }]);
    await owner.del(`/api/pages/${trashed.id}`);

    const ids = async (c: Client, extra: Record<string, string> = {}) =>
      ((await search(c, { q: 'banane', ...extra })).body as { id: string }[])
        .map((r) => r.id)
        .sort();

    expect(await ids(owner)).toEqual([mine.id, team.id, child.id].sort());
    expect(await ids(member)).toEqual([team.id, child.id].sort());
    // Titel privater Seiten ebenfalls nicht
    expect((await search(member, { q: 'geheim' })).body).toEqual([]);
    expect(await ids(owner, { scope: 'private' })).toEqual([mine.id]);
    expect(await ids(owner, { scope: 'team' })).toEqual([team.id, child.id].sort());
    expect(await ids(owner, { parentId: team.id })).toEqual([team.id, child.id].sort());
    expect(await ids(member, { createdBy: memberId })).toEqual([]);
    expect(await ids(owner, { editedAfter: '2999-01-01' })).toEqual([]);
    // Unterbaum einer fremden privaten Seite liefert nichts
    expect(await ids(member, { parentId: mine.id })).toEqual([]);
    // Ungültige Filter
    expect((await search(owner, { q: 'x', editedAfter: 'gestern' })).status).toBe(422);
  });

  it('fremde Workspaces: 404', async () => {
    const other = await setupForeignWorkspace();
    expect((await search(other, { q: 'x' })).status).toBe(404);
  });

  it('makeSnippet hebt ohne Akzente hervor', () => {
    const { snippet, highlights } = makeSnippet('Über Äpfel und Birnen', ['apfel']);
    expect(snippet.slice(highlights[0]![0], highlights[0]![1])).toBe('Äpfel'.slice(0, 5));
  });
});

describe('Erwähnungen', () => {
  it('schlägt Mitglieder und nur sichtbare Seiten vor', async () => {
    const priv = await newPage(owner, { scope: 'PRIVATE', title: 'Planung privat' });
    const team = await newPage(owner, { scope: 'TEAM', title: 'Planung Team' });
    const res = await member.get(`/api/workspaces/${ws}/mention-candidates?q=plan`);
    expect(res.status).toBe(200);
    expect(res.body.pages.map((p: { id: string }) => p.id)).toEqual([team.id]);
    expect(JSON.stringify(res.body)).not.toContain(priv.id);
    const people = await member.get(`/api/workspaces/${ws}/mention-candidates?q=olivia`);
    expect(people.body.users).toEqual([{ id: ownerId, name: 'Olivia Owner' }]);
    // Ohne Suchbegriff: eigene Person zuerst
    const all = await member.get(`/api/workspaces/${ws}/mention-candidates`);
    expect(all.body.users[0].id).toBe(memberId);
  });

  it('Verweise auf private Seiten anderer verraten keinen Titel', async () => {
    const priv = await newPage(owner, { scope: 'PRIVATE', title: 'Streng geheim' });
    const team = await newPage(owner, { scope: 'TEAM', title: 'Öffentlich' });
    await writeContent(team.id, [{ type: 'paragraph', id: 'p', text: 'Siehe ' }], (doc) => {
      const p = doc.getXmlFragment(DOC_FRAGMENT).get(0) as Y.XmlElement;
      const m = new Y.XmlElement('mention');
      p.push([m]);
      m.setAttribute('kind', 'page');
      m.setAttribute('targetId', priv.id);
    });
    const refs = await db.blockReference.findMany({ where: { pageId: team.id } });
    expect(refs).toEqual([
      expect.objectContaining({ blockId: 'p', targetType: 'page', targetId: priv.id }),
    ]);
    const content = await member.get(`/api/pages/${team.id}/content`);
    expect(JSON.stringify(content.body)).not.toContain('Streng geheim');
    expect((await member.get(`/api/pages/${priv.id}/summary`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------

describe('Seite duplizieren', () => {
  it('kopiert Unterseiten und Inhalt, Unterseiten-Blöcke zeigen auf die Kopien', async () => {
    const root = await newPage(owner, { scope: 'TEAM', title: 'Projekt' });
    const child = await newPage(owner, { parentId: root.id, title: 'Aufgaben' });
    const grandchild = await newPage(owner, { parentId: child.id, title: 'Details' });
    await writeContent(child.id, [
      { type: 'paragraph', id: 'cp', text: 'Inhalt der Unterseite' },
      { type: 'subpage', id: 'sb', attrs: { pageId: grandchild.id } },
    ]);
    await writeContent(root.id, [
      { type: 'heading', id: 'h', text: 'Übersicht', attrs: { level: 1 } },
      { type: 'subpage', id: 's', attrs: { pageId: child.id } },
    ]);

    const res = await member.post(`/api/pages/${root.id}/duplicate`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Projekt (Kopie)', pages: 3 });
    const copyId = res.body.id as string;

    const copyChildren = (await member.get(`/api/pages/${copyId}/children`)).body;
    expect(copyChildren.map((c: { title: string }) => c.title)).toEqual(['Aufgaben']);
    const copyChild = copyChildren[0].id as string;
    expect(copyChild).not.toBe(child.id);
    const copyGrand = (await member.get(`/api/pages/${copyChild}/children`)).body[0].id;

    const docOf = (id: string) => app.get(DocStore).loadDoc(id);
    expect(subpageIds(await docOf(copyId))).toEqual([copyChild]);
    expect(subpageIds(await docOf(copyChild))).toEqual([copyGrand]);
    expect(projectDoc(await docOf(copyChild)).text).toContain('Inhalt der Unterseite');
    // Original bleibt unverändert
    expect(subpageIds(await docOf(root.id))).toEqual([child.id]);
    // Projektion für die Suche ist sofort da
    const hits = (await search(member, { q: 'Unterseite' })).body.map((r: { id: string }) => r.id);
    expect(hits).toEqual(expect.arrayContaining([child.id, copyChild]));
    // Kopie liegt direkt hinter dem Original, wer sie anlegt, ist Ersteller
    const sidebar = (await member.get(`/api/workspaces/${ws}/sidebar`)).body.team;
    const order = sidebar.map((p: { id: string }) => p.id);
    expect(order.indexOf(copyId)).toBe(order.indexOf(root.id) + 1);
    const copy = (await member.get(`/api/pages/${copyId}`)).body;
    expect(copy.createdBy.id).toBe(memberId);
  });

  it('Unterseite duplizieren legt die Kopie in derselben Elternseite an', async () => {
    const root = await newPage(owner, { scope: 'TEAM', title: 'Eltern' });
    const child = await newPage(owner, { parentId: root.id, title: 'Kind' });
    const res = await owner.post(`/api/pages/${child.id}/duplicate`);
    expect(res.status).toBe(201);
    const children = (await owner.get(`/api/pages/${root.id}/children`)).body;
    expect(children.map((c: { title: string }) => c.title)).toEqual(['Kind', 'Kind (Kopie)']);
    // Unterseiten-Block der Kopie wird in der Elternseite ergänzt
    expect(subpageIds(await app.get(DocStore).loadDoc(root.id))).toContain(res.body.id);
  });

  it('private Seiten anderer und Papierkorb: 404, private Kopie bleibt privat', async () => {
    const priv = await newPage(owner, { scope: 'PRIVATE', title: 'Privat' });
    expect((await member.post(`/api/pages/${priv.id}/duplicate`)).status).toBe(404);
    const copy = await owner.post(`/api/pages/${priv.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect((await member.get(`/api/pages/${copy.body.id}`)).status).toBe(404);
    expect((await owner.get(`/api/pages/${copy.body.id}`)).body.scope).toBe('PRIVATE');
    await owner.del(`/api/pages/${priv.id}`);
    expect((await owner.post(`/api/pages/${priv.id}/duplicate`)).status).toBe(404);
  });

  it('Seiten im Papierkorb werden nicht mitkopiert', async () => {
    const root = await newPage(owner, { scope: 'TEAM', title: 'Wurzel' });
    const gone = await newPage(owner, { parentId: root.id, title: 'Gelöscht' });
    await owner.del(`/api/pages/${gone.id}`);
    const res = await owner.post(`/api/pages/${root.id}/duplicate`);
    expect(res.body.pages).toBe(1);
  });
});

describe('Druckansicht (Inhalt als JSON)', () => {
  it('liefert den Inhalt nur bei Zugriff', async () => {
    const page = await newPage(owner, { scope: 'PRIVATE', title: 'Druck' });
    await writeContent(page.id, [{ type: 'paragraph', id: 'p', text: 'Zum Drucken' }]);
    const res = await owner.get(`/api/pages/${page.id}/content`);
    expect(res.status).toBe(200);
    expect(res.body.doc.content[0]).toMatchObject({
      type: 'paragraph',
      attrs: { id: 'p' },
      content: [{ type: 'text', text: 'Zum Drucken' }],
    });
    expect((await member.get(`/api/pages/${page.id}/content`)).status).toBe(404);
  });
});
