import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@jotion/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ComputeEngine } from './engine';

/**
 * Leistung und Korrektheit gegen PostgreSQL (DATABASE_URL, *_test):
 * 10.000 Aufgaben, 100 Projekte mit je 100 Aufgaben (Rollup Summe), eine Firma mit allen
 * Projekten (Rollup über das Rollup). Eine geänderte Aufgabe muss in unter 2 s bei der Firma sein.
 */
const db: PrismaClient = createPrismaClient();
let ws: string;
let user: string;
const ids = {
  tasks: '',
  projects: '',
  companies: '',
  points: '',
  rel: '',
  sum: '',
  crel: '',
  total: '',
};
let firstTask = '';
let company = '';

async function database(title: string): Promise<string> {
  const page = await db.page.create({
    data: {
      workspaceId: ws,
      kind: 'DATABASE',
      position: 'a0',
      title,
      ownerId: user,
      createdById: user,
      lastEditedById: user,
    },
  });
  await db.database.create({ data: { id: page.id, workspaceId: ws } });
  await db.dbProperty.create({
    data: { databaseId: page.id, type: 'title', name: 'Name', position: 'a0', config: {} },
  });
  return page.id;
}

async function property(
  databaseId: string,
  type: string,
  name: string,
  config: object,
): Promise<string> {
  const p = await db.dbProperty.create({
    data: { databaseId, type: type as never, name, position: `b${name}`, config },
  });
  return p.id;
}

/** n Zeilen per SQL anlegen (schnell), liefert ihre IDs in Reihenfolge. */
async function rows(databaseId: string, n: number, prefix: string): Promise<string[]> {
  const created = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO pages (id, workspace_id, parent_id, database_id, kind, position, title, owner_id, created_by_id, last_edited_by_id, scope)
    SELECT gen_random_uuid(), ${ws}::uuid, ${databaseId}::uuid, ${databaseId}::uuid, 'DATABASE_ROW',
           'a' || lpad(g::text, 6, '0'), ${prefix} || g, ${user}::uuid, ${user}::uuid, ${user}::uuid, 'TEAM'
      FROM generate_series(1, ${n}) g
    RETURNING id::text`;
  return created.map((r) => r.id);
}

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  user = (
    await db.user.create({
      data: { email: `compute-${suffix}@test.local`, name: 'Rechner', passwordHash: 'x' },
    })
  ).id;
  ws = (await db.workspace.create({ data: { name: `Compute ${suffix}` } })).id;
  ids.tasks = await database('Aufgaben');
  ids.projects = await database('Projekte');
  ids.companies = await database('Firmen');
  ids.points = await property(ids.tasks, 'number', 'Punkte', { format: 'number', precision: null });
  ids.rel = await property(ids.projects, 'relation', 'Aufgaben', {
    targetDatabaseId: ids.tasks,
    twoWay: false,
    reversePropertyId: null,
    limit: 'many',
  });
  ids.sum = await property(ids.projects, 'rollup', 'Summe', {
    relationPropertyId: ids.rel,
    targetPropertyId: ids.points,
    aggregation: 'sum',
    resultType: 'number',
  });
  ids.crel = await property(ids.companies, 'relation', 'Projekte', {
    targetDatabaseId: ids.projects,
    twoWay: false,
    reversePropertyId: null,
    limit: 'many',
  });
  ids.total = await property(ids.companies, 'rollup', 'Gesamt', {
    relationPropertyId: ids.crel,
    targetPropertyId: ids.sum,
    aggregation: 'sum',
    resultType: 'number',
  });

  const tasks = await rows(ids.tasks, 10_000, 'Aufgabe ');
  firstTask = tasks[0]!;
  await db.$executeRaw`
    INSERT INTO property_values (row_id, property_id, database_id, v_number)
    SELECT t, ${ids.points}::uuid, ${ids.tasks}::uuid, 1 FROM unnest(${tasks}::text[]::uuid[]) t`;
  const projects = await rows(ids.projects, 100, 'Projekt ');
  // Projekt i bekommt die Aufgaben i*100 .. i*100+99
  const from: string[] = [];
  const to: string[] = [];
  tasks.forEach((t, i) => {
    from.push(projects[Math.floor(i / 100)]!);
    to.push(t);
  });
  await db.$executeRaw`
    INSERT INTO relation_links (database_id, property_id, from_row_id, to_row_id, position)
    SELECT ${ids.projects}::uuid, ${ids.rel}::uuid, f, t, 'a0'
      FROM unnest(${from}::text[]::uuid[], ${to}::text[]::uuid[]) AS x(f, t)`;
  company = (await rows(ids.companies, 1, 'Firma '))[0]!;
  await db.$executeRaw`
    INSERT INTO relation_links (database_id, property_id, from_row_id, to_row_id, position)
    SELECT ${ids.companies}::uuid, ${ids.crel}::uuid, ${company}::uuid, p, 'a0' FROM unnest(${projects}::text[]::uuid[]) p`;

  // Ausgangszustand berechnen
  const engine = new ComputeEngine(db, { timeZone: 'Europe/Berlin' });
  await engine.recomputeRows(ids.projects);
  await engine.recomputeRows(ids.companies);
}, 120_000);

/** Abfrageplan der Lade-Abfragen, Statistiken und wartende Sperren (nur bei langsamen Läufen). */
async function diagnose() {
  const projectRows = (
    await db.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM pages WHERE database_id = ${ids.projects}::uuid ORDER BY id LIMIT 100`
  ).map((r) => r.id);
  const plan = await db.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS)
     SELECT l.property_id, l.from_row_id, l.to_row_id, tp.title
       FROM relation_links l JOIN pages tp ON tp.id = l.to_row_id AND tp.deleted_at IS NULL
      WHERE l.from_row_id = ANY($1::uuid[]) ORDER BY l.position, l.to_row_id`,
    projectRows,
  );
  console.log(plan.map((p) => p['QUERY PLAN']).join('\n'));
  console.log(
    await db.$queryRaw`
      SELECT relname, n_live_tup, last_analyze, last_autoanalyze FROM pg_stat_user_tables
       WHERE relname IN ('pages', 'relation_links', 'property_values')`,
  );
  console.log(
    await db.$queryRaw`
      SELECT pid, state, wait_event_type, wait_event, left(query, 120) AS query FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()`,
  );
}

afterAll(async () => {
  await db.workspace.deleteMany({ where: { id: ws } });
  await db.user.deleteMany({ where: { id: user } });
  await db.$disconnect();
});

const total = async () =>
  (
    await db.propertyValue.findUnique({
      where: { rowId_propertyId: { rowId: company, propertyId: ids.total } },
    })
  )?.vNumber;

describe('ComputeEngine (PostgreSQL, 10.000 Zeilen)', () => {
  it('Ausgangswerte stimmen', async () => {
    expect(await total()).toBe(10_000);
  });

  it('reicht eine Änderung über zwei Relationsebenen in unter 2 s weiter', async () => {
    await db.propertyValue.update({
      where: { rowId_propertyId: { rowId: firstTask, propertyId: ids.points } },
      data: { vNumber: 51 },
    });
    const t0 = performance.now();
    const engine = new ComputeEngine(db, { timeZone: 'Europe/Berlin' });
    const touched = await engine.propagate(ids.tasks, [firstTask]);
    const ms = performance.now() - t0;
    console.log(`Weiterreichen über 2 Ebenen bei 10.000 Zeilen: ${ms.toFixed(0)} ms`);
    expect(await total()).toBe(10_050);
    expect([...(touched.get(ids.projects) ?? [])]).toHaveLength(1);
    expect([...(touched.get(ids.companies) ?? [])]).toEqual([company]);
    expect(ms).toBeLessThan(2000);
  });

  it('berechnet eine ganze Datenbank mit 10.000 Zeilen-Bezügen in vertretbarer Zeit neu', async () => {
    const engine = new ComputeEngine(db, { timeZone: 'Europe/Berlin' });
    await db.$executeRaw`DELETE FROM property_values WHERE property_id = ${ids.sum}::uuid`;
    const t0 = performance.now();
    const changed = await engine.recomputeRows(ids.projects);
    const ms = performance.now() - t0;
    console.log(`100 Projekte mit 10.000 verknüpften Aufgaben neu berechnet: ${ms.toFixed(0)} ms`);
    expect(changed).toHaveLength(100);
    // Einmal in CI 53 s statt 0,2 s, lokal nicht nachstellbar: bei Überschreitung Plan und
    // Sperren ausgeben, damit ein erneuter Ausreißer erklärbar ist
    if (ms >= 5000) await diagnose();
    expect(ms).toBeLessThan(5000);
  });
});
