import { randomUUID } from 'node:crypto';
import { createPrismaClient, Prisma, type PrismaClient } from '@jotion/db';
import {
  calculationsFor,
  DATE_BUCKETS,
  DATE_RANGES,
  GROUPABLE_TYPES,
  keysBetween,
  operatorsFor,
  RELATIVE_DATES,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type PropertyType,
  type SortSpec,
} from '@jotion/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compileCalculationQuery,
  compileAggregateQuery,
  compileCountQuery,
  compileGroupCountQuery,
  compileRowQuery,
  CursorMismatchError,
} from './compile';
import { encodeCursor } from './cursor';
import { rowGroupKeys, type GroupSpec } from './grouping';
import { rowValue } from './reference';
import { calculateAll, queryRows } from './reference';
import { toStorage } from './storage';
import type { QueryContext, QueryProperty, RowRecord } from './types';

/**
 * Vergleichstests: SQL-Compiler gegen echte PostgreSQL, Ergebnis gegen die JS-Referenz.
 * Zufällige Daten, Filter (bis Tiefe 3), Sortierungen, Suche und Zeitzonen mit fast-check.
 */

const db: PrismaClient = createPrismaClient();
const NOW = new Date('2026-11-15T12:00:00Z');
const ALPHABET = ['a', 'A', 'b', 'B', 'c', 'ä', 'Ä', 'ö', 'Ö', ' ', '%', '_', '\\', '-', '1'];
const ROWS = 160;

let workspaceId: string;
let databaseId: string;
let otherDatabaseId: string;
const users: { id: string; name: string }[] = [];
const props: QueryProperty[] = [];
const rows: RowRecord[] = [];
const userNames: Record<string, string> = {};

const opt = (name: string) => ({ id: randomUUID(), name, color: 'blue' as const });
const selectOptions = [opt('Rot'), opt('grün'), opt('Blau'), opt('gelb')];
const multiOptions = [opt('x'), opt('Y'), opt('z'), opt('w')];
const statusOptions = [
  { ...opt('Offen'), group: 'todo' as const },
  { ...opt('Läuft'), group: 'in_progress' as const },
  { ...opt('Fertig'), group: 'complete' as const },
];

const PROP_DEFS: { type: PropertyType; config: unknown }[] = [
  { type: 'title', config: {} },
  { type: 'text', config: {} },
  { type: 'number', config: { format: 'number', precision: null } },
  { type: 'select', config: { options: selectOptions } },
  { type: 'multi_select', config: { options: multiOptions } },
  { type: 'status', config: { options: statusOptions } },
  { type: 'date', config: { dateFormat: 'full', timeFormat: '24h' } },
  { type: 'person', config: {} },
  { type: 'checkbox', config: {} },
  { type: 'url', config: {} },
  { type: 'email', config: {} },
  { type: 'files', config: {} },
  { type: 'created_time', config: {} },
  { type: 'created_by', config: {} },
  { type: 'last_edited_time', config: {} },
  { type: 'last_edited_by', config: {} },
  { type: 'unique_id', config: { prefix: 'T', nextValue: 1 } },
];

const prop = (type: PropertyType) => props.find((p) => p.type === type)!;
const textArb = (max = 6) =>
  fc.array(fc.constantFrom(...ALPHABET), { maxLength: max }).map((a) => a.join(''));
const dayArb = fc
  .integer({ min: Date.UTC(2026, 9, 1), max: Date.UTC(2026, 11, 31) })
  .map((ms) => new Date(ms).toISOString().slice(0, 10));
const msArb = fc.integer({ min: Date.UTC(2026, 9, 1), max: Date.UTC(2026, 11, 31) });

async function insertRow(
  dbId: string,
  r: RowRecord,
  extra: { deleted?: boolean; archived?: boolean } = {},
) {
  await db.page.create({
    data: {
      id: r.id,
      workspaceId,
      parentId: dbId,
      databaseId: dbId,
      kind: 'DATABASE_ROW',
      position: r.position,
      title: r.title,
      ownerId: users[0]!.id,
      createdById: r.createdById,
      lastEditedById: r.lastEditedById,
      createdAt: new Date(r.createdAt),
      lastEditedAt: new Date(r.lastEditedAt),
      deletedAt: extra.deleted ? new Date() : null,
      archivedAt: extra.archived ? new Date() : null,
    },
  });
  const data: Prisma.PropertyValueCreateManyInput[] = [];
  for (const p of props) {
    const v = r.values[p.id];
    if (v === undefined) continue;
    const cols = toStorage(p.type, v);
    if (!cols) continue;
    data.push({
      rowId: r.id,
      propertyId: p.id,
      databaseId: dbId,
      ...cols,
      vJson: cols.vJson === null ? Prisma.DbNull : (cols.vJson as Prisma.InputJsonValue),
    });
  }
  if (data.length) await db.propertyValue.createMany({ data });
}

async function createDatabase(title: string): Promise<string> {
  const page = await db.page.create({
    data: {
      workspaceId,
      kind: 'DATABASE',
      position: 'a0',
      title,
      ownerId: users[0]!.id,
      createdById: users[0]!.id,
      lastEditedById: users[0]!.id,
    },
  });
  await db.database.create({ data: { id: page.id, workspaceId } });
  return page.id;
}

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  for (const name of ['anna', 'Bert', 'Cäsar']) {
    const u = await db.user.create({
      data: { email: `${name.toLowerCase()}-${suffix}@query.test`, name, passwordHash: 'x' },
    });
    users.push({ id: u.id, name });
    userNames[u.id] = name;
  }
  workspaceId = (await db.workspace.create({ data: { name: `Query ${suffix}` } })).id;
  databaseId = await createDatabase('DB');
  otherDatabaseId = await createDatabase('Andere');
  const positions = keysBetween(null, null, ROWS);
  for (const [i, def] of PROP_DEFS.entries()) {
    const p = await db.dbProperty.create({
      data: {
        databaseId,
        type: def.type,
        name: def.type,
        position: positions[i]!,
        config: def.config as Prisma.InputJsonValue,
      },
    });
    props.push({ id: p.id, type: def.type, config: def.config });
  }

  const userIdArb = fc.constantFrom(...users.map((u) => u.id));
  const valuesArb = fc.record({
    text: fc.option(textArb(), { nil: undefined }),
    number: fc.option(
      fc.oneof(
        fc.integer({ min: -20, max: 20 }),
        fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
      ),
      { nil: undefined },
    ),
    select: fc.option(fc.constantFrom(...selectOptions.map((o) => o.id)), { nil: undefined }),
    multi: fc.subarray(multiOptions.map((o) => o.id)),
    status: fc.option(fc.constantFrom(...statusOptions.map((o) => o.id)), { nil: undefined }),
    date: fc.option(
      fc.oneof(
        dayArb.map((d) => ({ start: d, end: null, hasTime: false, timeZone: null })),
        // Zeiträume (Kalender und Zeitleiste)
        fc.tuple(dayArb, fc.integer({ min: 0, max: 20 })).map(([d, n]) => {
          const e = new Date(`${d}T00:00:00Z`);
          e.setUTCDate(e.getUTCDate() + n);
          return { start: d, end: e.toISOString().slice(0, 10), hasTime: false, timeZone: null };
        }),
        msArb.map((ms) => ({
          start: new Date(ms).toISOString(),
          end: null,
          hasTime: true,
          timeZone: null,
        })),
      ),
      { nil: undefined },
    ),
    person: fc.subarray(users.map((u) => u.id)),
    checkbox: fc.boolean(),
    url: fc.option(
      textArb(4).map((s) => (s ? `https://${s}` : s)),
      { nil: undefined },
    ),
    email: fc.option(textArb(3), { nil: undefined }),
    files: fc.array(
      fc.record({
        type: fc.constant('external' as const),
        url: fc.constantFrom('https://a.test/x.pdf', 'https://b.test/y.png'),
        name: fc.constantFrom('x.pdf', 'y.png'),
      }),
      { maxLength: 2 },
    ),
    title: textArb(),
    // Doppelte Positionen kommen nach Importen vor und testen den ID-Tiebreaker
    position: fc.option(fc.constantFrom(...positions.slice(0, 5)), { nil: undefined }),
    createdAt: msArb,
    lastEditedAt: msArb,
    createdBy: userIdArb,
    lastEditedBy: userIdArb,
  });
  const samples = fc.sample(valuesArb, { numRuns: ROWS, seed: 42 });
  for (const [i, s] of samples.entries()) {
    const values: RowRecord['values'] = {};
    const set = (type: PropertyType, v: unknown) => {
      if (v !== undefined) values[prop(type).id] = v as never;
    };
    set('text', s.text);
    set('number', s.number);
    set('select', s.select);
    set('multi_select', s.multi);
    set('status', s.status);
    set('date', s.date);
    set('person', s.person);
    set('checkbox', s.checkbox);
    set('url', s.url);
    set('email', s.email);
    set('files', s.files);
    set('unique_id', i + 1);
    // Leere Werte sind nicht gespeichert: Referenz bekommt dieselbe Sicht
    for (const p of props) {
      const v = values[p.id];
      if (v !== undefined && toStorage(p.type, v) === null) delete values[p.id];
    }
    const r: RowRecord = {
      id: randomUUID(),
      title: s.title,
      position: s.position ?? positions[i]!,
      createdAt: new Date(s.createdAt).toISOString(),
      createdById: s.createdBy,
      lastEditedAt: new Date(s.lastEditedAt).toISOString(),
      lastEditedById: s.lastEditedBy,
      values,
    };
    rows.push(r);
    await insertRow(databaseId, r);
  }
  // Zeilen, die nie erscheinen dürfen: gelöscht, archiviert, andere Datenbank
  const ghost = (title: string): RowRecord => ({
    ...rows[0]!,
    id: randomUUID(),
    title,
    values: {},
  });
  await insertRow(databaseId, ghost('gelöscht'), { deleted: true });
  await insertRow(databaseId, ghost('archiviert'), { archived: true });
  await insertRow(otherDatabaseId, ghost('fremd'));
});

afterAll(async () => {
  await db.workspace.deleteMany({ where: { id: workspaceId } });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await db.$disconnect();
});

// ---------------------------------------------------------------- Zufallsfilter

function conditionArb(): fc.Arbitrary<FilterCondition> {
  return fc.constantFrom(...props).chain((p) => {
    const ops = operatorsFor(p.type);
    return fc.constantFrom(...ops).chain((operator) => {
      const base = { type: 'condition' as const, propertyId: p.id, operator };
      if (operator === 'is_empty' || operator === 'is_not_empty') return fc.constant(base);
      let value: fc.Arbitrary<FilterCondition['value']>;
      switch (p.type) {
        case 'title':
        case 'text':
        case 'url':
        case 'email':
        case 'phone':
          value = textArb(2);
          break;
        case 'number':
        case 'unique_id':
          value = fc.oneof(
            fc.integer({ min: -25, max: 170 }),
            fc.constantFrom(
              ...rows.flatMap((r) => {
                const v = r.values[p.id];
                return typeof v === 'number' ? [v] : [];
              }),
            ),
          );
          break;
        case 'select':
          value = fc.constantFrom(...selectOptions.map((o) => o.id), 'kaputt');
          break;
        case 'multi_select':
          value = fc.constantFrom(...multiOptions.map((o) => o.id));
          break;
        case 'status':
          value = fc.constantFrom(...statusOptions.map((o) => o.id));
          break;
        case 'person':
        case 'created_by':
        case 'last_edited_by':
          value = fc.constantFrom(...users.map((u) => u.id));
          break;
        case 'checkbox':
          value = fc.boolean();
          break;
        default:
          value =
            operator === 'is_within'
              ? fc.constantFrom(...DATE_RANGES)
              : fc.oneof(
                  dayArb.map((date) => ({ kind: 'exact' as const, date })),
                  fc.constantFrom(...RELATIVE_DATES).map((preset) => ({
                    kind: 'relative' as const,
                    preset,
                  })),
                );
      }
      return value.map((v) => ({ ...base, value: v }));
    });
  });
}

const filterArb = (): fc.Arbitrary<FilterGroup> =>
  fc.letrec<{ group: FilterGroup; node: FilterNode }>((tie) => ({
    group: fc.record({
      type: fc.constant('group' as const),
      op: fc.constantFrom('and' as const, 'or' as const),
      children: fc.array(tie('node'), { minLength: 0, maxLength: 3 }),
    }),
    node: fc.oneof({ depthSize: 'small', withCrossShrink: true }, conditionArb(), tie('group')),
  })).group;

const sortsArb = (): fc.Arbitrary<SortSpec[]> =>
  fc.array(
    fc.record({
      propertyId: fc.constantFrom(...PROP_DEFS.map((_, i) => i)).map((i) => props[i]!.id),
      direction: fc.constantFrom('asc' as const, 'desc' as const),
    }),
    { maxLength: 3 },
  );
const tzArb = fc.constantFrom('UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Tokyo');
const searchArb = fc.option(textArb(2), { nil: undefined });

function depth(n: FilterNode): number {
  return n.type === 'group' ? 1 + Math.max(0, ...n.children.map(depth)) : 0;
}

const ctxOf = (
  filter: FilterGroup | null,
  sorts: SortSpec[],
  timeZone: string,
  search?: string,
): QueryContext => ({
  databaseId,
  viewerId: users[0]!.id,
  properties: props,
  filter,
  sorts,
  timeZone,
  search,
  now: NOW,
  userNames,
});

async function runRows(ctx: QueryContext, limit: number, cursor?: string | null) {
  const c = compileRowQuery(ctx, { limit, cursor });
  const result = await db.$queryRawUnsafe<
    ({ id: string; position: string } & Record<string, unknown>)[]
  >(c.query.sql, ...c.query.parameters);
  return { result, compiled: c };
}

describe('Query-Compiler gegen JS-Referenz (PostgreSQL)', () => {
  it('liefert ohne Filter alle sichtbaren Zeilen in Positionsreihenfolge', async () => {
    const ctx = ctxOf(null, [], 'UTC');
    const { result } = await runRows(ctx, 500);
    expect(result.map((r) => r.id)).toEqual(queryRows(rows, ctx).map((r) => r.id));
    expect(result).toHaveLength(ROWS);
  });

  it('stimmt bei zufälligen Filtern, Sortierungen, Suche und Zeitzonen überein', async () => {
    let partial = 0;
    await fc.assert(
      fc.asyncProperty(
        filterArb().filter((f) => depth(f) <= 3),
        sortsArb(),
        tzArb,
        searchArb,
        async (filter, sorts, tz, search) => {
          const ctx = ctxOf(filter, sorts, tz, search);
          const expected = queryRows(rows, ctx).map((r) => r.id);
          if (expected.length > 0 && expected.length < ROWS) partial++;
          const { result } = await runRows(ctx, 500);
          expect(result.map((r) => r.id)).toEqual(expected);
          const count = compileCountQuery(ctx);
          const [c] = await db.$queryRawUnsafe<{ total: number }[]>(count.sql, ...count.parameters);
          expect(c!.total).toBe(expected.length);
        },
      ),
      { numRuns: 250, seed: 7 },
    );
    // Die Zufallsfilter sollen auch wirklich filtern (nicht nur alles oder nichts liefern)
    expect(partial).toBeGreaterThan(50);
  });

  it('blättert per Cursor lückenlos und ohne Dubletten', async () => {
    await fc.assert(
      fc.asyncProperty(
        sortsArb(),
        fc.option(filterArb(), { nil: null }),
        fc.integer({ min: 1, max: 40 }),
        async (sorts, filter, limit) => {
          const ctx = ctxOf(filter, sorts, 'Europe/Berlin');
          const expected = queryRows(rows, ctx).map((r) => r.id);
          const seen: string[] = [];
          let cursor: string | null = null;
          for (let guard = 0; guard < 400; guard++) {
            const { result, compiled } = await runRows(ctx, limit, cursor);
            const page = result.slice(0, limit);
            seen.push(...page.map((r) => r.id));
            if (result.length <= limit) break;
            cursor = encodeCursor(compiled.signature, compiled.keyTypes, page.at(-1)!);
          }
          expect(seen).toEqual(expected);
        },
      ),
      { numRuns: 60, seed: 11 },
    );
  });

  it('lehnt Cursor einer anderen Sortierung ab', async () => {
    const ctx = ctxOf(null, [{ propertyId: prop('number').id, direction: 'asc' }], 'UTC');
    const { result, compiled } = await runRows(ctx, 3);
    const cursor = encodeCursor(compiled.signature, compiled.keyTypes, result[2]!);
    expect(() => compileRowQuery(ctxOf(null, [], 'UTC'), { limit: 3, cursor })).toThrow(
      CursorMismatchError,
    );
    expect(() => compileRowQuery(ctx, { limit: 3, cursor: 'kaputt' })).toThrow(CursorMismatchError);
  });

  it('berechnet Spaltenwerte wie die Referenz', async () => {
    const calcArb = fc.array(
      fc
        .constantFrom(...props)
        .chain((p) =>
          fc.constantFrom(...calculationsFor(p.type)).map((fn) => ({ propertyId: p.id, fn })),
        ),
      { minLength: 1, maxLength: 6 },
    );
    await fc.assert(
      fc.asyncProperty(
        fc.option(filterArb(), { nil: null }),
        calcArb,
        tzArb,
        async (filter, requests, tz) => {
          // Je Property nur eine Berechnung (wie in der Ansicht)
          const unique = [...new Map(requests.map((r) => [r.propertyId, r])).values()];
          const ctx = ctxOf(filter, [], tz);
          const { query, requests: valid } = compileCalculationQuery(ctx, unique);
          const [res] = await db.$queryRawUnsafe<Record<string, number | null>[]>(
            query.sql,
            ...query.parameters,
          );
          const expected = calculateAll(rows, ctx, valid);
          valid.forEach((r, i) => {
            const got = res![`r${i}`] ?? null;
            const want = expected[r.propertyId] ?? null;
            if (want === null) expect(got).toBeNull();
            else expect(got).toBeCloseTo(want, 6);
          });
        },
      ),
      { numRuns: 120, seed: 5 },
    );
  });

  it('übergibt Nutzereingaben nur als Parameter', () => {
    const evil = "x'; DROP TABLE pages; --";
    const ctx = ctxOf(
      {
        type: 'group',
        op: 'and',
        children: [
          { type: 'condition', propertyId: prop('text').id, operator: 'contains', value: evil },
        ],
      },
      [],
      "UTC'; --",
      evil,
    );
    const { query } = compileRowQuery(ctx, { limit: 10 });
    expect(query.sql).not.toContain('DROP TABLE');
    expect(query.parameters).toContain(`%${evil}%`);
  });
});

// ---------------------------------------------------------------- Gruppierung (Phase 5)

describe('Grouping-Engine gegen JS-Referenz (PostgreSQL)', () => {
  const groupable = () => props.filter((p) => GROUPABLE_TYPES.includes(p.type));
  const specArb = (): fc.Arbitrary<GroupSpec> =>
    fc.record({
      prop: fc.constantFrom(...groupable()),
      dateBucket: fc.constantFrom(...DATE_BUCKETS),
      numberInterval: fc.constantFrom(1, 10, 25, 0.5, 1000),
    });

  /** Erwartete Zähler key|subKey -> Anzahl aus der Referenz. */
  function expectedCounts(ctx: QueryContext, g: GroupSpec, sub: GroupSpec | null, tz: string) {
    const out = new Map<string, number>();
    for (const r of queryRows(rows, ctx))
      for (const k of rowGroupKeys(r, g, tz))
        for (const sk of sub ? rowGroupKeys(r, sub, tz) : [null]) {
          const id = `${k}|${sk}`;
          out.set(id, (out.get(id) ?? 0) + 1);
        }
    return out;
  }

  it('zählt Gruppen und Untergruppen wie die Referenz', async () => {
    await fc.assert(
      fc.asyncProperty(
        specArb(),
        fc.option(specArb(), { nil: null }),
        tzArb,
        fc.option(
          filterArb().filter((f) => depth(f) <= 3),
          { nil: null },
        ),
        async (g, sub, tz, filter) => {
          const ctx = ctxOf(filter, [], tz);
          const q = compileGroupCountQuery(ctx, g, sub);
          const got = await db.$queryRawUnsafe<
            { key: string; sub_key: string | null; count: number }[]
          >(q.sql, ...q.parameters);
          const map = new Map(got.map((r) => [`${r.key}|${r.sub_key}`, r.count]));
          expect(map).toEqual(expectedCounts(ctx, g, sub, tz));
        },
      ),
      { numRuns: 120, seed: 11 },
    );
  });

  it('liefert je Gruppe genau die Zeilen der Referenz', async () => {
    await fc.assert(
      fc.asyncProperty(specArb(), tzArb, async (g, tz) => {
        const base = ctxOf(null, [], tz);
        const keys = [...new Set(rows.flatMap((r) => rowGroupKeys(r, g, tz)))];
        for (const key of keys.slice(0, 6)) {
          const ctx: QueryContext = { ...base, groups: [{ spec: g, key }] };
          const { result } = await runRows(ctx, 500);
          expect(result.map((r) => r.id)).toEqual(queryRows(rows, ctx).map((r) => r.id));
        }
      }),
      { numRuns: 40, seed: 12 },
    );
  });

  it('findet Zeilen im Zeitraum wie die Referenz', async () => {
    const dateProps = props.filter((p) =>
      ['date', 'created_time', 'last_edited_time'].includes(p.type),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...dateProps),
        fc.option(fc.constantFrom(...dateProps), { nil: null }),
        dayArb,
        fc.integer({ min: 0, max: 60 }),
        tzArb,
        async (start, end, from, len, tz) => {
          const d = new Date(`${from}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + len);
          const to = d.toISOString().slice(0, 10);
          const ctx: QueryContext = { ...ctxOf(null, [], tz), dateRange: { start, end, from, to } };
          const { result } = await runRows(ctx, 500);
          expect(result.map((r) => r.id)).toEqual(queryRows(rows, ctx).map((r) => r.id));
        },
      ),
      { numRuns: 80, seed: 13 },
    );
  });
});

// ---------------------------------------------------------------- Diagramme (Phase 7)

describe('Diagramm-Aggregation gegen JS-Referenz (PostgreSQL)', () => {
  const groupable = () => props.filter((p) => GROUPABLE_TYPES.includes(p.type));
  const specArb = (): fc.Arbitrary<GroupSpec> =>
    fc.record({
      prop: fc.constantFrom(...groupable()),
      dateBucket: fc.constantFrom(...DATE_BUCKETS),
      numberInterval: fc.constantFrom(1, 10, 100),
    });
  const MEASURES = ['count', 'count_unique', 'sum', 'average', 'median', 'min', 'max'] as const;

  function reference(
    ctx: QueryContext,
    x: GroupSpec | null,
    series: GroupSpec | null,
    measure: (typeof MEASURES)[number],
    value: QueryProperty | null,
    tz: string,
  ): Map<string, number | null> {
    const buckets = new Map<string, unknown[]>();
    for (const r of queryRows(rows, ctx))
      for (const k of x ? rowGroupKeys(r, x, tz) : [''])
        for (const sk of series ? rowGroupKeys(r, series, tz) : ['']) {
          const id = `${k}|${sk}`;
          if (!buckets.has(id)) buckets.set(id, []);
          buckets.get(id)!.push(value ? rowValue(r, value) : r.id);
        }
    const out = new Map<string, number | null>();
    for (const [id, vals] of buckets) {
      const nums = vals.filter((v): v is number => typeof v === 'number');
      const sorted = [...nums].sort((a, b) => a - b);
      const m = Math.floor(sorted.length / 2);
      switch (measure) {
        case 'count':
          out.set(id, vals.length);
          break;
        case 'count_unique':
          out.set(id, new Set(vals.filter((v) => v !== null).map((v) => String(v))).size);
          break;
        case 'sum':
          out.set(
            id,
            nums.reduce((a, b) => a + b, 0),
          );
          break;
        case 'average':
          out.set(id, nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
          break;
        case 'median':
          out.set(
            id,
            sorted.length
              ? sorted.length % 2
                ? sorted[m]!
                : (sorted[m - 1]! + sorted[m]!) / 2
              : null,
          );
          break;
        case 'min':
          out.set(id, nums.length ? Math.min(...nums) : null);
          break;
        case 'max':
          out.set(id, nums.length ? Math.max(...nums) : null);
          break;
      }
    }
    return out;
  }

  it('Werte je X-Gruppe und Serie stimmen mit der Referenz überein', async () => {
    const number = props.find((p) => p.type === 'number')!;
    const select = props.find((p) => p.type === 'select')!;
    await fc.assert(
      fc.asyncProperty(
        fc.option(specArb(), { nil: null }),
        fc.option(specArb(), { nil: null }),
        fc.constantFrom(...MEASURES),
        tzArb,
        fc.option(
          filterArb().filter((f) => depth(f) <= 3),
          { nil: null },
        ),
        async (x, series, measure, tz, filter) => {
          const value = measure === 'count' ? null : measure === 'count_unique' ? select : number;
          const ctx = ctxOf(filter, [], tz);
          const q = compileAggregateQuery(ctx, { x, series, measure, value });
          const got = await db.$queryRawUnsafe<
            { x: string; series: string; value: number | null }[]
          >(q.sql, ...q.parameters);
          const want = reference(ctx, x, series, measure, value, tz);
          expect(new Set(got.map((r) => `${r.x}|${r.series}`))).toEqual(new Set(want.keys()));
          for (const r of got) {
            const w = want.get(`${r.x}|${r.series}`);
            if (w === null || w === undefined) expect(r.value).toBeNull();
            else expect(r.value).toBeCloseTo(w, 6);
          }
        },
      ),
      { numRuns: 120, seed: 21 },
    );
  });
});
