import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TemplatesService } from '../src/templates/templates.service';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/**
 * Phase 9: Vorlagen. Galerie mit mitgelieferten Vorlagen, eigene Vorlagen mit Datenbanken
 * (Kopie-Integrität: Relationen, Rollups, Ansichten zeigen auf die Kopien), Platzhalter,
 * Duplizieren mit Datenbanken, Zeilen-Vorlagen mit Standard, dynamischen Werten und Wiederholung.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let owner: Client;
let ws: string;

beforeAll(async () => {
  ({ app, db: prisma } = await createTestApp());
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

interface Prop {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
}
interface Db {
  id: string;
  title: string;
  properties: Prop[];
  views: { id: string; name: string; type: string; config: Record<string, unknown> }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = <T = any>(res: { status: number; body: unknown }, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as T;
};
const getDb = async (id: string): Promise<Db> => ok(await owner.get(`/api/databases/${id}`));
const rows = async (id: string) =>
  ok<{ rows: { id: string; title: string; values: Record<string, unknown> }[] }>(
    await owner.post(`/api/databases/${id}/query`, {}),
  ).rows;
const docText = async (pageId: string) =>
  JSON.stringify(ok(await owner.get(`/api/pages/${pageId}/content`)));
const dbIn = async (pageId: string) =>
  prisma.page.findMany({
    where: { parentId: pageId, kind: 'DATABASE', deletedAt: null },
    orderBy: { position: 'asc' },
  });

describe('Galerie und mitgelieferte Vorlagen', () => {
  it('listet sechs mitgelieferte Vorlagen und legt "Aufgaben" vollständig an', async () => {
    const gallery = ok<{ id: string; builtin: boolean; title: string }[]>(
      await owner.get(`/api/workspaces/${ws}/templates`),
    );
    expect(gallery.filter((t) => t.builtin).map((t) => t.title)).toEqual([
      'Aufgaben',
      'Stundenplan',
      'Hausaufgaben-Tracker',
      'Projekt-Roadmap',
      'Notizen',
      'Wiki',
    ]);
    const { id } = ok(
      await owner.post(`/api/workspaces/${ws}/templates/use`, {
        templateId: 'builtin:tasks',
        scope: 'TEAM',
      }),
      201,
    );
    const page = ok(await owner.get(`/api/pages/${id}`));
    expect(page).toMatchObject({
      title: 'Aufgaben',
      icon: { type: 'emoji', value: '✅' },
      scope: 'TEAM',
    });
    const [dbPage] = await dbIn(id);
    const db = await getDb(dbPage!.id);
    expect(db.properties.map((p) => p.name)).toEqual([
      'Aufgabe',
      'Status',
      'Fällig',
      'Priorität',
      'Erledigt am',
    ]);
    expect(db.views.map((v) => [v.name, v.type])).toEqual([
      ['Board', 'board'],
      ['Alle', 'table'],
      ['Kalender', 'calendar'],
    ]);
    const status = db.properties.find((p) => p.name === 'Status')!;
    expect(db.views[0]!.config.groupBy).toMatchObject({ propertyId: status.id });
    expect(db.views[2]!.config.calendar).toMatchObject({
      datePropertyId: db.properties.find((p) => p.name === 'Fällig')!.id,
    });
    expect(await rows(db.id)).toHaveLength(3);
    // Inhalt: Datenbank-Block zeigt auf die neue Datenbank, Platzhalter ersetzt
    const content = await docText(id);
    expect(content).toContain(db.id);
    expect(content).toContain('Olivia Owner');
    expect(content).not.toContain('@heute');
  });

  it('alle mitgelieferten Vorlagen lassen sich anlegen (auch auf Englisch)', async () => {
    for (const key of ['timetable', 'homework', 'roadmap', 'notes', 'wiki'])
      ok(
        await owner.post(`/api/workspaces/${ws}/templates/use`, { templateId: `builtin:${key}` }),
        201,
      );
    const wiki = (await prisma.page.findMany({ where: { title: 'Wiki', workspaceId: ws } }))[0]!;
    const children = await prisma.page.findMany({ where: { parentId: wiki.id } });
    expect(children.map((c) => c.title).sort()).toEqual(['Erste Schritte', 'Regeln und Abläufe']);
    expect(await docText(wiki.id)).toContain(children[0]!.id);
    const roadmap = (
      await prisma.page.findMany({ where: { title: 'Projekt-Roadmap', workspaceId: ws } })
    )[0]!;
    const [m] = await dbIn(roadmap.id);
    const db = await getDb(m!.id);
    expect(db.views[0]).toMatchObject({ type: 'timeline' });
  });
});

describe('Eigene Vorlagen', () => {
  async function projectPage() {
    const page = ok<{ id: string }>(
      await owner.post(`/api/workspaces/${ws}/pages`, { title: 'Projekt @heute', scope: 'TEAM' }),
      201,
    );
    const tasks = ok<Db>(
      await owner.post(`/api/workspaces/${ws}/databases`, {
        parentId: page.id,
        title: 'Aufgaben',
        inline: true,
      }),
      201,
    );
    const points = ok<Prop>(
      await owner.post(`/api/databases/${tasks.id}/properties`, { name: 'Punkte', type: 'number' }),
      201,
    );
    const phases = ok<Db>(
      await owner.post(`/api/workspaces/${ws}/databases`, {
        parentId: page.id,
        title: 'Phasen',
        inline: true,
      }),
      201,
    );
    const rel = ok<Prop>(
      await owner.post(`/api/databases/${phases.id}/properties`, {
        name: 'Aufgaben',
        type: 'relation',
        config: { targetDatabaseId: tasks.id, twoWay: true, reverseName: 'Phase' },
      }),
      201,
    );
    const sum = ok<Prop>(
      await owner.post(`/api/databases/${phases.id}/properties`, {
        name: 'Summe',
        type: 'rollup',
        config: { relationPropertyId: rel.id, targetPropertyId: points.id, aggregation: 'sum' },
      }),
      201,
    );
    const t1 = ok(
      await owner.post(`/api/databases/${tasks.id}/rows`, {
        title: 'Planen',
        values: { [points.id]: 2 },
      }),
      201,
    );
    const t2 = ok(
      await owner.post(`/api/databases/${tasks.id}/rows`, {
        title: 'Bauen',
        values: { [points.id]: 5 },
      }),
      201,
    );
    ok(
      await owner.post(`/api/databases/${phases.id}/rows`, {
        title: 'Start',
        values: { [rel.id]: [t1.id, t2.id] },
      }),
      201,
    );
    // Ansicht mit Filter auf ein Property: Verweis muss in der Kopie auf die neue Spalte zeigen
    const view = (await getDb(tasks.id)).views[0]!;
    ok(
      await owner.patch(`/api/databases/${tasks.id}/views/${view.id}`, {
        config: { sorts: [{ propertyId: points.id, direction: 'desc' }] },
      }),
    );
    return { page, tasks, phases, rel, sum, points };
  }

  it('Kopie-Integrität: Relationen, Rollups, Ansichten und Inhalt zeigen auf die Kopien', async () => {
    const s = await projectPage();
    expect(ok(await owner.put(`/api/pages/${s.page.id}/template`, { isTemplate: true }))).toEqual({
      isTemplate: true,
    });
    const gallery = ok<{ id: string; builtin: boolean }[]>(
      await owner.get(`/api/workspaces/${ws}/templates`),
    );
    expect(gallery.find((t) => !t.builtin)?.id).toBe(s.page.id);

    const { id } = ok(
      await owner.post(`/api/workspaces/${ws}/templates/use`, { templateId: s.page.id }),
      201,
    );
    const copy = ok(await owner.get(`/api/pages/${id}`));
    expect(copy.isTemplate).toBe(false);
    expect(copy.title).toBe('Projekt @heute');
    const dbs = await dbIn(id);
    expect(dbs.map((d) => d.title)).toEqual(['Aufgaben', 'Phasen']);
    const [tasks, phases] = await Promise.all(dbs.map((d) => getDb(d.id)));
    // Neue IDs für Datenbanken und Properties
    expect(tasks!.id).not.toBe(s.tasks.id);
    const rel = phases!.properties.find((p) => p.name === 'Aufgaben')!;
    const reverse = tasks!.properties.find((p) => p.name === 'Phase')!;
    const points = tasks!.properties.find((p) => p.name === 'Punkte')!;
    const sum = phases!.properties.find((p) => p.name === 'Summe')!;
    expect(rel.config).toMatchObject({
      targetDatabaseId: tasks!.id,
      reversePropertyId: reverse.id,
    });
    expect(reverse.config).toMatchObject({
      targetDatabaseId: phases!.id,
      reversePropertyId: rel.id,
    });
    expect(sum.config).toMatchObject({ relationPropertyId: rel.id, targetPropertyId: points.id });
    expect(tasks!.views[0]!.config.sorts).toEqual([{ propertyId: points.id, direction: 'desc' }]);
    // Verknüpfungen zeigen auf kopierte Zeilen, Rollup stimmt
    const taskRows = await rows(tasks!.id);
    const [start] = await rows(phases!.id);
    expect((start!.values[rel.id] as string[]).sort()).toEqual(taskRows.map((r) => r.id).sort());
    expect(start!.values[sum.id]).toBe(7);
    expect(taskRows.every((r) => (r.values[reverse.id] as string[])[0] === start!.id)).toBe(true);
    // Inhalt der Kopie zeigt auf die kopierten Datenbanken, nicht auf die Originale
    const content = await docText(id);
    expect(content).not.toContain(s.tasks.id);

    // Original unverändert; Änderung in der Kopie wirkt nicht aufs Original
    ok(
      await owner.patch(`/api/databases/${tasks!.id}/rows/${taskRows[0]!.id}/properties`, {
        values: { [points.id]: 100 },
      }),
    );
    const [origStart] = await rows(s.phases.id);
    expect(origStart!.values[s.sum.id]).toBe(7);
  });

  it('Duplizieren kopiert Datenbanken mit Zeilen', async () => {
    const s = await projectPage();
    const dup = ok(await owner.post(`/api/pages/${s.page.id}/duplicate`), 201);
    expect(dup.pages).toBe(1 + 2 + 2 + 1);
    const dbs = await dbIn(dup.id);
    expect(await rows(dbs[0]!.id)).toHaveLength(2);
    // Zeilen erscheinen nicht als Seiten im Baum
    const children = ok<unknown[]>(await owner.get(`/api/pages/${dup.id}/children`));
    expect(children).toHaveLength(2);
  });
});

describe('Zeilen-Vorlagen', () => {
  async function setup() {
    const db = ok<Db>(
      await owner.post(`/api/workspaces/${ws}/databases`, { title: 'Aufgaben', scope: 'TEAM' }),
      201,
    );
    const status = ok<Prop>(
      await owner.post(`/api/databases/${db.id}/properties`, { name: 'Status', type: 'status' }),
      201,
    );
    const date = ok<Prop>(
      await owner.post(`/api/databases/${db.id}/properties`, { name: 'Datum', type: 'date' }),
      201,
    );
    const who = ok<Prop>(
      await owner.post(`/api/databases/${db.id}/properties`, { name: 'Wer', type: 'person' }),
      201,
    );
    const nr = ok<Prop>(
      await owner.post(`/api/databases/${db.id}/properties`, { name: 'Nr', type: 'unique_id' }),
      201,
    );
    return {
      db,
      status,
      date,
      who,
      nr,
      inProgress: (status.config.options as { id: string }[])[1]!.id,
    };
  }

  it('Vorlage mit Werten, dynamischem Datum, Standard und "ohne Vorlage"', async () => {
    const s = await setup();
    const tpl = ok(
      await owner.post(`/api/databases/${s.db.id}/templates`, { title: 'Wochenbericht' }),
      201,
    );
    // Werte und Titel der Vorlage über die Zeilen-API
    ok(
      await owner.patch(`/api/databases/${s.db.id}/rows/${tpl.id}/properties`, {
        title: 'Bericht @heute',
        values: { [s.status.id]: s.inProgress },
      }),
    );
    await prisma.page.update({
      where: { id: tpl.id },
      data: { settings: { dynamic: { [s.date.id]: 'today', [s.who.id]: 'creator' } } },
    });
    // Vorlagen erscheinen nicht in Abfragen
    expect(await rows(s.db.id)).toHaveLength(0);

    const r1 = ok(await owner.post(`/api/databases/${s.db.id}/rows`, { templateId: tpl.id }), 201);
    expect(r1.title).toMatch(/^Bericht \d{1,2}\.\d{1,2}\.\d{4}$/);
    expect(r1.values[s.status.id]).toBe(s.inProgress);
    expect(r1.values[s.date.id]).toMatchObject({ hasTime: false });
    expect(r1.values[s.who.id]).toHaveLength(1);
    expect(r1.values[s.nr.id]).toBe(1);

    // Standardvorlage greift ohne Angabe; "none" verhindert das
    ok(await owner.patch(`/api/databases/${s.db.id}/templates/${tpl.id}`, { isDefault: true }));
    const r2 = ok(
      await owner.post(`/api/databases/${s.db.id}/rows`, { title: 'Eigener Titel' }),
      201,
    );
    expect(r2.title).toBe('Eigener Titel');
    expect(r2.values[s.status.id]).toBe(s.inProgress);
    expect(r2.values[s.nr.id]).toBe(2);
    const r3 = ok(
      await owner.post(`/api/databases/${s.db.id}/rows`, { title: 'Leer', templateId: 'none' }),
      201,
    );
    expect(r3.values[s.status.id]).toBeUndefined();

    const list = ok(await owner.get(`/api/databases/${s.db.id}/templates`));
    expect(list).toMatchObject([{ id: tpl.id, title: 'Bericht @heute', isDefault: true }]);
    // Bestehende Zeile als Vorlage
    const fromRow = ok(
      await owner.post(`/api/databases/${s.db.id}/templates`, {
        fromRowId: r3.id,
        title: 'Aus Zeile',
      }),
      201,
    );
    expect(fromRow.title).toBe('Aus Zeile');
    ok(await owner.del(`/api/databases/${s.db.id}/templates/${fromRow.id}`), 204);
    expect(ok<unknown[]>(await owner.get(`/api/databases/${s.db.id}/templates`))).toHaveLength(1);
    expect(await rows(s.db.id)).toHaveLength(3);
  });

  it('Wiederholung legt zur Zeit eine Zeile an und schaltet weiter', async () => {
    const s = await setup();
    const tpl = ok(
      await owner.post(`/api/databases/${s.db.id}/templates`, { title: 'Tagesplan' }),
      201,
    );
    const upd = ok(
      await owner.patch(`/api/databases/${s.db.id}/templates/${tpl.id}`, {
        recurrence: { every: 'day', time: '07:00' },
      }),
    );
    expect(upd.recurrence).toMatchObject({ every: 'day', time: '07:00' });
    const next = Date.parse(upd.nextRunAt);
    expect(next).toBeGreaterThan(Date.now());
    const svc = app.get(TemplatesService);
    expect(await svc.runDueRecurring(next - 1000)).toBe(0);
    expect(await svc.runDueRecurring(next + 1000)).toBe(1);
    expect((await rows(s.db.id)).map((r) => r.title)).toEqual(['Tagesplan']);
    const after = await prisma.dbTemplate.findUniqueOrThrow({ where: { pageId: tpl.id } });
    expect(after.nextRunAt!.getTime() - next).toBe(86_400_000);
    // Gleicher Zeitpunkt noch einmal: nichts
    expect(await svc.runDueRecurring(next + 1000)).toBe(0);
  });

  it('andere sehen private Vorlagen nicht', async () => {
    const priv = ok(await owner.post(`/api/workspaces/${ws}/pages`, { title: 'Geheim' }), 201);
    ok(await owner.put(`/api/pages/${priv.id}/template`, { isTemplate: true }));
    const member = (await addMember(app, owner, ws, 'm@test.local')).client;
    const gallery = ok<{ id: string }[]>(await member.get(`/api/workspaces/${ws}/templates`));
    expect(gallery.some((t) => t.id === priv.id)).toBe(false);
    expect(
      (await member.post(`/api/workspaces/${ws}/templates/use`, { templateId: priv.id })).status,
    ).toBe(404);
  });
});
