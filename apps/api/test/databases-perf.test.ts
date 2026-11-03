import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { keysBetween } from '@jotion/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, createTestApp, resetState, setupOwner } from './helpers';

/**
 * Akzeptanz Phase 4: Datenbank mit 50.000 Zeilen, gefilterte und sortierte erste Seite
 * in unter 300 ms (p95, Server). Gemessen über die echte Route inklusive Rechteprüfung.
 */
const ROWS = 50_000;
let app: NestFastifyApplication;
let db: PrismaClient;
let c: Client;
let dbId: string;
let numId: string;
let selId: string;
let textId: string;
let dateId: string;
const OPTS = Array.from({ length: 5 }, (_, i) => `01900000-0000-7000-8000-00000000000${i + 1}`);

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  await resetState(app);
  const o = await setupOwner(app);
  c = o.client;
  const d = (
    await c.post(`/api/workspaces/${o.workspaceId}/databases`, { scope: 'TEAM', title: 'Groß' })
  ).body;
  dbId = d.id;
  const prop = async (body: object) =>
    (await c.post(`/api/databases/${dbId}/properties`, body)).body.id as string;
  numId = await prop({ name: 'Zahl', type: 'number' });
  selId = await prop({
    name: 'Status',
    type: 'select',
    config: { options: OPTS.map((id, i) => ({ id, name: `S${i}` })) },
  });
  textId = await prop({ name: 'Text', type: 'text' });
  dateId = await prop({ name: 'Datum', type: 'date' });

  // Zeilen per SQL anlegen (die Seiten-Trigger laufen trotzdem für jede Zeile)
  const positions = keysBetween(null, null, ROWS);
  await db.$executeRaw`
    INSERT INTO pages (id, workspace_id, parent_id, database_id, kind, position, title, owner_id, created_by_id, last_edited_by_id)
    SELECT gen_random_uuid(), ${o.workspaceId}::uuid, ${dbId}::uuid, ${dbId}::uuid, 'DATABASE_ROW', pos, 'Zeile ' || n,
           ${o.userId}::uuid, ${o.userId}::uuid, ${o.userId}::uuid
      FROM unnest(${positions}::text[]) WITH ORDINALITY AS t(pos, n)`;
  await db.$executeRaw`
    INSERT INTO property_values (row_id, property_id, database_id, v_number, updated_at)
    SELECT id, ${numId}::uuid, ${dbId}::uuid, (hashtext(id::text) % 1000)::float8, now() FROM pages WHERE database_id = ${dbId}::uuid`;
  await db.$executeRaw`
    INSERT INTO property_values (row_id, property_id, database_id, v_option_ids, updated_at)
    SELECT id, ${selId}::uuid, ${dbId}::uuid, ARRAY[(${OPTS}::uuid[])[1 + abs(hashtext(id::text || 's')) % 5]], now()
      FROM pages WHERE database_id = ${dbId}::uuid`;
  await db.$executeRaw`
    INSERT INTO property_values (row_id, property_id, database_id, v_text, updated_at)
    SELECT id, ${textId}::uuid, ${dbId}::uuid, md5(id::text), now() FROM pages WHERE database_id = ${dbId}::uuid`;
  await db.$executeRaw`
    INSERT INTO property_values (row_id, property_id, database_id, v_date_start, v_date_has_time, updated_at)
    SELECT id, ${dateId}::uuid, ${dbId}::uuid, timestamptz '2026-01-01' + (abs(hashtext(id::text || 'd')) % 365) * interval '1 day', false, now()
      FROM pages WHERE database_id = ${dbId}::uuid`;
  await db.$executeRawUnsafe('ANALYZE pages');
  await db.$executeRawUnsafe('ANALYZE property_values');
}, 300_000);

afterAll(async () => {
  await app?.close();
});

async function p95(
  body: object,
  runs = 15,
): Promise<{ p95: number; res: { rows: unknown[]; total: number } }> {
  const times: number[] = [];
  let res: { rows: unknown[]; total: number } = { rows: [], total: 0 };
  // Aufwärmen
  await c.post(`/api/databases/${dbId}/query`, body);
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const r = await c.post(`/api/databases/${dbId}/query`, body);
    times.push(performance.now() - t);
    expect(r.status).toBe(200);
    res = r.body;
  }
  times.sort((a, b) => a - b);
  return { p95: times[Math.ceil(times.length * 0.95) - 1]!, res };
}

describe(`Datenbank mit ${ROWS} Zeilen`, () => {
  it('liefert die gefilterte und sortierte erste Seite in unter 300 ms (p95)', async () => {
    const { p95: t, res } = await p95({
      limit: 100,
      filter: {
        type: 'group',
        op: 'and',
        children: [
          { type: 'condition', propertyId: selId, operator: 'is', value: OPTS[0] },
          { type: 'condition', propertyId: numId, operator: 'greater_than', value: 100 },
        ],
      },
      sorts: [{ propertyId: numId, direction: 'desc' }],
    });
    console.log(`p95 gefiltert + sortiert: ${t.toFixed(1)} ms, Treffer ${res.total}`);
    expect(res.rows).toHaveLength(100);
    expect(res.total).toBeGreaterThan(1000);
    expect(t).toBeLessThan(300);
  });

  it('ungefiltert, Sortierung nach Text, Suche und Datumsfilter bleiben schnell', async () => {
    for (const body of [
      { limit: 100 },
      { limit: 100, sorts: [{ propertyId: textId, direction: 'asc' }] },
      { limit: 100, search: 'abc' },
      {
        limit: 100,
        filter: {
          type: 'group',
          op: 'or',
          children: [
            {
              type: 'condition',
              propertyId: dateId,
              operator: 'is_before',
              value: { kind: 'exact', date: '2026-02-01' },
            },
            { type: 'condition', propertyId: textId, operator: 'starts_with', value: 'ff' },
          ],
        },
      },
    ]) {
      const { p95: t } = await p95(body, 8);
      console.log(`p95 ${JSON.stringify(body).slice(0, 80)}: ${t.toFixed(1)} ms`);
      expect(t).toBeLessThan(300);
    }
  });

  it('blättert per Cursor ohne Leistungsverlust', async () => {
    const sorts = [{ propertyId: numId, direction: 'asc' }];
    let cursor: string | null = (
      await c.post(`/api/databases/${dbId}/query`, { limit: 200, sorts })
    ).body.nextCursor;
    for (let i = 0; i < 5 && cursor; i++) {
      const t = performance.now();
      const r = await c.post(`/api/databases/${dbId}/query`, { limit: 200, sorts, cursor });
      expect(performance.now() - t).toBeLessThan(300);
      cursor = r.body.nextCursor;
    }
  });
});
