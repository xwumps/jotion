import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AutomationEngine } from '../src/automations/automation-engine';
import { RedisService } from '../src/infra/redis.service';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/**
 * Phase 9: Automation-Engine. Auslöser (Zeile erstellt, Property geändert, Zeitplan, Datum
 * erreicht, Button), Bedingungen, Aktionen (Property setzen, auch verknüpfte Zeilen; Zeile
 * anlegen; Webhook signiert), Variablen, Idempotenz, Kettentiefe, Rate-Limit, Rechte.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let owner: Client;
let ws: string;
let ownerId: string;

beforeAll(async () => {
  process.env.JOTION_SSRF_ALLOWLIST = '127.0.0.1';
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
  ownerId = (await prisma.user.findFirstOrThrow({ where: { email: 'owner@test.local' } })).id;
  const keys = await app.get(RedisService).client.keys('jotion:autorl:*');
  if (keys.length) await app.get(RedisService).client.del(...keys);
});

interface Prop {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = <T = any>(res: { status: number; body: unknown }, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as T;
};
const db = async (title: string) =>
  ok(await owner.post(`/api/workspaces/${ws}/databases`, { title, scope: 'TEAM' }), 201);
const prop = async (dbId: string, body: object): Promise<Prop> =>
  ok(await owner.post(`/api/databases/${dbId}/properties`, body), 201);
const row = async (dbId: string, title: string, values: object = {}) =>
  ok(await owner.post(`/api/databases/${dbId}/rows`, { title, values }), 201);
const getRow = async (dbId: string, id: string) =>
  ok(await owner.get(`/api/databases/${dbId}/rows/${id}`));
const setRow = async (dbId: string, id: string, values: object, title?: string) =>
  ok(
    await owner.patch(`/api/databases/${dbId}/rows/${id}/properties`, {
      values,
      ...(title ? { title } : {}),
    }),
  );
const automation = async (body: object) =>
  ok(await owner.post(`/api/workspaces/${ws}/automations`, body), 201);
const runs = async (id: string) =>
  ok<{ status: string; chainDepth: number; error: string | null; details: unknown[] }[]>(
    await owner.get(`/api/automations/${id}/runs`),
  );

async function tasks() {
  const d = await db('Aufgaben');
  const status = await prop(d.id, { name: 'Status', type: 'status' });
  const doneAt = await prop(d.id, { name: 'Erledigt am', type: 'date' });
  const options = status.config.options as { id: string; name: string; group: string }[];
  return {
    d,
    status,
    doneAt,
    todo: options[0]!.id,
    todoName: options[0]!.name,
    done: options.find((o) => o.group === 'complete')!.id,
  };
}

describe('Akzeptanz', () => {
  it('"Status = Erledigt → Datum Abgeschlossen setzen" greift in unter 2 s', async () => {
    const s = await tasks();
    const a = await automation({
      name: 'Erledigt-Datum',
      databaseId: s.d.id,
      trigger: { type: 'property_changed', propertyId: s.status.id },
      conditions: {
        type: 'group',
        op: 'and',
        children: [{ type: 'condition', propertyId: s.status.id, operator: 'is', value: s.done }],
      },
      actions: [
        { type: 'set_property', propertyId: s.doneAt.id, value: { kind: 'today', offsetDays: 0 } },
      ],
    });
    const r = await row(s.d.id, 'Steuer', { [s.status.id]: s.todo });
    // Andere Status: Bedingung nicht erfüllt, kein Lauf
    await setRow(s.d.id, r.id, { [s.status.id]: s.todo });
    expect(await runs(a.id)).toHaveLength(0);
    const t0 = performance.now();
    await setRow(s.d.id, r.id, { [s.status.id]: s.done });
    const after = await getRow(s.d.id, r.id);
    const ms = performance.now() - t0;
    expect(after.values[s.doneAt.id]).toMatchObject({ hasTime: false });
    expect(ms).toBeLessThan(2000);
    const log = await runs(a.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: 'succeeded', chainDepth: 0 });
    const dto = ok(await owner.get(`/api/workspaces/${ws}/automations?databaseId=${s.d.id}`));
    expect(dto[0]).toMatchObject({
      name: 'Erledigt-Datum',
      lastRun: { status: 'succeeded' },
      createdBy: { name: 'Olivia Owner' },
    });
  });

  it('Endlosschleife wird bei Tiefe 5 gestoppt und protokolliert', async () => {
    const d = await db('Zähler');
    const n = await prop(d.id, { name: 'N', type: 'number' });
    const a = await automation({
      name: 'Hochzählen',
      databaseId: d.id,
      trigger: { type: 'property_changed', propertyId: n.id },
      actions: [
        {
          type: 'set_property',
          propertyId: n.id,
          value: { kind: 'formula', expression: 'prop("N") + 1' },
        },
      ],
    });
    const r = await row(d.id, 'x', { [n.id]: 0 });
    await setRow(d.id, r.id, { [n.id]: 1 });
    const log = await runs(a.id);
    expect(log.map((x) => x.status).sort()).toEqual([
      'stopped',
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    const stopped = log.find((x) => x.status === 'stopped')!;
    expect(stopped).toMatchObject({ chainDepth: 5, error: expect.stringMatching(/Kettentiefe 5/) });
    expect((await getRow(d.id, r.id)).values[n.id]).toBe(6);
  });
});

describe('Aktionen und Auslöser', () => {
  it('Zeile erstellt → Zeile in anderer Datenbank mit Verknüpfung und Platzhaltern', async () => {
    const s = await tasks();
    const log = await db('Protokoll');
    const link = await prop(log.id, {
      name: 'Aufgabe',
      type: 'relation',
      config: { targetDatabaseId: s.d.id },
    });
    const note = await prop(log.id, { name: 'Notiz', type: 'text' });
    await automation({
      name: 'Protokollieren',
      databaseId: s.d.id,
      trigger: { type: 'row_created' },
      actions: [
        {
          type: 'create_row',
          databaseId: log.id,
          title: 'Neu: {{title}}',
          values: { [note.id]: { kind: 'text', text: 'Status {{Status}} am {{today}}' } },
          linkPropertyId: link.id,
        },
      ],
    });
    const r = await row(s.d.id, 'Einkaufen', { [s.status.id]: s.todo });
    const entries = ok(await owner.post(`/api/databases/${log.id}/query`, {})).rows;
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Neu: Einkaufen');
    expect(entries[0].values[link.id]).toEqual([r.id]);
    expect(entries[0].values[note.id]).toMatch(
      new RegExp(`^Status ${s.todoName} am \\d{4}-\\d{2}-\\d{2}$`),
    );
  });

  it('verknüpfte Zeilen bearbeiten (Projekt fertig → Aufgaben erledigt)', async () => {
    const s = await tasks();
    const projects = await db('Projekte');
    const finished = await prop(projects.id, { name: 'Fertig', type: 'checkbox' });
    const rel = await prop(projects.id, {
      name: 'Aufgaben',
      type: 'relation',
      config: { targetDatabaseId: s.d.id },
    });
    const t1 = await row(s.d.id, 'A', { [s.status.id]: s.todo });
    const t2 = await row(s.d.id, 'B', { [s.status.id]: s.todo });
    const p = await row(projects.id, 'P', { [rel.id]: [t1.id, t2.id] });
    await automation({
      name: 'Abschließen',
      databaseId: projects.id,
      trigger: { type: 'property_changed', propertyId: finished.id },
      conditions: {
        type: 'group',
        op: 'and',
        children: [{ type: 'condition', propertyId: finished.id, operator: 'is', value: true }],
      },
      actions: [
        {
          type: 'set_property',
          target: { kind: 'related', relationPropertyId: rel.id },
          propertyId: s.status.id,
          value: { kind: 'static', value: s.done },
        },
      ],
    });
    await setRow(projects.id, p.id, { [finished.id]: true });
    expect((await getRow(s.d.id, t1.id)).values[s.status.id]).toBe(s.done);
    expect((await getRow(s.d.id, t2.id)).values[s.status.id]).toBe(s.done);
  });

  it('Button-Property schaltet um und trägt die klickende Person ein', async () => {
    const d = await db('Liste');
    const flag = await prop(d.id, { name: 'Markiert', type: 'checkbox' });
    const by = await prop(d.id, { name: 'Von', type: 'person' });
    const btn = await prop(d.id, {
      name: 'Markieren',
      type: 'button',
      config: { label: 'Markieren' },
    });
    const a = await automation({
      name: 'Markieren',
      databaseId: d.id,
      trigger: { type: 'button', propertyId: btn.id },
      actions: [
        { type: 'set_property', propertyId: flag.id, value: { kind: 'toggle' } },
        { type: 'set_property', propertyId: by.id, value: { kind: 'trigger_user' } },
      ],
    });
    // Das Property zeigt jetzt auf die Automatisierung
    const props = ok(await owner.get(`/api/databases/${d.id}`)).properties as Prop[];
    expect(props.find((p) => p.id === btn.id)!.config).toMatchObject({ automationId: a.id });
    const r = await row(d.id, 'x');
    expect(ok(await owner.post(`/api/databases/${d.id}/rows/${r.id}/buttons/${btn.id}`))).toEqual({
      queued: false,
      status: 'succeeded',
    });
    expect((await getRow(d.id, r.id)).values).toMatchObject({
      [flag.id]: true,
      [by.id]: [ownerId],
    });
    await owner.post(`/api/databases/${d.id}/rows/${r.id}/buttons/${btn.id}`);
    expect((await getRow(d.id, r.id)).values[flag.id]).toBeUndefined();
    // Button-Werte lassen sich nicht direkt setzen
    expect(
      (
        await owner.patch(`/api/databases/${d.id}/rows/${r.id}/properties`, {
          values: { [btn.id]: true },
        })
      ).status,
    ).toBe(422);
  });

  it('Button-Block (ohne Datenbank) legt eine Zeile aus Vorlage an', async () => {
    const s = await tasks();
    const tpl = ok(
      await owner.post(`/api/databases/${s.d.id}/templates`, { title: 'Wochenplan' }),
      201,
    );
    await setRow(s.d.id, tpl.id, { [s.status.id]: s.todo });
    const a = await automation({
      name: 'Neue Woche',
      databaseId: null,
      trigger: { type: 'button' },
      actions: [
        { type: 'create_row', databaseId: s.d.id, templateId: tpl.id, title: 'Woche {{today}}' },
      ],
    });
    expect(
      ok(await owner.get(`/api/workspaces/${ws}/automations`)).map((x: { id: string }) => x.id),
    ).toEqual([a.id]);
    expect(ok(await owner.post(`/api/automations/${a.id}/run`))).toMatchObject({
      status: 'succeeded',
    });
    const rows = ok(await owner.post(`/api/databases/${s.d.id}/query`, {})).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toMatch(/^Woche \d{4}-/);
    expect(rows[0].values[s.status.id]).toBe(s.todo);
  });

  it('Zeitplan je Zeile und "Datum erreicht" (Fälligkeit minus 1 Tag)', async () => {
    const s = await tasks();
    const due = await prop(s.d.id, { name: 'Fällig', type: 'date' });
    const remind = await prop(s.d.id, { name: 'Erinnert', type: 'checkbox' });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const r1 = await row(s.d.id, 'Morgen', { [due.id]: { start: tomorrow } });
    const r2 = await row(s.d.id, 'Später', { [due.id]: { start: later } });
    const a = await automation({
      name: 'Erinnern',
      databaseId: s.d.id,
      trigger: { type: 'date_reached', propertyId: due.id, offsetDays: -1, time: '08:00' },
      actions: [
        { type: 'set_property', propertyId: remind.id, value: { kind: 'static', value: true } },
      ],
    });
    expect(a.nextRunAt).not.toBeNull();
    const engine = app.get(AutomationEngine);
    await prisma.automation.update({
      where: { id: a.id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
    await engine.tick();
    expect((await getRow(s.d.id, r1.id)).values[remind.id]).toBe(true);
    expect((await getRow(s.d.id, r2.id)).values[remind.id]).toBeUndefined();
    // Nächster Lauf morgen; gleicher Zeitpunkt läuft nicht doppelt
    const next = (await prisma.automation.findUniqueOrThrow({ where: { id: a.id } })).nextRunAt!;
    expect(next.getTime()).toBeGreaterThan(Date.now());

    // Zeitplan je Zeile mit Bedingung
    const sched = await automation({
      name: 'Täglich',
      databaseId: s.d.id,
      trigger: { type: 'schedule', every: 'day', time: '06:00', forEachRow: true },
      conditions: {
        type: 'group',
        op: 'and',
        children: [{ type: 'condition', propertyId: remind.id, operator: 'is', value: true }],
      },
      actions: [
        { type: 'set_property', propertyId: s.status.id, value: { kind: 'static', value: s.done } },
      ],
    });
    await prisma.automation.update({
      where: { id: sched.id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
    await engine.tick();
    expect((await getRow(s.d.id, r1.id)).values[s.status.id]).toBe(s.done);
    expect((await getRow(s.d.id, r2.id)).values[s.status.id]).toBeUndefined();
  });

  it('Webhook mit HMAC-Signatur und Zeilenwerten', async () => {
    const s = await tasks();
    const received: { body: string; sig: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ body, sig: String(req.headers['x-jotion-signature']) });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
      const a = await automation({
        name: 'Melden',
        databaseId: s.d.id,
        trigger: { type: 'row_created' },
        actions: [{ type: 'webhook', url, includeRow: true }],
      });
      expect(a.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
      await row(s.d.id, 'Melde mich', { [s.status.id]: s.todo });
      expect(received).toHaveLength(1);
      const expected = createHmac('sha256', a.webhookSecret)
        .update(received[0]!.body)
        .digest('hex');
      expect(received[0]!.sig).toBe(`sha256=${expected}`);
      expect(JSON.parse(received[0]!.body)).toMatchObject({
        automation: { name: 'Melden' },
        trigger: 'row_created',
        row: { title: 'Melde mich', values: { Status: s.todoName } },
      });
    } finally {
      server.close();
    }
  });
});

describe('Robustheit', () => {
  it('Idempotenz: dieselbe Auslösung läuft nur einmal; Fehler werden protokolliert', async () => {
    const s = await tasks();
    const a = await automation({
      name: 'Datum',
      databaseId: s.d.id,
      trigger: { type: 'button' },
      actions: [{ type: 'set_property', propertyId: s.doneAt.id, value: { kind: 'now' } }],
    });
    const r = await row(s.d.id, 'x');
    const engine = app.get(AutomationEngine);
    const job = { automationId: a.id, eventKey: 'test:1', rowId: r.id, actorId: ownerId, depth: 0 };
    const [x, y] = await Promise.all([engine.execute(job), engine.execute(job)]);
    expect([x.status, y.status].sort()).toEqual(['duplicate', 'succeeded']);
    expect(await runs(a.id)).toHaveLength(1);

    // Fehlerhafte Aktion (Option gibt es nicht): Lauf "failed" mit Meldung
    ok(
      await owner.patch(`/api/automations/${a.id}`, {
        actions: [
          {
            type: 'set_property',
            propertyId: s.status.id,
            value: { kind: 'text', text: 'Gibt es nicht' },
          },
        ],
      }),
    );
    expect(await engine.execute({ ...job, eventKey: 'test:2' })).toMatchObject({
      status: 'failed',
    });
    expect((await runs(a.id))[0]).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/Gibt es nicht/),
    });
  });

  it('Rate-Limit: mehr als 60 Läufe pro Minute werden übersprungen', async () => {
    const s = await tasks();
    const a = await automation({
      name: 'Viel',
      databaseId: s.d.id,
      trigger: { type: 'button' },
      actions: [{ type: 'set_property', propertyId: s.doneAt.id, value: { kind: 'now' } }],
    });
    const r = await row(s.d.id, 'x');
    const minute = Math.floor(Date.now() / 60_000);
    await app.get(RedisService).client.set(`jotion:autorl:${a.id}:${minute}`, 60, 'EX', 120);
    const res = await app
      .get(AutomationEngine)
      .execute({ automationId: a.id, eventKey: 'rl', rowId: r.id, actorId: null, depth: 0 });
    expect(res.status).toBe('skipped');
    expect((await runs(a.id))[0]).toMatchObject({
      status: 'skipped',
      error: expect.stringMatching(/60/),
    });
  });

  it('Validierung und Rechte', async () => {
    const s = await tasks();
    const other = await db('Andere');
    const foreign = await prop(other.id, { name: 'X', type: 'text' });
    expect(
      (
        await owner.post(`/api/workspaces/${ws}/automations`, {
          name: 'Falsch',
          databaseId: s.d.id,
          trigger: { type: 'property_changed', propertyId: foreign.id },
          actions: [{ type: 'set_property', propertyId: s.doneAt.id, value: { kind: 'now' } }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await owner.post(`/api/workspaces/${ws}/automations`, {
          name: 'Ohne DB',
          databaseId: null,
          trigger: { type: 'row_created' },
          actions: [{ type: 'webhook', url: 'https://example.com' }],
        })
      ).status,
    ).toBe(422);
    const priv = ok(await owner.post(`/api/workspaces/${ws}/databases`, { title: 'Privat' }), 201);
    const p = await prop(priv.id, { name: 'D', type: 'date' });
    const a = await automation({
      name: 'Privat',
      databaseId: priv.id,
      trigger: { type: 'row_created' },
      actions: [
        { type: 'set_property', propertyId: p.id, value: { kind: 'today', offsetDays: 0 } },
      ],
    });
    const member = (await addMember(app, owner, ws, 'm@test.local')).client;
    expect((await member.get(`/api/automations/${a.id}`)).status).toBe(404);
    expect(
      (await member.get(`/api/workspaces/${ws}/automations?databaseId=${priv.id}`)).status,
    ).toBe(404);
    // Abschalten und Löschen
    ok(await owner.patch(`/api/automations/${a.id}`, { enabled: false }));
    await row(priv.id, 'x');
    expect(await runs(a.id)).toHaveLength(0);
    expect((await owner.del(`/api/automations/${a.id}`)).status).toBe(204);
  });
});
