import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EMPTY_GROUP } from '@jotion/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/**
 * Phase 5: Ansichten mit Gruppierung (Board, Liste), Kalender und Zeitleiste über die API:
 * Gruppen mit Zählern, Zeilen je Gruppe, Ziehen zwischen Gruppen (Wert und Position atomar),
 * gleichzeitiges Ziehen zweier Clients, Zeitraumabfragen, Layout-Standards und Sperre.
 */
let app: NestFastifyApplication;
let owner: Client;
let member: Client;
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
  member = (await addMember(app, owner, ws, 'member@test.local')).client;
});

interface Option {
  id: string;
  name: string;
}

async function boardSetup() {
  const d = (await owner.post(`/api/workspaces/${ws}/databases`, { scope: 'TEAM', title: 'Board' }))
    .body;
  const status = (
    await owner.post(`/api/databases/${d.id}/properties`, { name: 'Status', type: 'status' })
  ).body;
  const date = (
    await owner.post(`/api/databases/${d.id}/properties`, { name: 'Fällig', type: 'date' })
  ).body;
  const tags = d.properties.find((p: { type: string }) => p.type === 'multi_select');
  const [todo, doing, done] = status.config.options as Option[];
  const view = (await owner.post(`/api/databases/${d.id}/views`, { name: 'Board', type: 'board' }))
    .body;
  const row = async (title: string, values: object = {}) =>
    (await owner.post(`/api/databases/${d.id}/rows`, { title, values })).body;
  return { d, status, date, tags, todo: todo!, doing: doing!, done: done!, view, row };
}

const groups = (c: Client, dbId: string, viewId: string) =>
  c.post(`/api/databases/${dbId}/groups`, { viewId });
const countsOf = (body: { counts: { key: string; subKey: string | null; count: number }[] }) =>
  Object.fromEntries(body.counts.map((c) => [c.subKey ? `${c.key}/${c.subKey}` : c.key, c.count]));

describe('Gruppierung', () => {
  it('Board gruppiert standardmäßig nach Status und zählt je Spalte', async () => {
    const s = await boardSetup();
    expect(s.view).toMatchObject({
      type: 'board',
      config: { groupBy: { propertyId: s.status.id } },
    });
    await s.row('A', { [s.status.id]: s.todo.id });
    await s.row('B', { [s.status.id]: s.todo.id });
    await s.row('C', { [s.status.id]: s.done.id });
    await s.row('D');
    const res = await groups(owner, s.d.id, s.view.id);
    expect(res.status).toBe(200);
    expect(countsOf(res.body)).toEqual({ [s.todo.id]: 2, [s.done.id]: 1, [EMPTY_GROUP]: 1 });
    expect(res.body.total).toBe(4);
    const col = await owner.post(`/api/databases/${s.d.id}/query`, {
      viewId: s.view.id,
      group: s.todo.id,
    });
    expect(col.body.rows.map((r: { title: string }) => r.title)).toEqual(['A', 'B']);
    expect(col.body.total).toBe(2);
  });

  it('Mehrfachauswahl zählt eine Zeile in jeder Gruppe, Untergruppen bilden Swimlanes', async () => {
    const s = await boardSetup();
    const tagCfg = (
      await owner.patch(`/api/databases/${s.d.id}/properties/${s.tags.id}`, {
        config: {
          options: [
            { id: crypto.randomUUID(), name: 'x', color: 'red' },
            { id: crypto.randomUUID(), name: 'y', color: 'blue' },
          ],
        },
      })
    ).body;
    const [x, y] = tagCfg.config.options as Option[];
    await s.row('A', { [s.tags.id]: [x!.id, y!.id], [s.status.id]: s.todo.id });
    await s.row('B', { [s.tags.id]: [x!.id], [s.status.id]: s.done.id });
    await owner.patch(`/api/databases/${s.d.id}/views/${s.view.id}`, {
      config: {
        groupBy: { propertyId: s.tags.id },
        subGroupBy: { propertyId: s.status.id },
      },
    });
    const res = await groups(owner, s.d.id, s.view.id);
    expect(countsOf(res.body)).toEqual({
      [`${x!.id}/${s.todo.id}`]: 1,
      [`${y!.id}/${s.todo.id}`]: 1,
      [`${x!.id}/${s.done.id}`]: 1,
    });
    expect(res.body.total).toBe(2);
    const lane = await owner.post(`/api/databases/${s.d.id}/query`, {
      viewId: s.view.id,
      group: x!.id,
      subGroup: s.done.id,
    });
    expect(lane.body.rows.map((r: { title: string }) => r.title)).toEqual(['B']);
  });

  it('gruppiert Datum nach Woche in der Zeitzone des Betrachters', async () => {
    const s = await boardSetup();
    await owner.patch(`/api/databases/${s.d.id}/views/${s.view.id}`, {
      config: { groupBy: { propertyId: s.date.id, dateBucket: 'week' } },
    });
    await s.row('So spät', {
      [s.date.id]: { start: '2026-11-08T23:30:00Z', hasTime: true },
    });
    await s.row('Mo', { [s.date.id]: { start: '2026-11-09' } });
    const utc = await owner.post(`/api/databases/${s.d.id}/groups`, {
      viewId: s.view.id,
      timeZone: 'UTC',
    });
    expect(countsOf(utc.body)).toEqual({ '2026-11-02': 1, '2026-11-09': 1 });
    const berlin = await owner.post(`/api/databases/${s.d.id}/groups`, {
      viewId: s.view.id,
      timeZone: 'Europe/Berlin',
    });
    expect(countsOf(berlin.body)).toEqual({ '2026-11-09': 2 });
  });

  it('lehnt Gruppenabfragen für nicht gruppierte Ansichten ab', async () => {
    const s = await boardSetup();
    const table = s.d.views[0];
    expect((await groups(owner, s.d.id, table.id)).status).toBe(400);
    expect(
      (await owner.post(`/api/databases/${s.d.id}/query`, { viewId: table.id, group: 'x' })).status,
    ).toBe(400);
  });
});

describe('Ziehen zwischen Gruppen', () => {
  it('setzt Wert und Position in einem Schritt', async () => {
    const s = await boardSetup();
    const a = await s.row('A', { [s.status.id]: s.todo.id });
    const b = await s.row('B', { [s.status.id]: s.doing.id });
    const c = await s.row('C', { [s.status.id]: s.doing.id });
    const res = await owner.post(`/api/databases/${s.d.id}/rows/${a.id}/move`, {
      afterId: b.id,
      groups: [{ propertyId: s.status.id, from: s.todo.id, to: s.doing.id }],
    });
    expect(res.status).toBe(200);
    expect(res.body.values[s.status.id]).toBe(s.doing.id);
    const col = await owner.post(`/api/databases/${s.d.id}/query`, {
      viewId: s.view.id,
      group: s.doing.id,
    });
    expect(col.body.rows.map((r: { id: string }) => r.id)).toEqual([b.id, a.id, c.id]);
    // In die leere Gruppe ziehen entfernt den Wert
    const empty = await owner.post(`/api/databases/${s.d.id}/rows/${c.id}/move`, {
      groups: [{ propertyId: s.status.id, from: s.doing.id, to: EMPTY_GROUP }],
    });
    expect(empty.body.values[s.status.id]).toBeUndefined();
  });

  it('verschiebt ein Datum in eine andere Woche und behält die Dauer', async () => {
    const s = await boardSetup();
    const r = await s.row('Urlaub', { [s.date.id]: { start: '2026-11-04', end: '2026-11-06' } });
    const res = await owner.post(`/api/databases/${s.d.id}/rows/${r.id}/move`, {
      groups: [{ propertyId: s.date.id, from: '2026-11-02', to: '2026-11-16' }],
      timeZone: 'Europe/Berlin',
    });
    expect(res.body.values[s.date.id]).toMatchObject({ start: '2026-11-16', end: '2026-11-18' });
  });

  it('lehnt unbekannte Optionen und schreibgeschützte Properties ab', async () => {
    const s = await boardSetup();
    const r = await s.row('A');
    const bad = await owner.post(`/api/databases/${s.d.id}/rows/${r.id}/move`, {
      groups: [{ propertyId: s.status.id, from: EMPTY_GROUP, to: crypto.randomUUID() }],
    });
    expect(bad.status).toBe(422);
    const created = s.d.properties.find((p: { type: string }) => p.type === 'title');
    const ro = (
      await owner.post(`/api/databases/${s.d.id}/properties`, {
        name: 'Von',
        type: 'created_by',
      })
    ).body;
    expect(created).toBeTruthy();
    const res = await owner.post(`/api/databases/${s.d.id}/rows/${r.id}/move`, {
      groups: [{ propertyId: ro.id, from: 'a', to: 'b' }],
    });
    expect(res.status).toBe(400);
  });

  it('zwei Clients ziehen gleichzeitig: beide Änderungen kommen an, Reihenfolge eindeutig', async () => {
    const s = await boardSetup();
    const rows = [];
    for (const t of ['A', 'B', 'C', 'D']) rows.push(await s.row(t, { [s.status.id]: s.todo.id }));
    const [a, b, c, d] = rows;
    // Beide legen eine Karte direkt hinter dieselbe Karte in "In Bearbeitung"
    const anchor = await s.row('Anker', { [s.status.id]: s.doing.id });
    const results = await Promise.all([
      owner.post(`/api/databases/${s.d.id}/rows/${a.id}/move`, {
        afterId: anchor.id,
        groups: [{ propertyId: s.status.id, from: s.todo.id, to: s.doing.id }],
      }),
      member.post(`/api/databases/${s.d.id}/rows/${b.id}/move`, {
        afterId: anchor.id,
        groups: [{ propertyId: s.status.id, from: s.todo.id, to: s.doing.id }],
      }),
      owner.post(`/api/databases/${s.d.id}/rows/${c.id}/move`, {
        beforeId: anchor.id,
        groups: [{ propertyId: s.status.id, from: s.todo.id, to: s.done.id }],
      }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const view = (c2: Client) =>
      c2.post(`/api/databases/${s.d.id}/query`, { viewId: s.view.id, group: s.doing.id });
    const [o, m] = await Promise.all([view(owner), view(member)]);
    const ids = o.body.rows.map((r: { id: string }) => r.id);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(anchor.id);
    expect(new Set(ids)).toEqual(new Set([anchor.id, a.id, b.id]));
    // Beide Clients sehen dieselbe Reihenfolge, Positionen sind eindeutig
    expect(m.body.rows.map((r: { id: string }) => r.id)).toEqual(ids);
    expect(new Set(o.body.rows.map((r: { position: string }) => r.position)).size).toBe(3);
    const counts = countsOf((await groups(member, s.d.id, s.view.id)).body);
    expect(counts).toEqual({ [s.todo.id]: 1, [s.doing.id]: 3, [s.done.id]: 1 });
    expect(d).toBeTruthy();
  });

  it('gleichzeitige Tag-Wechsel derselben Zeile verlieren keinen Wert', async () => {
    const s = await boardSetup();
    const cfg = (
      await owner.patch(`/api/databases/${s.d.id}/properties/${s.tags.id}`, {
        config: {
          options: ['a', 'b', 'c', 'd'].map((name) => ({ id: crypto.randomUUID(), name })),
        },
      })
    ).body.config.options as Option[];
    const [a, b, c, d] = cfg;
    const r = await s.row('X', { [s.tags.id]: [a!.id, b!.id] });
    await Promise.all([
      owner.post(`/api/databases/${s.d.id}/rows/${r.id}/move`, {
        groups: [{ propertyId: s.tags.id, from: a!.id, to: c!.id }],
      }),
      member.post(`/api/databases/${s.d.id}/rows/${r.id}/move`, {
        groups: [{ propertyId: s.tags.id, from: b!.id, to: d!.id }],
      }),
    ]);
    const row = (await owner.get(`/api/databases/${s.d.id}/rows/${r.id}`)).body;
    expect(new Set(row.values[s.tags.id])).toEqual(new Set([c!.id, d!.id]));
  });
});

describe('Kalender und Zeitleiste', () => {
  it('liefert Zeilen, deren Zeitraum das Fenster berührt', async () => {
    const s = await boardSetup();
    const cal = (
      await owner.post(`/api/databases/${s.d.id}/views`, { name: 'Kalender', type: 'calendar' })
    ).body;
    expect(cal.config.calendar).toMatchObject({ datePropertyId: s.date.id, mode: 'month' });
    const tl = (
      await owner.post(`/api/databases/${s.d.id}/views`, { name: 'Zeitleiste', type: 'timeline' })
    ).body;
    expect(tl.config.timeline).toMatchObject({ startPropertyId: s.date.id, zoom: 'week' });
    await s.row('davor', { [s.date.id]: { start: '2026-10-20', end: '2026-10-31' } });
    await s.row('über Monatsgrenze', { [s.date.id]: { start: '2026-10-28', end: '2026-11-02' } });
    await s.row('drin', { [s.date.id]: { start: '2026-11-15' } });
    await s.row('ohne Datum');
    const res = await owner.post(`/api/databases/${s.d.id}/query`, {
      viewId: cal.id,
      dateRange: { startPropertyId: s.date.id, from: '2026-11-01', to: '2026-11-30' },
    });
    expect(res.body.rows.map((r: { title: string }) => r.title).sort()).toEqual([
      'drin',
      'über Monatsgrenze',
    ]);
    const bad = await owner.post(`/api/databases/${s.d.id}/query`, {
      dateRange: { startPropertyId: s.status.id, from: '2026-11-01', to: '2026-11-30' },
    });
    expect(bad.status).toBe(400);
  });

  it('Layoutwechsel einer Ansicht behält Filter und ergänzt Standardwerte', async () => {
    const s = await boardSetup();
    const table = s.d.views[0];
    await owner.patch(`/api/databases/${s.d.id}/views/${table.id}`, {
      config: { sorts: [{ propertyId: s.date.id, direction: 'desc' }] },
    });
    const res = await owner.patch(`/api/databases/${s.d.id}/views/${table.id}`, {
      type: 'calendar',
    });
    expect(res.body).toMatchObject({
      type: 'calendar',
      config: { sorts: [{ propertyId: s.date.id }], calendar: { datePropertyId: s.date.id } },
    });
    expect(
      (await owner.patch(`/api/databases/${s.d.id}/views/${table.id}`, { type: 'chart' })).status,
    ).toBe(422);
  });
});

describe('Sperre', () => {
  it('gesperrte Datenbank: Ansichten fest, Karten weiter verschiebbar', async () => {
    const s = await boardSetup();
    const a = await s.row('A', { [s.status.id]: s.todo.id });
    await owner.patch(`/api/pages/${s.d.id}`, { settings: { locked: true } });
    expect((await owner.get(`/api/databases/${s.d.id}`)).body.locked).toBe(true);
    expect(
      (
        await member.patch(`/api/databases/${s.d.id}/views/${s.view.id}`, {
          config: { groupBy: null },
        })
      ).status,
    ).toBe(403);
    const moved = await member.post(`/api/databases/${s.d.id}/rows/${a.id}/move`, {
      groups: [{ propertyId: s.status.id, from: s.todo.id, to: s.done.id }],
    });
    expect(moved.status).toBe(200);
  });
});
