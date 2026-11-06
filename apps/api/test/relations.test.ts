import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/**
 * Phase 6: Relationen (ein- und zweiseitig, Limit, Rechte), Rollups, Formeln über die API,
 * Weiterreichen über zwei Relationsebenen, Zyklen, Filter und Sortierung auf Ergebnissen.
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

interface Db {
  id: string;
  properties: { id: string; name: string; type: string; config: Record<string, unknown> }[];
}

const createDb = async (title: string, scope = 'TEAM', c = owner): Promise<Db> =>
  (await c.post(`/api/workspaces/${ws}/databases`, { scope, title })).body;
const getDb = async (id: string): Promise<Db> => (await owner.get(`/api/databases/${id}`)).body;
const prop = async (dbId: string, body: object, status = 201) => {
  const res = await owner.post(`/api/databases/${dbId}/properties`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const row = async (dbId: string, title: string, values: object = {}) => {
  const res = await owner.post(`/api/databases/${dbId}/rows`, { title, values });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
};
const setValues = (dbId: string, rowId: string, values: object) =>
  owner.patch(`/api/databases/${dbId}/rows/${rowId}/properties`, { values });
const getRow = async (dbId: string, rowId: string) =>
  (await owner.get(`/api/databases/${dbId}/rows/${rowId}`)).body;
const query = async (dbId: string, body: object = {}) =>
  (await owner.post(`/api/databases/${dbId}/query`, body)).body;

/** Projekte und Aufgaben, Projekte mit zweiseitiger Relation auf Aufgaben. */
async function projectsAndTasks() {
  const tasks = await createDb('Aufgaben');
  const points = await prop(tasks.id, { name: 'Punkte', type: 'number' });
  const done = await prop(tasks.id, { name: 'Fertig', type: 'checkbox' });
  const due = await prop(tasks.id, { name: 'Fällig', type: 'date' });
  const projects = await createDb('Projekte');
  const rel = await prop(projects.id, {
    name: 'Aufgaben',
    type: 'relation',
    config: { targetDatabaseId: tasks.id, twoWay: true, reverseName: 'Projekt' },
  });
  const t1 = await row(tasks.id, 'Einkaufen', {
    [points.id]: 3,
    [done.id]: true,
    [due.id]: { start: '2026-11-10' },
  });
  const t2 = await row(tasks.id, 'Steuer', { [points.id]: 5, [due.id]: { start: '2026-11-04' } });
  const t3 = await row(tasks.id, 'Urlaub', { [points.id]: 8, [done.id]: true });
  const p1 = await row(projects.id, 'Haushalt', { [rel.id]: [t1.id, t2.id] });
  const p2 = await row(projects.id, 'Reise', { [rel.id]: [t3.id] });
  return { tasks, projects, points, done, due, rel, t1, t2, t3, p1, p2 };
}

describe('Relationen', () => {
  it('zweiseitig: Gegen-Property wird angelegt und gespiegelt', async () => {
    const s = await projectsAndTasks();
    expect(s.rel.config).toMatchObject({
      targetDatabaseId: s.tasks.id,
      twoWay: true,
      limit: 'many',
    });
    const tasks = await getDb(s.tasks.id);
    const reverse = tasks.properties.find((p) => p.name === 'Projekt')!;
    expect(reverse).toMatchObject({
      type: 'relation',
      config: { targetDatabaseId: s.projects.id, reversePropertyId: s.rel.id },
    });
    expect(
      s.rel.config.reversePropertyId ??
        (await getDb(s.projects.id)).properties.find((p) => p.id === s.rel.id)!.config
          .reversePropertyId,
    ).toBe(reverse.id);

    const p1 = await getRow(s.projects.id, s.p1.id);
    expect(p1.values[s.rel.id]).toEqual([s.t1.id, s.t2.id]);
    expect(p1.refs[s.t1.id]).toMatchObject({ title: 'Einkaufen' });
    expect((await getRow(s.tasks.id, s.t2.id)).values[reverse.id]).toEqual([s.p1.id]);

    // Umhängen: Steuer wandert von Haushalt zu Reise
    await setValues(s.projects.id, s.p1.id, { [s.rel.id]: [s.t1.id] });
    await setValues(s.projects.id, s.p2.id, { [s.rel.id]: [s.t3.id, s.t2.id] });
    expect((await getRow(s.tasks.id, s.t2.id)).values[reverse.id]).toEqual([s.p2.id]);
    // Von der Gegenseite setzen wirkt auch vorwärts
    await setValues(s.tasks.id, s.t1.id, { [reverse.id]: [s.p1.id, s.p2.id] });
    expect((await getRow(s.projects.id, s.p2.id)).values[s.rel.id]).toEqual(
      expect.arrayContaining([s.t1.id, s.t2.id, s.t3.id]),
    );

    // Löschen entfernt beide Seiten
    expect((await owner.del(`/api/databases/${s.projects.id}/properties/${s.rel.id}`)).status).toBe(
      204,
    );
    expect((await getDb(s.tasks.id)).properties.some((p) => p.id === reverse.id)).toBe(false);
  });

  it('filtert nach Relation, prüft Limit und Zieldatenbank', async () => {
    const s = await projectsAndTasks();
    const contains = await query(s.projects.id, {
      filter: {
        type: 'group',
        op: 'and',
        children: [{ propertyId: s.rel.id, operator: 'contains', value: s.t3.id }],
      },
    });
    expect(contains.rows.map((r: { title: string }) => r.title)).toEqual(['Reise']);
    const p3 = await row(s.projects.id, 'Leer');
    const empty = await query(s.projects.id, {
      filter: {
        type: 'group',
        op: 'and',
        children: [{ propertyId: s.rel.id, operator: 'is_empty' }],
      },
    });
    expect(empty.rows.map((r: { id: string }) => r.id)).toEqual([p3.id]);

    const one = await prop(s.projects.id, {
      name: 'Hauptaufgabe',
      type: 'relation',
      config: { targetDatabaseId: s.tasks.id, limit: 'one' },
    });
    expect((await setValues(s.projects.id, p3.id, { [one.id]: [s.t1.id, s.t2.id] })).status).toBe(
      422,
    );
    expect((await setValues(s.projects.id, p3.id, { [one.id]: [s.p1.id] })).status).toBe(422);
    expect((await setValues(s.projects.id, p3.id, { [one.id]: [s.t1.id] })).status).toBe(200);
    // Einseitig: keine Gegen-Property
    expect((await getDb(s.tasks.id)).properties.filter((p) => p.type === 'relation')).toHaveLength(
      1,
    );
  });

  it('Selbstrelation, gelöschte Zeilen und Rechte', async () => {
    const d = await createDb('Personen');
    const rel = await prop(d.id, {
      name: 'Kennt',
      type: 'relation',
      config: { targetDatabaseId: d.id, twoWay: true, reverseName: 'Bekannt mit' },
    });
    const a = await row(d.id, 'Anna');
    const b = await row(d.id, 'Bert', { [rel.id]: [a.id] });
    const reverse = (await getDb(d.id)).properties.find((p) => p.name === 'Bekannt mit')!;
    expect((await getRow(d.id, a.id)).values[reverse.id]).toEqual([b.id]);
    // Zeile im Papierkorb verschwindet aus der Relation, Wiederherstellen bringt sie zurück
    await owner.post(`/api/databases/${d.id}/rows/trash`, { rowIds: [a.id] });
    expect((await getRow(d.id, b.id)).values[rel.id]).toBeUndefined();
    await owner.post(`/api/pages/${a.id}/restore`);
    expect((await getRow(d.id, b.id)).values[rel.id]).toEqual([a.id]);

    // Teamdatenbank darf nicht auf private zeigen; fremde private ist unsichtbar
    const priv = await createDb('Geheim', 'PRIVATE');
    await prop(d.id, { name: 'X', type: 'relation', config: { targetDatabaseId: priv.id } }, 422);
    const otherPriv = await createDb('Fremd', 'PRIVATE', member);
    const mine = await createDb('Meins', 'PRIVATE');
    await prop(
      mine.id,
      { name: 'Y', type: 'relation', config: { targetDatabaseId: otherPriv.id } },
      422,
    );
    await prop(mine.id, { name: 'Z', type: 'relation', config: { targetDatabaseId: d.id } }, 201);
  });
});

describe('Rollups', () => {
  it('rechnet Summe, Anzahl, Prozent, Datum und Liste und bleibt aktuell', async () => {
    const s = await projectsAndTasks();
    const r = (name: string, targetPropertyId: string, aggregation: string) =>
      prop(s.projects.id, {
        name,
        type: 'rollup',
        config: { relationPropertyId: s.rel.id, targetPropertyId, aggregation },
      });
    const title = s.tasks.properties.find((p) => p.type === 'title')!;
    const sum = await r('Summe', s.points.id, 'sum');
    const count = await r('Anzahl', title.id, 'count_all');
    const pct = await r('Erledigt %', s.done.id, 'percent_checked');
    const first = await r('Nächste', s.due.id, 'earliest_date');
    const names = await r('Namen', title.id, 'show_original');
    expect(sum.config.resultType).toBe('number');
    expect(first.config.resultType).toBe('date');
    expect(names.config.resultType).toBe('list');

    let p1 = await getRow(s.projects.id, s.p1.id);
    expect(p1.values[sum.id]).toBe(8);
    expect(p1.values[count.id]).toBe(2);
    expect(p1.values[pct.id]).toBe(50);
    expect(p1.values[first.id]).toMatchObject({ start: '2026-11-04' });
    expect(p1.values[names.id]).toEqual(['Einkaufen', 'Steuer']);

    // Wert in der Zieldatenbank ändern: Rollup folgt
    await setValues(s.tasks.id, s.t2.id, { [s.points.id]: 10, [s.done.id]: true });
    p1 = await getRow(s.projects.id, s.p1.id);
    expect(p1.values[sum.id]).toBe(13);
    expect(p1.values[pct.id]).toBe(100);
    // Verknüpfung über die Gegenseite entfernen
    const reverse = (await getDb(s.tasks.id)).properties.find((p) => p.name === 'Projekt')!;
    await setValues(s.tasks.id, s.t1.id, { [reverse.id]: [] });
    p1 = await getRow(s.projects.id, s.p1.id);
    expect(p1.values[sum.id]).toBe(10);
    expect(p1.values[count.id]).toBe(1);
    // Zeile in den Papierkorb
    await owner.post(`/api/databases/${s.tasks.id}/rows/trash`, { rowIds: [s.t2.id] });
    p1 = await getRow(s.projects.id, s.p1.id);
    expect(p1.values[sum.id]).toBeUndefined();
    expect(p1.values[count.id]).toBe(0);

    // Sortieren und filtern nach Rollup
    const sorted = await query(s.projects.id, {
      sorts: [{ propertyId: count.id, direction: 'desc' }],
    });
    expect(sorted.rows.map((x: { title: string }) => x.title)).toEqual(['Reise', 'Haushalt']);
    const filtered = await query(s.projects.id, {
      filter: {
        type: 'group',
        op: 'and',
        children: [{ propertyId: count.id, operator: 'greater_than', value: 0 }],
      },
    });
    expect(filtered.rows.map((x: { title: string }) => x.title)).toEqual(['Reise']);
  });

  it('lehnt unpassende Konfigurationen ab', async () => {
    const s = await projectsAndTasks();
    await prop(
      s.projects.id,
      {
        name: 'X',
        type: 'rollup',
        config: {
          relationPropertyId: s.points.id,
          targetPropertyId: s.points.id,
          aggregation: 'sum',
        },
      },
      422,
    );
    await prop(
      s.projects.id,
      {
        name: 'X',
        type: 'rollup',
        config: { relationPropertyId: s.rel.id, targetPropertyId: s.done.id, aggregation: 'sum' },
      },
      422,
    );
  });
});

describe('Formeln', () => {
  it('rechnet, kennt Ergebnistypen, folgt Änderungen und Umbenennungen', async () => {
    const d = await createDb('Rechnungen');
    const net = await prop(d.id, { name: 'Netto', type: 'number' });
    const qty = await prop(d.id, { name: 'Menge', type: 'number' });
    const gross = await prop(d.id, {
      name: 'Brutto',
      type: 'formula',
      config: { expression: 'round(prop("Netto") * prop("Menge") * 1.19, 2)' },
    });
    expect(gross.config).toMatchObject({ resultType: 'number', error: null, volatile: false });
    const label = await prop(d.id, {
      name: 'Text',
      type: 'formula',
      config: { expression: 'prop("Name") + ": " + format(prop("Brutto")) + " €"' },
    });
    expect(label.config.resultType).toBe('text');
    const big = await prop(d.id, {
      name: 'Groß',
      type: 'formula',
      config: { expression: 'prop("Brutto") > 100' },
    });
    expect(big.config.resultType).toBe('boolean');

    const a = await row(d.id, 'Laptop', { [net.id]: 100, [qty.id]: 2 });
    const b = await row(d.id, 'Maus', { [net.id]: 10, [qty.id]: 1 });
    let ra = await getRow(d.id, a.id);
    expect(ra.values[gross.id]).toBe(238);
    expect(ra.values[label.id]).toBe('Laptop: 238 €');
    expect(ra.values[big.id]).toBe(true);
    expect((await getRow(d.id, b.id)).values[big.id]).toBe(false);

    await setValues(d.id, a.id, { [qty.id]: 3 });
    ra = await getRow(d.id, a.id);
    expect(ra.values[gross.id]).toBe(357);

    // Filter auf Wahrheitswert und Sortierung nach Zahl
    const f = await query(d.id, {
      filter: {
        type: 'group',
        op: 'and',
        children: [{ propertyId: big.id, operator: 'is', value: false }],
      },
    });
    expect(f.rows.map((r: { title: string }) => r.title)).toEqual(['Maus']);
    const sorted = await query(d.id, { sorts: [{ propertyId: gross.id, direction: 'asc' }] });
    expect(sorted.rows.map((r: { title: string }) => r.title)).toEqual(['Maus', 'Laptop']);

    // Umbenennen passt die Formeln an
    await owner.patch(`/api/databases/${d.id}/properties/${net.id}`, { name: 'Preis' });
    const after = await getDb(d.id);
    expect(after.properties.find((p) => p.id === gross.id)!.config.expression).toBe(
      'round(prop("Preis") * prop("Menge") * 1.19, 2)',
    );
    expect((await getRow(d.id, a.id)).values[gross.id]).toBe(357);

    // Formel ändern: alle Zeilen neu berechnet
    await owner.patch(`/api/databases/${d.id}/properties/${gross.id}`, {
      config: { expression: 'prop("Preis") * prop("Menge")' },
    });
    expect((await getRow(d.id, a.id)).values[gross.id]).toBe(300);
    expect((await getRow(d.id, a.id)).values[label.id]).toBe('Laptop: 300 €');

    // Gelöschtes Property: Formel wird als fehlerhaft markiert
    await owner.del(`/api/databases/${d.id}/properties/${qty.id}`);
    const broken = (await getDb(d.id)).properties.find((p) => p.id === gross.id)!;
    expect(broken.config.error).toMatch(/Unbekanntes Property "Menge"/);
    expect((await getRow(d.id, a.id)).values[gross.id]).toBeUndefined();
  });

  it('meldet Fehler mit Position und verhindert Zyklen', async () => {
    const d = await createDb('Zyklen');
    const res = await owner.post(`/api/databases/${d.id}/properties`, {
      name: 'Kaputt',
      type: 'formula',
      config: { expression: 'upper(1 + )' },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details.formula).toMatchObject({ start: 10 });
    const a = await prop(d.id, { name: 'A', type: 'formula', config: { expression: '1' } });
    const b = await prop(d.id, {
      name: 'B',
      type: 'formula',
      config: { expression: 'prop("A") + 1' },
    });
    const cyc = await owner.patch(`/api/databases/${d.id}/properties/${a.id}`, {
      config: { expression: 'prop("B") + 1' },
    });
    expect(cyc.status).toBe(422);
    expect(cyc.body.error.message).toMatch(/auf sich selbst/);
    const r = await row(d.id, 'x');
    expect((await getRow(d.id, r.id)).values[b.id]).toBe(2);
  });

  it('greift über Relationen auf Properties verknüpfter Zeilen zu', async () => {
    const s = await projectsAndTasks();
    const f = await prop(s.projects.id, {
      name: 'Offene Punkte',
      type: 'formula',
      config: {
        expression:
          'prop("Aufgaben").filter(!current.prop("Fertig")).map(current.prop("Punkte")).sum()',
      },
    });
    const names = await prop(s.projects.id, {
      name: 'Liste',
      type: 'formula',
      config: { expression: 'prop("Aufgaben").map(current.prop("Name")).join(", ")' },
    });
    expect((await getRow(s.projects.id, s.p1.id)).values[f.id]).toBe(5);
    expect((await getRow(s.projects.id, s.p1.id)).values[names.id]).toBe('Einkaufen, Steuer');
    await setValues(s.tasks.id, s.t2.id, { [s.done.id]: true });
    expect((await getRow(s.projects.id, s.p1.id)).values[f.id]).toBeUndefined();
    await owner.patch(`/api/databases/${s.tasks.id}/rows/${s.t1.id}/properties`, {
      title: 'Großeinkauf',
    });
    expect((await getRow(s.projects.id, s.p1.id)).values[names.id]).toBe('Großeinkauf, Steuer');
  });
});

describe('Weiterreichen über Relationen', () => {
  it('über zwei Ebenen und ohne Endlosschleife bei Zyklen', async () => {
    // Firma -> Projekte -> Aufgaben: Firma summiert die Projektsummen
    const s = await projectsAndTasks();
    const sum = await prop(s.projects.id, {
      name: 'Summe',
      type: 'rollup',
      config: { relationPropertyId: s.rel.id, targetPropertyId: s.points.id, aggregation: 'sum' },
    });
    const companies = await createDb('Firmen');
    const crel = await prop(companies.id, {
      name: 'Projekte',
      type: 'relation',
      config: { targetDatabaseId: s.projects.id, twoWay: true, reverseName: 'Firma' },
    });
    const total = await prop(companies.id, {
      name: 'Gesamt',
      type: 'rollup',
      config: { relationPropertyId: crel.id, targetPropertyId: sum.id, aggregation: 'sum' },
    });
    const c = await row(companies.id, 'Jotion GmbH', { [crel.id]: [s.p1.id, s.p2.id] });
    expect((await getRow(companies.id, c.id)).values[total.id]).toBe(16);
    // Aufgabe ändern: Projekt und Firma folgen
    await setValues(s.tasks.id, s.t3.id, { [s.points.id]: 20 });
    expect((await getRow(s.projects.id, s.p2.id)).values[sum.id]).toBe(20);
    expect((await getRow(companies.id, c.id)).values[total.id]).toBe(28);

    // Zyklus: Aufgaben zählen die Firmen-Summe ihres Projekts zurück
    const reverse = (await getDb(s.tasks.id)).properties.find((p) => p.name === 'Projekt')!;
    const back = await prop(s.tasks.id, {
      name: 'Projektsumme',
      type: 'rollup',
      config: { relationPropertyId: reverse.id, targetPropertyId: sum.id, aggregation: 'max' },
    });
    const t0 = Date.now();
    await setValues(s.tasks.id, s.t1.id, { [s.points.id]: 4 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect((await getRow(s.tasks.id, s.t1.id)).values[back.id]).toBe(9);
    expect((await getRow(companies.id, c.id)).values[total.id]).toBe(29);
  });
});
