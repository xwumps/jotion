import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { subpageIds } from '@jotion/editor/projection';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocStore } from '../src/collab/doc-store';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/**
 * Phase 4: Datenbanken über die API (Anlegen, Properties, Zeilen, Ansichten, Abfragen,
 * Berechnungen, Typwechsel) und die Rechtematrix für private Datenbanken und Linked Databases.
 */
let app: NestFastifyApplication;
let db: PrismaClient;
let owner: Client;
let member: Client;
let outsider: Client;
let ws: string;
let ownerId: string;
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
  ownerId = o.userId;
  const m = await addMember(app, owner, ws, 'member@test.local');
  member = m.client;
  memberId = m.userId;
  const other = await owner.post('/api/workspaces', { name: 'Anderer' });
  outsider = (await addMember(app, owner, other.body.id, 'outsider@test.local')).client;
});

const createDb = async (c: Client, body: object = {}) => {
  const res = await c.post(`/api/workspaces/${ws}/databases`, {
    scope: 'TEAM',
    title: 'Aufgaben',
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body;
};
const addProp = async (c: Client, dbId: string, body: object) => {
  const res = await c.post(`/api/databases/${dbId}/properties`, body);
  expect(res.status).toBe(201);
  return res.body;
};
const addRow = async (c: Client, dbId: string, body: object = {}) => {
  const res = await c.post(`/api/databases/${dbId}/rows`, body);
  expect(res.status).toBe(201);
  return res.body;
};
const query = (c: Client, dbId: string, body: object = {}) =>
  c.post(`/api/databases/${dbId}/query`, body);
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

async function storedDoc(pageId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  await app.get(DocStore).loadInto(pageId, doc);
  return doc;
}

describe('Datenbank anlegen', () => {
  it('legt Seite, Titel- und Tags-Spalte und eine Tabellenansicht an', async () => {
    const d = await createDb(owner);
    expect(d.properties.map((p: { type: string }) => p.type)).toEqual(['title', 'multi_select']);
    expect(d.views).toHaveLength(1);
    expect(d.views[0]).toMatchObject({ type: 'table', config: { filter: null, sorts: [] } });
    const page = (await owner.get(`/api/pages/${d.id}`)).body;
    expect(page).toMatchObject({ kind: 'DATABASE', databaseId: null, scope: 'TEAM' });
    const sidebar = (await owner.get(`/api/workspaces/${ws}/sidebar`)).body;
    expect(sidebar.team.map((n: { id: string }) => n.id)).toContain(d.id);
  });

  it('Zeilen sind Seiten mit Inhalt, erscheinen aber nicht im Seitenbaum', async () => {
    const d = await createDb(owner);
    const row = await addRow(owner, d.id, { title: 'Einkaufen' });
    const page = (await owner.get(`/api/pages/${row.id}`)).body;
    expect(page).toMatchObject({ kind: 'DATABASE_ROW', databaseId: d.id, parentId: d.id });
    expect(page.breadcrumbs.map((b: { id: string }) => b.id)).toEqual([d.id]);
    expect((await owner.get(`/api/pages/${d.id}/children`)).body).toEqual([]);
    const sidebar = (await owner.get(`/api/workspaces/${ws}/sidebar`)).body;
    expect(sidebar.team.find((n: { id: string }) => n.id === d.id).hasChildren).toBe(false);
    // Unterseiten in einer Zeile sind erlaubt
    const sub = await owner.post(`/api/workspaces/${ws}/pages`, {
      parentId: row.id,
      title: 'Notiz',
    });
    expect(sub.status).toBe(201);
  });

  it('Full-Page-Datenbank unter einer Seite bekommt einen Unterseiten-Block, Inline nicht', async () => {
    const host = (await owner.post(`/api/workspaces/${ws}/pages`, { scope: 'TEAM', title: 'Host' }))
      .body;
    const full = await createDb(owner, { parentId: host.id });
    const inline = await createDb(owner, { parentId: host.id, inline: true });
    expect(inline.isInline).toBe(true);
    expect(subpageIds(await storedDoc(host.id))).toEqual([full.id]);
    // Inline-Datenbanken brauchen eine Elternseite
    expect((await owner.post(`/api/workspaces/${ws}/databases`, { inline: true })).status).toBe(
      422,
    );
  });

  it('Seiten können nicht direkt in eine Datenbank gelegt oder Zeilen verschoben werden', async () => {
    const d = await createDb(owner);
    const row = await addRow(owner, d.id);
    const page = (await owner.post(`/api/workspaces/${ws}/pages`, { scope: 'TEAM' })).body;
    expect((await owner.post(`/api/workspaces/${ws}/pages`, { parentId: d.id })).status).toBe(400);
    expect((await owner.post(`/api/pages/${page.id}/move`, { parentId: d.id })).status).toBe(400);
    expect((await owner.post(`/api/pages/${row.id}/move`, { parentId: page.id })).status).toBe(400);
    expect((await owner.post(`/api/workspaces/${ws}/databases`, { parentId: d.id })).status).toBe(
      400,
    );
  });

  it('Papierkorb: Datenbank nimmt ihre Zeilen mit, eine Zeile allein ist wiederherstellbar', async () => {
    const d = await createDb(owner);
    const a = await addRow(owner, d.id, { title: 'A' });
    await addRow(owner, d.id, { title: 'B' });
    expect(
      (await owner.post(`/api/databases/${d.id}/rows/trash`, { rowIds: [a.id] })).body,
    ).toEqual({
      trashed: 1,
    });
    expect(titles((await query(owner, d.id)).body.rows)).toEqual(['B']);
    expect((await owner.post(`/api/pages/${a.id}/restore`)).status).toBe(200);
    expect(titles((await query(owner, d.id)).body.rows)).toEqual(['A', 'B']);

    await owner.del(`/api/pages/${d.id}`);
    expect((await owner.get(`/api/databases/${d.id}`)).body.deleted).toBe(true);
    expect((await owner.post(`/api/databases/${d.id}/rows`, {})).status).toBe(404);
    await owner.post(`/api/pages/${d.id}/restore`);
    expect(titles((await query(owner, d.id)).body.rows)).toEqual(['A', 'B']);
  });
});

describe('Properties und Werte', () => {
  it('validiert Werte je Typ und speichert sie', async () => {
    const d = await createDb(owner);
    const num = await addProp(owner, d.id, { name: 'Punkte', type: 'number' });
    const sel = await addProp(owner, d.id, {
      name: 'Prio',
      type: 'select',
      config: {
        options: [{ id: '01900000-0000-7000-8000-000000000001', name: 'Hoch', color: 'red' }],
      },
    });
    const date = await addProp(owner, d.id, { name: 'Fällig', type: 'date' });
    const who = await addProp(owner, d.id, { name: 'Wer', type: 'person' });
    const done = await addProp(owner, d.id, { name: 'Fertig', type: 'checkbox' });
    const status = await addProp(owner, d.id, { name: 'Status', type: 'status' });
    expect(status.config.options.map((o: { group: string }) => o.group)).toEqual([
      'todo',
      'in_progress',
      'complete',
    ]);
    const row = await addRow(owner, d.id, {
      title: '  Bericht  ',
      values: {
        [num.id]: 3,
        [sel.id]: sel.config.options[0].id,
        [date.id]: { start: '2026-11-20' },
        [who.id]: [memberId],
        [done.id]: true,
      },
    });
    expect(row.title).toBe('Bericht');
    expect(row.values[num.id]).toBe(3);
    expect(row.values[date.id]).toEqual({
      start: '2026-11-20',
      end: null,
      hasTime: false,
      timeZone: null,
    });
    expect(row.values[who.id]).toEqual([memberId]);

    const bad = (values: object) =>
      owner.patch(`/api/databases/${d.id}/rows/${row.id}/properties`, { values });
    expect((await bad({ [num.id]: 'drei' })).status).toBe(422);
    expect((await bad({ [sel.id]: '01900000-0000-7000-8000-0000000000ff' })).status).toBe(422);
    expect((await bad({ '01900000-0000-7000-8000-0000000000ee': 1 })).status).toBe(422);
    expect((await bad({ [who.id]: ['01900000-0000-7000-8000-0000000000ee'] })).status).toBe(422);
    const created = d.properties.find((p: { type: string }) => p.type === 'title');
    expect((await bad({ [created.id]: 'x' })).status).toBe(422);

    const cleared = await owner.patch(`/api/databases/${d.id}/rows/${row.id}/properties`, {
      values: { [num.id]: null, [done.id]: false },
    });
    expect(cleared.body.values[num.id]).toBeUndefined();
    expect(cleared.body.values[done.id]).toBeUndefined();
    expect(await db.propertyValue.count({ where: { rowId: row.id } })).toBe(3);
  });

  it('entfernt gelöschte Optionen aus den Werten und schützt die Titel-Spalte', async () => {
    const d = await createDb(owner);
    const tags = d.properties[1];
    const [a, b] = ['01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-00000000000b'];
    await owner.patch(`/api/databases/${d.id}/properties/${tags.id}`, {
      config: {
        options: [
          { id: a, name: 'A' },
          { id: b, name: 'B' },
        ],
      },
    });
    const row = await addRow(owner, d.id, { values: { [tags.id]: [a, b] } });
    await owner.patch(`/api/databases/${d.id}/properties/${tags.id}`, {
      config: { options: [{ id: b, name: 'B' }] },
    });
    expect((await owner.get(`/api/databases/${d.id}/rows/${row.id}`)).body.values[tags.id]).toEqual(
      [b],
    );
    expect(
      (await owner.del(`/api/databases/${d.id}/properties/${d.properties[0].id}`)).status,
    ).toBe(400);
    expect((await owner.del(`/api/databases/${d.id}/properties/${tags.id}`)).status).toBe(204);
    expect(await db.propertyValue.count({ where: { rowId: row.id } })).toBe(0);
    expect(
      (await owner.post(`/api/databases/${d.id}/properties`, { name: 'F', type: 'formula' }))
        .status,
    ).toBe(422);
  });

  it('vergibt eindeutige IDs fortlaufend, auch rückwirkend', async () => {
    const d = await createDb(owner);
    await addRow(owner, d.id, { title: 'erste' });
    await addRow(owner, d.id, { title: 'zweite' });
    const uid = await addProp(owner, d.id, {
      name: 'ID',
      type: 'unique_id',
      config: { prefix: 'T' },
    });
    const third = await addRow(owner, d.id, { title: 'dritte' });
    expect(third.values[uid.id]).toBe(3);
    const rows = (await query(owner, d.id, { sorts: [{ propertyId: uid.id, direction: 'desc' }] }))
      .body.rows;
    expect(rows.map((r: { values: Record<string, number> }) => r.values[uid.id])).toEqual([
      3, 2, 1,
    ]);
    expect(
      (
        await owner.patch(`/api/databases/${d.id}/rows/${third.id}/properties`, {
          values: { [uid.id]: 9 },
        })
      ).status,
    ).toBe(422);
  });
});

describe('Abfragen, Ansichten, Berechnungen', () => {
  it('filtert, sortiert, sucht und blättert per Cursor', async () => {
    const d = await createDb(owner);
    const num = await addProp(owner, d.id, { name: 'Zahl', type: 'number' });
    const text = await addProp(owner, d.id, { name: 'Notiz', type: 'text' });
    for (let i = 0; i < 25; i++)
      await addRow(owner, d.id, {
        title: `Zeile ${i}`,
        values: { [num.id]: i % 5, [text.id]: i === 7 ? 'Nadel' : 'Heu' },
      });

    const filter = {
      type: 'group',
      op: 'and',
      children: [{ type: 'condition', propertyId: num.id, operator: 'greater_than', value: 2 }],
    };
    const sorts = [{ propertyId: num.id, direction: 'desc' }];
    const first = (await query(owner, d.id, { filter, sorts, limit: 4 })).body;
    expect(first.total).toBe(10);
    expect(first.rows).toHaveLength(4);
    const all = [...first.rows];
    let cursor = first.nextCursor;
    while (cursor) {
      const next = (await query(owner, d.id, { filter, sorts, limit: 4, cursor })).body;
      expect(next.total).toBeNull();
      all.push(...next.rows);
      cursor = next.nextCursor;
    }
    expect(all).toHaveLength(10);
    expect(all.map((r) => r.values[num.id])).toEqual([4, 4, 4, 4, 4, 3, 3, 3, 3, 3]);
    expect(titles((await query(owner, d.id, { search: 'nadel' })).body.rows)).toEqual(['Zeile 7']);
    // Cursor einer anderen Sortierung wird abgelehnt
    expect((await query(owner, d.id, { limit: 4, cursor: first.nextCursor })).status).toBe(400);
    expect(
      (await query(owner, d.id, { filter: { type: 'group', op: 'xor', children: [] } })).status,
    ).toBe(422);
  });

  it('nutzt gespeicherte Ansichten mit Filter, Sortierung und Spaltenberechnungen', async () => {
    const d = await createDb(owner);
    const num = await addProp(owner, d.id, { name: 'Betrag', type: 'number' });
    for (const v of [10, 20, 30, null])
      await addRow(owner, d.id, { values: v === null ? {} : { [num.id]: v } });
    const view = (await owner.post(`/api/databases/${d.id}/views`, { name: 'Große' })).body;
    const upd = await owner.patch(`/api/databases/${d.id}/views/${view.id}`, {
      config: {
        filter: {
          type: 'group',
          op: 'or',
          children: [
            {
              type: 'condition',
              propertyId: num.id,
              operator: 'greater_than_or_equal_to',
              value: 20,
            },
            { type: 'condition', propertyId: num.id, operator: 'is_empty' },
          ],
        },
        sorts: [{ propertyId: num.id, direction: 'asc' }],
        calculations: { [num.id]: 'sum', [d.properties[0].id]: 'count_all' },
      },
    });
    expect(upd.status).toBe(200);
    const res = (await query(owner, d.id, { viewId: view.id })).body;
    expect(
      res.rows.map((r: { values: Record<string, number> }) => r.values[num.id] ?? null),
    ).toEqual([20, 30, null]);
    const calc = (await owner.post(`/api/databases/${d.id}/calculate`, { viewId: view.id })).body;
    // Teiländerungen lassen die übrigen Einstellungen unverändert
    await owner.patch(`/api/databases/${d.id}/views/${view.id}`, { config: { wrapCells: true } });
    const kept = (await owner.get(`/api/databases/${d.id}`)).body.views.find(
      (v: { id: string }) => v.id === view.id,
    ).config;
    expect(kept).toMatchObject({ wrapCells: true, sorts: [{ propertyId: num.id }] });
    expect(kept.filter.children).toHaveLength(2);
    expect(
      (await owner.patch(`/api/databases/${d.id}/views/${view.id}`, { config: { evil: 1 } }))
        .status,
    ).toBe(422);
    expect(calc).toEqual({ [num.id]: 50, [d.properties[0].id]: 3 });

    const views = (await owner.get(`/api/databases/${d.id}`)).body.views;
    expect(views.map((v: { name: string }) => v.name)).toEqual(['Tabelle', 'Große']);
    await owner.patch(`/api/databases/${d.id}/views/${view.id}`, { beforeId: views[0].id });
    expect((await owner.get(`/api/databases/${d.id}`)).body.views[0].id).toBe(view.id);
    expect(
      (await owner.post(`/api/databases/${d.id}/views`, { name: 'Board', type: 'board' })).status,
    ).toBe(400);
    await owner.del(`/api/databases/${d.id}/views/${views[0].id}`);
    expect((await owner.del(`/api/databases/${d.id}/views/${view.id}`)).status).toBe(409);
  });

  it('verschiebt Zeilen in der manuellen Reihenfolge', async () => {
    const d = await createDb(owner);
    const a = await addRow(owner, d.id, { title: 'A' });
    const b = await addRow(owner, d.id, { title: 'B' });
    await addRow(owner, d.id, { title: 'C', afterId: a.id });
    await owner.post(`/api/databases/${d.id}/rows/${b.id}/move`, { beforeId: a.id });
    expect(titles((await query(owner, d.id)).body.rows)).toEqual(['B', 'A', 'C']);
  });
});

describe('Typwechsel', () => {
  it('Text nach Select erzeugt Optionen und lässt sich rückgängig machen', async () => {
    const d = await createDb(owner);
    const text = await addProp(owner, d.id, { name: 'Farbe', type: 'text' });
    const r1 = await addRow(owner, d.id, { values: { [text.id]: 'Rot' } });
    const r2 = await addRow(owner, d.id, { values: { [text.id]: 'Blau' } });
    const conv = await owner.patch(`/api/databases/${d.id}/properties/${text.id}`, {
      type: 'select',
    });
    expect(conv.status).toBe(200);
    expect(conv.body.type).toBe('select');
    const opts = conv.body.config.options as { id: string; name: string }[];
    expect(opts.map((o) => o.name)).toEqual(['Rot', 'Blau']);
    expect((await owner.get(`/api/databases/${d.id}/rows/${r1.id}`)).body.values[text.id]).toBe(
      opts[0]!.id,
    );

    const undo = await owner.post(`/api/databases/${d.id}/properties/${text.id}/undo-conversion`);
    expect(undo.body.type).toBe('text');
    expect((await owner.get(`/api/databases/${d.id}/rows/${r2.id}`)).body.values[text.id]).toBe(
      'Blau',
    );
    expect(
      (await owner.post(`/api/databases/${d.id}/properties/${text.id}/undo-conversion`)).status,
    ).toBe(409);
    expect(
      (
        await owner.patch(`/api/databases/${d.id}/properties/${d.properties[0].id}`, {
          type: 'text',
        })
      ).status,
    ).toBe(400);
  });

  it('Zahl nach Text und Erstellt von nach Person', async () => {
    const d = await createDb(owner);
    const num = await addProp(owner, d.id, { name: 'N', type: 'number' });
    const by = await addProp(owner, d.id, { name: 'Von', type: 'created_by' });
    const row = await addRow(owner, d.id, { values: { [num.id]: 2.5 } });
    await owner.patch(`/api/databases/${d.id}/properties/${num.id}`, { type: 'text' });
    await owner.patch(`/api/databases/${d.id}/properties/${by.id}`, { type: 'person' });
    const got = (await owner.get(`/api/databases/${d.id}/rows/${row.id}`)).body;
    expect(got.values[num.id]).toBe('2.5');
    expect(got.values[by.id]).toEqual([ownerId]);
  });
});

describe('Linked Databases', () => {
  it('zeigen Zeilen und Properties der Quelle mit eigenen Ansichten', async () => {
    const src = await createDb(owner);
    await addRow(owner, src.id, { title: 'aus der Quelle' });
    const host = (await owner.post(`/api/workspaces/${ws}/pages`, { scope: 'TEAM', title: 'Host' }))
      .body;
    const linked = await createDb(owner, {
      parentId: host.id,
      inline: true,
      sourceDatabaseId: src.id,
    });
    expect(linked).toMatchObject({ dataId: src.id, source: { id: src.id }, sourceMissing: false });
    expect(linked.properties.map((p: { id: string }) => p.id)).toEqual(
      src.properties.map((p: { id: string }) => p.id),
    );
    expect(linked.views[0].id).not.toBe(src.views[0].id);
    expect(titles((await query(owner, linked.id)).body.rows)).toEqual(['aus der Quelle']);
    const added = await addRow(owner, linked.id, { title: 'über Linked' });
    expect((await owner.get(`/api/pages/${added.id}`)).body.databaseId).toBe(src.id);
    // Linked auf Linked zeigt auf die eigentliche Quelle
    const chain = await createDb(owner, { sourceDatabaseId: linked.id });
    expect(chain.dataId).toBe(src.id);
  });
});

describe('Rechtematrix', () => {
  it('private Datenbanken und ihre Zeilen sind für andere unsichtbar', async () => {
    const priv = await createDb(owner, { scope: 'PRIVATE', title: 'Geheim' });
    const num = await addProp(owner, priv.id, { name: 'N', type: 'number' });
    const row = await addRow(owner, priv.id, { title: 'Tagebuch', values: { [num.id]: 1 } });
    expect(row.id).toBeTruthy();
    expect((await owner.get(`/api/pages/${row.id}`)).body.scope).toBe('PRIVATE');
    const view = priv.views[0].id;

    for (const c of [member, outsider]) {
      const calls = [
        c.get(`/api/databases/${priv.id}`),
        c.post(`/api/databases/${priv.id}/query`, {}),
        c.post(`/api/databases/${priv.id}/calculate`, { viewId: view }),
        c.post(`/api/databases/${priv.id}/rows`, { title: 'x' }),
        c.get(`/api/databases/${priv.id}/rows/${row.id}`),
        c.patch(`/api/databases/${priv.id}/rows/${row.id}/properties`, { title: 'x' }),
        c.post(`/api/databases/${priv.id}/rows/${row.id}/move`, {}),
        c.post(`/api/databases/${priv.id}/rows/trash`, { rowIds: [row.id] }),
        c.post(`/api/databases/${priv.id}/properties`, { name: 'x', type: 'text' }),
        c.patch(`/api/databases/${priv.id}/properties/${num.id}`, { name: 'x' }),
        c.del(`/api/databases/${priv.id}/properties/${num.id}`),
        c.post(`/api/databases/${priv.id}/properties/${num.id}/undo-conversion`),
        c.post(`/api/databases/${priv.id}/views`, { name: 'x' }),
        c.patch(`/api/databases/${priv.id}/views/${view}`, { name: 'x' }),
        c.del(`/api/databases/${priv.id}/views/${view}`),
        c.get(`/api/pages/${row.id}`),
      ];
      for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
    }
    // Über Linked Database, Zeilen-ID einer fremden Datenbank oder Suche ebenfalls nicht
    expect(
      (
        await member.post(`/api/workspaces/${ws}/databases`, {
          scope: 'TEAM',
          sourceDatabaseId: priv.id,
        })
      ).status,
    ).toBe(404);
    const own = await createDb(member);
    expect((await member.get(`/api/databases/${own.id}/rows/${row.id}`)).status).toBe(404);
    expect(
      (await member.patch(`/api/databases/${own.id}/rows/${row.id}/properties`, { title: 'x' }))
        .status,
    ).toBe(404);
    expect(
      (await member.post(`/api/databases/${own.id}/rows/trash`, { rowIds: [row.id] })).body,
    ).toEqual({ trashed: 0 });
    expect(
      (await member.get(`/api/workspaces/${ws}/databases`)).body.map((x: { id: string }) => x.id),
    ).not.toContain(priv.id);
    expect((await member.get(`/api/workspaces/${ws}/search?q=Tagebuch`)).body).toEqual([]);
    expect(await db.page.count({ where: { id: row.id, deletedAt: null } })).toBe(1);
  });

  it('eine Linked Database im Team gibt Zeilen einer privaten Quelle nicht preis', async () => {
    const priv = await createDb(owner, { scope: 'PRIVATE' });
    const row = await addRow(owner, priv.id, { title: 'nur für mich' });
    const linked = await createDb(owner, { scope: 'TEAM', sourceDatabaseId: priv.id });
    // Owner sieht die Zeilen
    expect(titles((await query(owner, linked.id)).body.rows)).toEqual(['nur für mich']);
    // Mitglied sieht die Linked Database, aber weder Properties noch Zeilen
    const seen = (await member.get(`/api/databases/${linked.id}`)).body;
    expect(seen).toMatchObject({ sourceMissing: true, source: null, properties: [] });
    expect((await query(member, linked.id)).body).toEqual({ rows: [], nextCursor: null, total: 0 });
    expect((await member.get(`/api/databases/${linked.id}/rows/${row.id}`)).status).toBe(404);
    expect((await member.post(`/api/databases/${linked.id}/rows`, {})).status).toBe(404);
    expect(
      (await member.post(`/api/databases/${linked.id}/properties`, { name: 'x', type: 'text' }))
        .status,
    ).toBe(404);
    expect(
      (await member.post(`/api/databases/${linked.id}/calculate`, { viewId: linked.views[0].id }))
        .body,
    ).toEqual({});
  });

  it('Teamdatenbanken können alle Mitglieder bearbeiten; gesperrte nur Zeilen, nicht das Schema', async () => {
    const d = await createDb(owner);
    const row = await addRow(member, d.id, { title: 'vom Mitglied' });
    expect(
      (
        await member.patch(`/api/databases/${d.id}/rows/${row.id}/properties`, {
          title: 'geändert',
        })
      ).body.title,
    ).toBe('geändert');
    await owner.patch(`/api/pages/${d.id}`, { settings: { locked: true } });
    expect(
      (await member.post(`/api/databases/${d.id}/properties`, { name: 'x', type: 'text' })).status,
    ).toBe(403);
    expect((await member.post(`/api/databases/${d.id}/views`, { name: 'x' })).status).toBe(403);
    expect((await member.post(`/api/databases/${d.id}/rows`, {})).status).toBe(201);
  });

  it('Ereignisse privater Datenbanken gehen nur an den Owner', async () => {
    const priv = await createDb(owner, { scope: 'PRIVATE' });
    await db.changeEvent.deleteMany({});
    await addRow(owner, priv.id);
    const events = await db.changeEvent.findMany({ where: { type: 'database.rows.changed' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityId: priv.id, audienceUserId: ownerId });
  });
});
