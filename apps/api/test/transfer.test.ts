import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inferColumn, parseDate } from '../src/transfer/transfer.service';
import { parseCsv, toCsv } from '../src/transfer/csv';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/** Phase 12: Import (Markdown, CSV, Notion-ZIP) und Export (Markdown, HTML, CSV). */
let app: NestFastifyApplication;
let owner: Client;
let ws: string;

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
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(data: Buffer, filename: string) {
  const boundary = '----jotionimport';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function importFile(c: Client, data: Buffer, name: string, query = 'scope=TEAM') {
  const m = multipart(data, name);
  const res = await app.inject({
    method: 'POST',
    url: `/api/workspaces/${ws}/import?${query}`,
    headers: { ...m.headers, cookie: c.cookie! },
    payload: m.body,
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

const content = async (id: string) =>
  JSON.stringify((await owner.get(`/api/pages/${id}/content`)).body.doc);

describe('Hilfsfunktionen', () => {
  it('CSV mit Anführungszeichen, Zeilenumbrüchen, Semikolon und BOM', () => {
    expect(parseCsv('﻿a,b\n"x, y","mit ""Zitat""\nund Umbruch"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'mit "Zitat"\nund Umbruch'],
    ]);
    expect(parseCsv('Name;Preis\nBrot;2,50\n')).toEqual([
      ['Name', 'Preis'],
      ['Brot', '2,50'],
    ]);
    expect(parseCsv(toCsv([['a"b', 'c\nd']]))).toEqual([['a"b', 'c\nd']]);
  });

  it('Spaltentypen und Datumsformate', () => {
    expect(inferColumn(['1', '2,5', ''])).toBe('number');
    expect(inferColumn(['Yes', 'No', ''])).toBe('checkbox');
    expect(inferColumn(['2026-11-09', '12.11.2026'])).toBe('date');
    expect(inferColumn(['https://a.de', 'https://b.de'])).toBe('url');
    expect(inferColumn(['Mathe', 'Deutsch', 'Mathe'])).toBe('select');
    expect(inferColumn(['A, B', 'B', 'A, C'])).toBe('multi_select');
    expect(
      inferColumn([
        'ein langer Text',
        'noch einer',
        'und der dritte',
        'vier',
        'fünf',
        'sechs',
        'sieben',
        'acht',
        'neun',
      ]),
    ).toBe('text');
    expect(parseDate('November 9, 2026')).toEqual({ start: '2026-11-09', hasTime: false });
    expect(parseDate('November 9, 2026 3:30 PM')).toEqual({
      start: '2026-11-09T15:30:00.000Z',
      hasTime: true,
    });
    expect(parseDate('09.11.2026')).toEqual({ start: '2026-11-09', hasTime: false });
  });
});

describe('Import', () => {
  it('Markdown-Datei wird zur Seite, Titel aus der ersten Überschrift', async () => {
    const r = await importFile(
      owner,
      Buffer.from('# Rezept\n\n- [ ] Mehl\n- [x] Eier\n\n**Backen** bei 180 Grad'),
      'rezept.md',
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ pages: 1, databases: 0 });
    const page = (await owner.get(`/api/pages/${r.body.rootIds[0]}`)).body;
    expect(page.title).toBe('Rezept');
    const c = await content(page.id);
    expect(c).toContain('taskItem');
    expect(c).toContain('Backen');
  });

  it('CSV wird zur Datenbank mit erkannten Spaltentypen', async () => {
    const csv =
      'Aufgabe,Fällig,Erledigt,Fach,Punkte\nVokabeln,2026-11-10,Yes,Englisch,3\nReferat,12.11.2026,No,Deutsch,5\nKlausur,2026-11-20,No,Englisch,\n';
    const r = await importFile(owner, Buffer.from(csv), 'Hausaufgaben.csv');
    expect(r.body).toMatchObject({ databases: 1, rows: 3 });
    const id = r.body.rootIds[0];
    const db = (await owner.get(`/api/databases/${id}`)).body;
    expect(db.title).toBe('Hausaufgaben');
    const types = Object.fromEntries(
      db.properties.map((p: { name: string; type: string }) => [p.name, p.type]),
    );
    expect(types).toEqual({
      Aufgabe: 'title',
      Fällig: 'date',
      Erledigt: 'checkbox',
      Fach: 'select',
      Punkte: 'number',
    });
    const rows = (await owner.post(`/api/databases/${id}/query`, {})).body.rows;
    const prop = (n: string) => db.properties.find((p: { name: string }) => p.name === n).id;
    const ref = rows.find((x: { title: string }) => x.title === 'Referat');
    expect(ref.values[prop('Fällig')]).toMatchObject({ start: '2026-11-12', hasTime: false });
    expect(ref.values[prop('Punkte')]).toBe(5);
    expect(ref.values[prop('Erledigt')] ?? false).toBe(false);
    const vok = rows.find((x: { title: string }) => x.title === 'Vokabeln');
    expect(vok.values[prop('Erledigt')]).toBe(true);
  });

  it('Notion-Export: Seitenbaum, Datenbank mit Zeilenseiten, Bilder, Links zwischen Seiten', async () => {
    const id = (n: number) => String(n).repeat(32).slice(0, 32);
    const zip = zipSync({
      'Export-abc': {
        [`Schule ${id(1)}.md`]: strToU8(
          `# Schule\n\nSiehe [Stundenplan](Schule%20${id(1)}/Stundenplan%20${id(2)}.md).\n\n![Logo](Schule%20${id(1)}/logo.png)\n`,
        ),
        [`Schule ${id(1)}`]: {
          [`Stundenplan ${id(2)}.md`]: strToU8('# Stundenplan\n\nMontag: Mathe'),
          'logo.png': PNG,
          [`Aufgaben ${id(3)}.csv`]: strToU8('Name,Status\nVokabeln,Done\n'),
          [`Aufgaben ${id(3)}_all.csv`]: strToU8(
            'Name,Status\nVokabeln,Done\nReferat,Not started\n',
          ),
          [`Aufgaben ${id(3)}`]: {
            [`Vokabeln ${id(4)}.md`]: strToU8('# Vokabeln\n\nStatus: Done\n\nUnit 3 bis Seite 40'),
          },
        },
      },
    });
    const r = await importFile(owner, Buffer.from(zip), 'Export.zip');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ pages: 2, databases: 1, rows: 2, images: 1 });
    const root = r.body.rootIds[0];
    expect((await owner.get(`/api/pages/${root}`)).body.title).toBe('Schule');
    const children = (await owner.get(`/api/pages/${root}/children`)).body as {
      id: string;
      title: string;
    }[];
    expect(children.map((c) => c.title).sort()).toEqual(['Aufgaben', 'Stundenplan']);
    const plan = children.find((c) => c.title === 'Stundenplan')!;
    const c = await content(root);
    // Link auf die importierte Seite, Bild hochgeladen, Datenbank als Unterseiten-Block
    expect(c).toContain(`/w/${ws}/p/${plan.id}`);
    expect(c).toMatch(/\/api\/files\/[0-9a-f-]{36}/);
    expect(c).toContain(children.find((x) => x.title === 'Aufgaben')!.id);
    const db = children.find((x) => x.title === 'Aufgaben')!;
    const rows = (await owner.post(`/api/databases/${db.id}/query`, {})).body.rows as {
      id: string;
      title: string;
    }[];
    expect(rows.map((x) => x.title).sort()).toEqual(['Referat', 'Vokabeln']);
    const vok = rows.find((x) => x.title === 'Vokabeln')!;
    const vc = await content(vok.id);
    expect(vc).toContain('Unit 3 bis Seite 40');
    expect(vc).not.toContain('Status: Done');
  });

  it('Grenzen und Rechte: falscher Typ, kaputtes ZIP, fremder Workspace, nur lesend', async () => {
    expect((await importFile(owner, Buffer.from('x'), 'bild.exe')).status).toBe(415);
    expect((await importFile(owner, Buffer.from('kein zip'), 'a.zip')).status).toBe(422);
    const m = await addMember(app, owner, ws, 'm@test.local');
    const page = (
      await owner.post(`/api/workspaces/${ws}/pages`, { title: 'Nur lesen', scope: 'TEAM' })
    ).body;
    await owner.put(`/api/pages/${page.id}/permissions`, { userId: m.userId, level: 'view' });
    const r = await importFile(m.client, Buffer.from('# X'), 'x.md', `parentId=${page.id}`);
    expect(r.status).toBe(403);
  });
});

describe('Export', () => {
  it('Seite mit Unterseite, Bild und Datenbank als Markdown-ZIP, Datenbank als CSV, HTML', async () => {
    const zip = zipSync({
      'Wiki.md': strToU8('# Wiki\n\nStart **hier**.\n\n![Bild](bild.png)'),
      'bild.png': PNG,
      Wiki: {
        'Kapitel.md': strToU8('# Kapitel\n\nInhalt'),
        'Liste.csv': strToU8('Name,Menge\nÄpfel,3\n'),
      },
    });
    const imp = await importFile(owner, Buffer.from(zip), 'wiki.zip');
    const root = imp.body.rootIds[0];
    const res = await app.inject({
      method: 'GET',
      url: `/api/pages/${root}/export?format=markdown`,
      headers: { cookie: owner.cookie! },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const files = unzipSync(new Uint8Array(res.rawPayload));
    const names = Object.keys(files).sort();
    expect(names).toContain('Wiki.md');
    expect(names).toContain('Wiki/Kapitel.md');
    expect(names).toContain('Wiki/Liste.csv');
    expect(names.some((n) => /^_dateien\/[0-9a-f-]{36}\.png$/.test(n))).toBe(true);
    const md = strFromU8(files['Wiki.md']!);
    expect(md).toContain('# Wiki');
    expect(md).toContain('**hier**');
    expect(md).toContain('[Kapitel](Wiki/Kapitel.md)');
    expect(md).toMatch(/!\[Bild\]\(_dateien\/[0-9a-f-]{36}\.png\)/);
    expect(strFromU8(files['Wiki/Liste.csv']!)).toContain('Äpfel,3');

    const html = await app.inject({
      method: 'GET',
      url: `/api/pages/${root}/export?format=html`,
      headers: { cookie: owner.cookie! },
    });
    const hf = unzipSync(new Uint8Array(html.rawPayload));
    expect(strFromU8(hf['Wiki.html']!)).toContain('<strong>hier</strong>');

    const kids = (await owner.get(`/api/pages/${root}/children`)).body as {
      id: string;
      title: string;
    }[];
    const csv = await owner.get(
      `/api/databases/${kids.find((k) => k.title === 'Liste')!.id}/export.csv`,
    );
    expect(csv.status).toBe(200);
    expect(String(csv.body)).toContain('Name,Menge');
  });

  it('Export enthält nur sichtbare Unterseiten', async () => {
    const root = (
      await owner.post(`/api/workspaces/${ws}/pages`, { title: 'Öffentlich', scope: 'TEAM' })
    ).body;
    const secret = (
      await owner.post(`/api/workspaces/${ws}/pages`, { title: 'Geheim', parentId: root.id })
    ).body;
    const m = await addMember(app, owner, ws, 'm@test.local');
    await owner.put(`/api/pages/${secret.id}/permissions`, { userId: m.userId, level: 'none' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/pages/${root.id}/export`,
      headers: { cookie: m.client.cookie! },
    });
    const names = Object.keys(unzipSync(new Uint8Array(res.rawPayload)));
    expect(names).toEqual(['Öffentlich.md']);
  });
});
