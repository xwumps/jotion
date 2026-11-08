import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { EMPTY_GROUP } from '@jotion/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/**
 * Phase 7: Diagramme (Aggregation, Zeitraum, KPI mit Vorzeitraum, Drilldown, Cache),
 * Dashboard (persönlich und geteilt) und Agenda über mehrere Datenbanken.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let owner: Client;
let member: Client;
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
  member = (await addMember(app, owner, ws, 'member@test.local')).client;
});

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayOffset = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

async function sales() {
  const d = (
    await owner.post(`/api/workspaces/${ws}/databases`, { scope: 'TEAM', title: 'Verkäufe' })
  ).body;
  const amount = (
    await owner.post(`/api/databases/${d.id}/properties`, { name: 'Betrag', type: 'number' })
  ).body;
  const date = (
    await owner.post(`/api/databases/${d.id}/properties`, { name: 'Datum', type: 'date' })
  ).body;
  const status = (
    await owner.post(`/api/databases/${d.id}/properties`, { name: 'Status', type: 'status' })
  ).body;
  const [todo, doing, done] = status.config.options as { id: string }[];
  const rows: { id: string }[] = [];
  const add = async (title: string, betrag: number, tage: number, st: { id: string } | null) =>
    rows.push(
      (
        await owner.post(`/api/databases/${d.id}/rows`, {
          title,
          values: {
            [amount.id]: betrag,
            [date.id]: { start: dayOffset(tage) },
            ...(st ? { [status.id]: st.id } : {}),
          },
        })
      ).body,
    );
  await add('A', 10, -1, todo!);
  await add('B', 20, -2, todo!);
  await add('C', 5, -3, done!);
  await add('D', 7, -40, doing!);
  await add('E', 100, -45, null);
  const view = (await owner.post(`/api/databases/${d.id}/views`, { name: 'Chart', type: 'chart' }))
    .body;
  const setChart = (chart: object) =>
    owner.patch(`/api/databases/${d.id}/views/${view.id}`, { config: { chart } });
  const data = async () =>
    (await owner.post(`/api/databases/${d.id}/chart`, { viewId: view.id, timeZone: 'UTC' })).body;
  return {
    d,
    amount,
    date,
    status,
    todo: todo!,
    doing: doing!,
    done: done!,
    rows,
    view,
    setChart,
    data,
  };
}

const byKey = (points: { x: string; series: string; value: number }[]) =>
  Object.fromEntries(points.map((p) => [p.series ? `${p.x}/${p.series}` : p.x, p.value]));

describe('Diagramme', () => {
  it('summiert je Status, zählt je Monat, bildet Serien', async () => {
    const s = await sales();
    expect(s.view.type).toBe('chart');
    await s.setChart({
      type: 'bar',
      x: { propertyId: s.status.id },
      y: { measure: 'sum', propertyId: s.amount.id },
    });
    let data = await s.data();
    expect(byKey(data.points)).toEqual({
      [s.todo.id]: 30,
      [s.done.id]: 5,
      [s.doing.id]: 7,
      [EMPTY_GROUP]: 100,
    });
    expect(data.total).toBe(142);

    await s.setChart({
      type: 'bar',
      x: { propertyId: s.status.id },
      y: { measure: 'count' },
      series: { propertyId: s.date.id, dateBucket: 'year' },
    });
    data = await s.data();
    expect(data.points.reduce((n: number, p: { value: number }) => n + p.value, 0)).toBe(5);

    await s.setChart({
      type: 'line',
      x: { propertyId: s.date.id, dateBucket: 'day' },
      y: { measure: 'average', propertyId: s.amount.id },
    });
    data = await s.data();
    expect(data.points[0].x).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('Zeitraum, KPI mit Vorzeitraum und Verlauf', async () => {
    const s = await sales();
    await s.setChart({
      type: 'kpi',
      y: { measure: 'sum', propertyId: s.amount.id },
      dateFilter: { propertyId: s.date.id, range: 'last_30_days' },
      compare: true,
    });
    const data = await s.data();
    expect(data.total).toBe(35);
    expect(data.previous).toBe(107);
    expect(data.range).toEqual({ from: dayOffset(-29), to: dayOffset(0) });
    expect(data.spark.reduce((n: number, p: { value: number }) => n + p.value, 0)).toBe(35);
  });

  it('Drilldown liefert die Zeilen eines Punkts, Cache folgt Änderungen', async () => {
    const s = await sales();
    await s.setChart({ type: 'pie', x: { propertyId: s.status.id }, y: { measure: 'count' } });
    expect(byKey((await s.data()).points)[s.todo.id]).toBe(2);
    const drill = await owner.post(`/api/databases/${s.d.id}/query`, {
      viewId: s.view.id,
      chartPoint: { x: s.todo.id },
    });
    expect(drill.body.rows.map((r: { title: string }) => r.title).sort()).toEqual(['A', 'B']);
    // Änderung macht den Cache ungültig
    await owner.patch(`/api/databases/${s.d.id}/rows/${s.rows[2]!.id}/properties`, {
      values: { [s.status.id]: s.todo.id },
    });
    expect(byKey((await s.data()).points)[s.todo.id]).toBe(3);
  });

  it('prüft Rechte und Konfiguration', async () => {
    const s = await sales();
    await s.setChart({
      type: 'bar',
      x: { propertyId: s.status.id },
      y: { measure: 'sum', propertyId: s.status.id },
    });
    expect((await owner.post(`/api/databases/${s.d.id}/chart`, { viewId: s.view.id })).status).toBe(
      422,
    );
    const priv = (
      await owner.post(`/api/workspaces/${ws}/databases`, { scope: 'PRIVATE', title: 'Privat' })
    ).body;
    const pv = (await owner.post(`/api/databases/${priv.id}/views`, { name: 'C', type: 'chart' }))
      .body;
    expect((await member.post(`/api/databases/${priv.id}/chart`, { viewId: pv.id })).status).toBe(
      404,
    );
  });
});

describe('Dashboard und Agenda', () => {
  it('persönlich mit Standard-Widgets, geteilt nur für Owner bearbeitbar', async () => {
    const def = (await member.get(`/api/workspaces/${ws}/dashboard`)).body;
    expect(def).toMatchObject({ scope: 'personal', isDefault: true, canEdit: true });
    expect(def.widgets.map((w: { type: string }) => w.type)).toEqual([
      'upcoming',
      'overdue',
      'recent',
      'favorites',
    ]);
    const widgets = [{ id: 'n', type: 'note', x: 0, y: 0, w: 4, h: 3, text: 'Einkaufen' }];
    const saved = (await member.put(`/api/workspaces/${ws}/dashboard`, { widgets })).body;
    expect(saved).toMatchObject({
      isDefault: false,
      widgets: [{ id: 'n', type: 'note', text: 'Einkaufen' }],
    });
    // Eigenes Dashboard, andere sehen weiter ihr eigenes
    expect((await owner.get(`/api/workspaces/${ws}/dashboard`)).body.isDefault).toBe(true);
    // Geteilt: Mitglied liest, darf nicht schreiben
    expect((await member.get(`/api/workspaces/${ws}/dashboard?scope=shared`)).body.canEdit).toBe(
      false,
    );
    expect(
      (await member.put(`/api/workspaces/${ws}/dashboard?scope=shared`, { widgets })).status,
    ).toBe(403);
    expect(
      (await owner.put(`/api/workspaces/${ws}/dashboard?scope=shared`, { widgets })).status,
    ).toBe(200);
    expect(
      (await member.get(`/api/workspaces/${ws}/dashboard?scope=shared`)).body.widgets,
    ).toHaveLength(1);
    // Ungültige Widgets werden abgelehnt
    expect(
      (
        await member.put(`/api/workspaces/${ws}/dashboard`, {
          widgets: [{ id: 'x', type: 'raketen', x: 0, y: 0, w: 1, h: 1 }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await member.put(`/api/workspaces/${ws}/dashboard`, {
          widgets: [
            {
              id: 'l',
              type: 'links',
              x: 0,
              y: 0,
              w: 1,
              h: 1,
              links: [{ title: 'x', url: 'javascript:alert(1)' }],
            },
          ],
        })
      ).status,
    ).toBe(422);
  });

  it('Agenda: anstehend und überfällig aus mehreren Datenbanken, erledigte und private ausgenommen', async () => {
    const s = await sales();
    const tasks = (
      await owner.post(`/api/workspaces/${ws}/databases`, { scope: 'TEAM', title: 'Aufgaben' })
    ).body;
    const due = (
      await owner.post(`/api/databases/${tasks.id}/properties`, { name: 'Fällig', type: 'date' })
    ).body;
    const done = (
      await owner.post(`/api/databases/${tasks.id}/properties`, {
        name: 'Erledigt',
        type: 'checkbox',
      })
    ).body;
    await owner.post(`/api/databases/${tasks.id}/rows`, {
      title: 'Morgen',
      values: { [due.id]: { start: dayOffset(1) } },
    });
    await owner.post(`/api/databases/${tasks.id}/rows`, {
      title: 'Weit weg',
      values: { [due.id]: { start: dayOffset(40) } },
    });
    await owner.post(`/api/databases/${tasks.id}/rows`, {
      title: 'Vorbei offen',
      values: { [due.id]: { start: dayOffset(-3) } },
    });
    await owner.post(`/api/databases/${tasks.id}/rows`, {
      title: 'Vorbei erledigt',
      values: { [due.id]: { start: dayOffset(-3) }, [done.id]: true },
    });
    const priv = (
      await owner.post(`/api/workspaces/${ws}/databases`, { scope: 'PRIVATE', title: 'Geheim' })
    ).body;
    const pd = (
      await owner.post(`/api/databases/${priv.id}/properties`, { name: 'Wann', type: 'date' })
    ).body;
    await owner.post(`/api/databases/${priv.id}/rows`, {
      title: 'Privat morgen',
      values: { [pd.id]: { start: dayOffset(1) } },
    });

    const mine = (await member.get(`/api/workspaces/${ws}/agenda?days=14&tz=UTC`)).body;
    expect(mine.upcoming.map((i: { title: string }) => i.title)).toEqual(['Morgen']);
    const overdue = mine.overdue.map((i: { title: string }) => i.title);
    expect(overdue).toContain('Vorbei offen');
    expect(overdue).not.toContain('Vorbei erledigt');
    // Verkäufe: C ist "Erledigt" (Status), A und B offen
    expect(overdue).toEqual(expect.arrayContaining(['A', 'B']));
    expect(overdue).not.toContain('C');
    expect(mine.overdue.find((i: { title: string }) => i.title === 'A')).toMatchObject({
      databaseTitle: 'Verkäufe',
      propertyName: 'Datum',
    });
    expect(s).toBeTruthy();
    const own = (await owner.get(`/api/workspaces/${ws}/agenda?days=14&tz=UTC`)).body;
    expect(own.upcoming.map((i: { title: string }) => i.title).sort()).toEqual([
      'Morgen',
      'Privat morgen',
    ]);
  });
});

describe('Leistung', () => {
  it('Diagramm über 50.000 Zeilen in unter 500 ms (ohne Cache)', async () => {
    const d = (
      await owner.post(`/api/workspaces/${ws}/databases`, { scope: 'TEAM', title: 'Groß' })
    ).body;
    const amount = (
      await owner.post(`/api/databases/${d.id}/properties`, { name: 'Betrag', type: 'number' })
    ).body;
    const sel = (
      await owner.post(`/api/databases/${d.id}/properties`, {
        name: 'Kategorie',
        type: 'select',
        config: {
          options: Array.from({ length: 8 }, (_, i) => ({
            id: crypto.randomUUID(),
            name: `K${i}`,
            color: 'blue',
          })),
        },
      })
    ).body;
    const opts = (sel.config.options as { id: string }[]).map((o) => o.id);
    const first = (await owner.post(`/api/databases/${d.id}/rows`, { title: 'Vorlage' })).body;
    const tpl = await prisma.page.findUniqueOrThrow({ where: { id: first.id } });
    // 50.000 Zeilen direkt per SQL (schnell), Werte für Betrag und Kategorie
    await prisma.$executeRaw`
      INSERT INTO pages (id, workspace_id, parent_id, database_id, kind, position, title, owner_id, created_by_id, last_edited_by_id, scope)
      SELECT gen_random_uuid(), ${ws}::uuid, ${d.id}::uuid, ${d.id}::uuid, 'DATABASE_ROW', 'b' || lpad(g::text, 6, '0'),
             'Z' || g, ${tpl.ownerId}::uuid, ${tpl.createdById}::uuid, ${tpl.createdById}::uuid, 'TEAM'
        FROM generate_series(1, 50000) g`;
    await prisma.$executeRaw`
      INSERT INTO property_values (row_id, property_id, database_id, v_number)
      SELECT id, ${amount.id}::uuid, ${d.id}::uuid, (row_number() OVER (ORDER BY id)) % 97
        FROM pages WHERE database_id = ${d.id}::uuid AND kind = 'DATABASE_ROW'`;
    await prisma.$executeRaw`
      INSERT INTO property_values (row_id, property_id, database_id, v_option_ids)
      SELECT id, ${sel.id}::uuid, ${d.id}::uuid, ARRAY[(${opts}::text[])[1 + (row_number() OVER (ORDER BY id)) % 8]]::uuid[]
        FROM pages WHERE database_id = ${d.id}::uuid AND kind = 'DATABASE_ROW'`;
    await prisma.$executeRaw`ANALYZE property_values`;
    await prisma.$executeRaw`ANALYZE pages`;
    const view = (
      await owner.post(`/api/databases/${d.id}/views`, { name: 'Chart', type: 'chart' })
    ).body;
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      // Jede Änderung der Ansicht ergibt einen neuen Cache-Schlüssel: gemessen wird ohne Cache
      await owner.patch(`/api/databases/${d.id}/views/${view.id}`, {
        config: {
          chart: {
            type: 'bar',
            x: { propertyId: sel.id },
            y: { measure: 'sum', propertyId: amount.id },
            topN: 8 + i,
          },
        },
      });
      const t0 = performance.now();
      const res = await owner.post(`/api/databases/${d.id}/chart`, {
        viewId: view.id,
        timeZone: 'Europe/Berlin',
      });
      timings.push(performance.now() - t0);
      expect(res.body.points).toHaveLength(8);
      expect(res.body.total).toBeGreaterThan(2_000_000);
    }
    timings.sort((a, b) => a - b);
    console.log(
      `Diagramm über 50.000 Zeilen (ohne Cache): ${timings.map((x) => x.toFixed(0)).join(', ')} ms`,
    );
    expect(timings[2]!).toBeLessThan(500);
    const t1 = performance.now();
    await owner.post(`/api/databases/${d.id}/chart`, {
      viewId: view.id,
      timeZone: 'Europe/Berlin',
    });
    console.log(`Aus dem Cache: ${(performance.now() - t1).toFixed(0)} ms`);
  }, 120_000);
});
