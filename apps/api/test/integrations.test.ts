import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@jotion/db';
import {
  ConnectorError,
  recordVersion,
  SafeHttpClient,
  SecretBox,
  secretsContext,
  SyncEngine,
  type ConnectorDefinition,
  type ExternalRecord,
  type FieldValue,
} from '@jotion/integrations';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeCalDav } from '@jotion/integrations/testing';
import { SyncRunnerService } from '../src/integrations/sync-runner.service';
import { type Client, createTestApp, resetState, setupOwner } from './helpers';

/**
 * Phase 8: Integrationen. CalDAV-Ablauf über die API gegen einen Testserver, Sync-Engine mit
 * Speicher-Connector: Idempotenz, Konfliktmatrix, Löschungen, Abbruch und Fortsetzen, Sperre,
 * Fehlerstatus, Schlüsselrotation.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let owner: Client;
let ws: string;
let ownerId: string;

const KEY = Buffer.alloc(32, 7).toString('base64');

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
});

const ics = (uid: string, summary: string, extra = '', day = '20261112') => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//DE
BEGIN:VEVENT
UID:${uid}
DTSTAMP:20261101T000000Z
DTSTART:${day}T080000Z
DTEND:${day}T090000Z
SUMMARY:${summary}
${extra}END:VEVENT
END:VCALENDAR
`;

async function rows(databaseId: string) {
  const r = await owner.post(`/api/databases/${databaseId}/query`, { limit: 200 });
  expect(r.status).toBe(200);
  return r.body.rows as { id: string; title: string; values: Record<string, unknown> }[];
}

async function database(id: string) {
  return (await owner.get(`/api/databases/${id}`)).body as {
    properties: {
      id: string;
      name: string;
      type: string;
      config: { options?: { id: string; name: string }[] };
    }[];
  };
}

describe('CalDAV über die API', () => {
  let dav: FakeCalDav;
  beforeEach(async () => {
    dav = new FakeCalDav();
    await dav.start();
    dav.addCalendar('schule', 'Schule', ['VEVENT']);
    dav.addCalendar('aufgaben', 'Aufgaben', ['VTODO']);
    dav.put(
      'schule',
      'a.ics',
      ics(
        'a',
        'Klausur Mathe',
        'LOCATION:Raum 1\nCATEGORIES:Mathe\nDESCRIPTION:Kapitel 3\\nTaschenrechner\n',
      ),
    );
    dav.put('schule', 'b.ics', ics('b', 'Elternabend', 'CATEGORIES:Schule\n', '20261120'));
  });
  afterAll(async () => dav?.stop());

  async function connect() {
    const res = await owner.post(`/api/workspaces/${ws}/integrations`, {
      type: 'caldav',
      name: 'Schulkalender',
      config: { serverUrl: dav.url, username: 'anna' },
      secrets: { password: 'geheim' },
    });
    expect(res.status).toBe(201);
    return res.body as { id: string; sources: { id: string; name: string; enabled: boolean }[] };
  }

  it('testet, legt Ziel-Datenbank an, synchronisiert ohne Dubletten', async () => {
    const bad = await owner.post(`/api/workspaces/${ws}/integrations/test`, {
      type: 'caldav',
      config: { serverUrl: dav.url, username: 'anna' },
      secrets: { password: 'falsch' },
    });
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({ ok: false, error: { code: 'auth' } });

    const conn = await connect();
    expect(conn.sources.map((s) => [s.name, s.enabled])).toEqual([
      ['Schule', false],
      ['Aufgaben', false],
    ]);
    // Geheimnisse sind verschlüsselt gespeichert und werden nie ausgeliefert
    const stored = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(stored.secrets).toMatch(/^v1:/);
    expect(stored.secrets).not.toContain('geheim');
    const list = await owner.get(`/api/workspaces/${ws}/integrations`);
    expect(JSON.stringify(list.body)).not.toContain('geheim');
    expect(list.body[0].secretKeys).toEqual(['password']);

    const schule = conn.sources[0]!;
    const src = await owner.post(
      `/api/workspaces/${ws}/integrations/${conn.id}/sources/${schule.id}/database`,
      {
        title: 'Schultermine',
      },
    );
    expect(src.status).toBe(201);
    expect(src.body.enabled).toBe(true);
    const dbId = src.body.targetDatabaseId as string;

    const preview = await owner.post(
      `/api/workspaces/${ws}/integrations/${conn.id}/sources/${schule.id}/preview`,
      {},
    );
    expect(preview.status).toBe(200);
    expect(preview.body.rows.map((r: { title: string }) => r.title)).toEqual([
      'Klausur Mathe',
      'Elternabend',
    ]);
    expect(preview.body.newOptions.Kategorien.sort()).toEqual(['Mathe', 'Schule']);

    for (let i = 0; i < 3; i++) {
      const run = await owner.post(`/api/workspaces/${ws}/integrations/${conn.id}/sync`);
      expect(run.status).toBe(200);
      expect(run.body.run.status).toBe('succeeded');
      if (i === 0) expect(run.body.run.stats).toMatchObject({ created: 2, updated: 0 });
      else expect(run.body.run.stats).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    }
    const db = await database(dbId);
    const prop = (name: string) => db.properties.find((p) => p.name === name)!;
    const list2 = await rows(dbId);
    expect(list2.map((r) => r.title).sort()).toEqual(['Elternabend', 'Klausur Mathe']);
    const klausur = list2.find((r) => r.title === 'Klausur Mathe')!;
    expect(klausur.values[prop('Ort').id]).toBe('Raum 1');
    expect(klausur.values[prop('Datum').id]).toMatchObject({
      start: '2026-11-12T08:00:00.000Z',
      hasTime: true,
    });
    const mathe = prop('Kategorien').config.options!.find((o) => o.name === 'Mathe')!;
    expect(klausur.values[prop('Kategorien').id]).toEqual([mathe.id]);
    const aktiv = prop('Sync-Status').config.options!.find((o) => o.name === 'Aktiv')!;
    expect(klausur.values[prop('Sync-Status').id]).toBe(aktiv.id);
    const quelle = prop('Quelle').config.options!.find((o) => o.name === 'Schule')!;
    expect(klausur.values[prop('Quelle').id]).toBe(quelle.id);
    // Beschreibung als Seiteninhalt
    const doc = await prisma.pageDoc.findUnique({ where: { pageId: klausur.id } });
    expect(doc).not.toBeNull();

    // Lokale Änderung am Ort bleibt, Remote-Titeländerung kommt an, Konflikt wird protokolliert
    await owner.patch(`/api/databases/${dbId}/rows/${klausur.id}/properties`, {
      values: { [prop('Ort').id]: 'Aula' },
    });
    dav.put(
      'schule',
      'a.ics',
      ics('a', 'Klausur Mathematik', 'LOCATION:Raum 2\nCATEGORIES:Mathe\n'),
    );
    const run = await owner.post(`/api/workspaces/${ws}/integrations/${conn.id}/sync`);
    expect(run.body.run.stats).toMatchObject({ updated: 1, conflicts: 1 });
    const after = (await rows(dbId)).find((r) => r.id === klausur.id)!;
    expect(after.title).toBe('Klausur Mathematik');
    expect(after.values[prop('Ort').id]).toBe('Aula');
    const conflicts = await owner.get(`/api/workspaces/${ws}/integrations/${conn.id}/conflicts`);
    expect(conflicts.body).toHaveLength(1);
    expect(conflicts.body[0]).toMatchObject({
      fieldName: 'Ort',
      localValue: 'Aula',
      remoteValue: 'Raum 2',
    });
    const resolved = await owner.post(
      `/api/workspaces/${ws}/integrations/${conn.id}/conflicts/${conflicts.body[0].id}`,
      { resolution: 'remote' },
    );
    expect(resolved.status).toBe(200);
    expect((await rows(dbId)).find((r) => r.id === klausur.id)!.values[prop('Ort').id]).toBe(
      'Raum 2',
    );
    expect(
      (await owner.get(`/api/workspaces/${ws}/integrations/${conn.id}/conflicts`)).body,
    ).toHaveLength(0);

    // Remote gelöscht: markiert (Standard), nie gelöscht
    dav.remove('schule', 'b.ics');
    const del = await owner.post(`/api/workspaces/${ws}/integrations/${conn.id}/sync`);
    expect(del.body.run.stats).toMatchObject({ deleted: 1 });
    const eltern = (await rows(dbId)).find((r) => r.title === 'Elternabend')!;
    const entfernt = prop('Sync-Status').config.options!.find((o) => o.name === 'Entfernt')!;
    expect(eltern.values[prop('Sync-Status').id]).toBe(entfernt.id);

    // Lokal gelöscht: wird nicht neu angelegt
    await owner.post(`/api/databases/${dbId}/rows/trash`, { rowIds: [klausur.id] });
    dav.put('schule', 'a.ics', ics('a', 'Klausur Mathematik (neu)', 'LOCATION:Raum 2\n'));
    const sup = await owner.post(`/api/workspaces/${ws}/integrations/${conn.id}/sync`);
    expect(sup.body.run.stats).toMatchObject({ created: 0, skipped: 1 });
    expect((await rows(dbId)).map((r) => r.title)).toEqual(['Elternabend']);

    // Läufe und Trennen (Zeilen bleiben)
    const runs = await owner.get(`/api/workspaces/${ws}/integrations/${conn.id}/runs`);
    expect(runs.body.length).toBeGreaterThanOrEqual(6);
    const gone = await owner.del(`/api/workspaces/${ws}/integrations/${conn.id}`);
    expect(gone.status).toBe(204);
    expect(await prisma.externalEntity.count()).toBe(0);
    expect((await rows(dbId)).map((r) => r.title)).toEqual(['Elternabend']);
  });

  it('falsches Passwort beim Anlegen; Anmeldefehler im Lauf stoppt den Zeitplan', async () => {
    const res = await owner.post(`/api/workspaces/${ws}/integrations`, {
      type: 'caldav',
      name: 'X',
      config: { serverUrl: dav.url, username: 'anna' },
      secrets: { password: 'falsch' },
    });
    expect(res.status).toBe(422);

    const conn = await connect();
    await owner.patch(
      `/api/workspaces/${ws}/integrations/${conn.id}/sources/${conn.sources[0]!.id}`,
      {
        targetDatabaseId: (await owner.post(`/api/workspaces/${ws}/databases`, { title: 'Ziel' }))
          .body.id,
      },
    );
    // Passwort serverseitig geändert
    const box = app.get(SyncRunnerService).box;
    await prisma.integrationConnection.update({
      where: { id: conn.id },
      data: { secrets: box.encrypt(JSON.stringify({ password: 'alt' }), secretsContext(conn.id)) },
    });
    const run = await owner.post(`/api/workspaces/${ws}/integrations/${conn.id}/sync`);
    expect(run.body.run.status).toBe('failed');
    const c = (await owner.get(`/api/workspaces/${ws}/integrations/${conn.id}`)).body;
    expect(c.status).toBe('error');
    expect(c.statusMessage).toMatch(/Anmeldung/);
    // Zeitplan überspringt die Verbindung
    expect(await app.get(SyncRunnerService).engine.run(conn.id, 'schedule')).toEqual({
      skipped: 'disabled',
    });
    // Neues Passwort: geprüft, Status wieder aktiv
    const fixed = await owner.patch(`/api/workspaces/${ws}/integrations/${conn.id}`, {
      secrets: { password: 'geheim' },
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body.status).toBe('active');
  });

  it('andere Nutzer sehen fremde Verbindungen nicht', async () => {
    const conn = await connect();
    const { addMember } = await import('./helpers');
    const member = (await addMember(app, owner, ws, 'm@test.local')).client;
    expect((await member.get(`/api/workspaces/${ws}/integrations`)).body).toEqual([]);
    expect((await member.get(`/api/workspaces/${ws}/integrations/${conn.id}`)).status).toBe(404);
    expect((await member.post(`/api/workspaces/${ws}/integrations/${conn.id}/sync`)).status).toBe(
      404,
    );
  });
});

describe('iCal-Feed', () => {
  it('liest einen Feed und gleicht vollständig ab', async () => {
    let body = ics('x', 'Ferien');
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/calendar', ETag: `"${body.length}"` });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await owner.post(`/api/workspaces/${ws}/integrations`, {
        type: 'ical',
        name: 'Feed',
        config: { url: `http://127.0.0.1:${port}/feed.ics` },
      });
      expect(res.status).toBe(201);
      const sid = res.body.sources[0].id;
      const src = await owner.post(
        `/api/workspaces/${ws}/integrations/${res.body.id}/sources/${sid}/database`,
        { title: 'Feed' },
      );
      const run1 = await owner.post(`/api/workspaces/${ws}/integrations/${res.body.id}/sync`);
      expect(run1.body.run.stats).toMatchObject({ created: 1 });
      body = ics('y', 'Projektwoche');
      const run2 = await owner.post(`/api/workspaces/${ws}/integrations/${res.body.id}/sync`);
      expect(run2.body.run.stats).toMatchObject({ created: 1, deleted: 1 });
      expect((await rows(src.body.targetDatabaseId)).map((r) => r.title).sort()).toEqual([
        'Ferien',
        'Projektwoche',
      ]);
    } finally {
      server.close();
    }
  });
});

// ------------------------------------------------------------------ Sync-Engine mit Speicher-Connector

interface Mem {
  records: ExternalRecord[];
  complete: boolean;
  fail: Error | null;
  pulls: number;
}

function memConnector(mem: Mem): ConnectorDefinition {
  return {
    type: 'memory',
    displayName: 'Speicher',
    authKind: 'none',
    configFields: [],
    secretFields: [],
    capabilities: { kinds: ['event'], incremental: false, write: false },
    validateConfig: (c) => c,
    testConnection: async () => ({ accountLabel: 'mem', sources: [], capabilities: {} }),
    discoverSources: async () => [],
    pull: async () => {
      mem.pulls++;
      if (mem.fail) throw mem.fail;
      return {
        records: mem.records,
        deletedRefs: [],
        refreshedRefs: [],
        complete: mem.complete,
        cursor: { n: mem.pulls },
      };
    },
  };
}

const rec = (id: string, fields: Record<string, FieldValue>): ExternalRecord => ({
  externalId: id,
  weakId: false,
  remoteRef: null,
  kind: 'event',
  version: recordVersion('event', fields),
  fields,
});

describe('Sync-Engine', () => {
  let mem: Mem;
  let engine: SyncEngine;
  let dbId: string;
  let props: Record<string, string>;
  let options: Record<string, string>;
  let connId: string;
  let sourceId: string;

  const makeEngine = (extra: Partial<ConstructorParameters<typeof SyncEngine>[0]> = {}) =>
    new SyncEngine({
      prisma,
      box: app.get(SyncRunnerService).box,
      http: () => new SafeHttpClient(),
      timeZone: 'Europe/Berlin',
      connectors: { memory: memConnector(mem) },
      ...extra,
    });

  async function setup(ownership: 'remote' | 'local_preserve' | 'once', policy = 'mark') {
    const d = (
      await owner.post(`/api/workspaces/${ws}/databases`, { scope: 'TEAM', title: 'Termine' })
    ).body;
    dbId = d.id;
    const add = async (name: string, type: string, config?: object) =>
      (
        await owner.post(`/api/databases/${dbId}/properties`, {
          name,
          type,
          ...(config ? { config } : {}),
        })
      ).body;
    const ort = await add('Ort', 'text');
    const datum = await add('Datum', 'date');
    const status = await add('Sync-Status', 'select', {
      options: [
        { id: crypto.randomUUID(), name: 'Aktiv', color: 'green' },
        { id: crypto.randomUUID(), name: 'Entfernt', color: 'red' },
      ],
    });
    props = { ort: ort.id, datum: datum.id, status: status.id };
    options = Object.fromEntries(
      (status.config.options as { id: string; name: string }[]).map((o) => [o.name, o.id]),
    );
    const conn = await prisma.integrationConnection.create({
      data: { workspaceId: ws, ownerId, type: 'memory', name: 'Speicher', config: {} },
    });
    connId = conn.id;
    const src = await prisma.integrationSource.create({
      data: {
        connectionId: conn.id,
        remoteId: 'mem',
        name: 'Speicher',
        kinds: ['event'],
        enabled: true,
        targetDatabaseId: dbId,
        deletionPolicy: policy,
        mapping: {
          fields: [
            { source: 'title', target: 'title', ownership: 'remote' },
            { source: 'location', target: ort.id, ownership },
            { source: 'date', target: datum.id, ownership },
          ],
          descriptionToContent: false,
          syncStatusPropertyId: status.id,
        },
      },
    });
    sourceId = src.id;
  }

  beforeEach(() => {
    mem = { records: [], complete: true, fail: null, pulls: 0 };
    engine = makeEngine();
  });

  const date = (day: string) => ({ start: day, end: null, hasTime: false });
  const run = () => engine.run(connId, 'manual');
  const only = async () => {
    const r = await rows(dbId);
    expect(r).toHaveLength(1);
    return r[0]!;
  };

  describe('Konfliktmatrix (lokal geändert × remote geändert × Ownership)', () => {
    const cases: [string, boolean, boolean, string, number][] = [
      // ownership, lokal, remote, erwarteter Ort, Konflikte
      ['remote', false, false, 'A', 0],
      ['remote', true, false, 'A', 0],
      ['remote', false, true, 'R', 0],
      ['remote', true, true, 'R', 0],
      ['local_preserve', false, false, 'A', 0],
      ['local_preserve', true, false, 'L', 0],
      ['local_preserve', false, true, 'R', 0],
      ['local_preserve', true, true, 'L', 1],
      ['once', false, false, 'A', 0],
      ['once', true, false, 'L', 0],
      ['once', false, true, 'A', 0],
      ['once', true, true, 'L', 0],
    ];
    for (const [ownership, local, remote, expected, conflicts] of cases) {
      it(`${ownership}: lokal ${local ? 'ja' : 'nein'}, remote ${remote ? 'ja' : 'nein'} → ${expected}`, async () => {
        await setup(ownership as 'remote');
        mem.records = [rec('e1', { title: 'T1', location: 'A', date: date('2026-11-12') })];
        expect(await run()).toMatchObject({ status: 'succeeded', stats: { created: 1 } });
        const row = await only();
        if (local)
          await owner.patch(`/api/databases/${dbId}/rows/${row.id}/properties`, {
            values: { [props.ort!]: 'L' },
          });
        // Titel ändert sich immer, damit der Datensatz neu verarbeitet wird
        mem.records = [
          rec('e1', { title: 'T2', location: remote ? 'R' : 'A', date: date('2026-11-12') }),
        ];
        const out = await run();
        expect(out).toMatchObject({ status: 'succeeded', stats: { conflicts } });
        const after = await only();
        expect(after.title).toBe('T2');
        expect(after.values[props.ort!]).toBe(expected);
        expect(await prisma.syncConflict.count({ where: { resolvedAt: null } })).toBe(conflicts);
        // Erneuter Lauf mit denselben Daten: keine weiteren Konflikte, nichts geändert
        expect(await run()).toMatchObject({ stats: { updated: 0, conflicts: 0, unchanged: 1 } });
      });
    }

    it('Konflikt bleibt bis zur Auflösung, ein offener je Feld', async () => {
      await setup('local_preserve');
      mem.records = [rec('e1', { title: 'T', location: 'A', date: null })];
      await run();
      const row = await only();
      await owner.patch(`/api/databases/${dbId}/rows/${row.id}/properties`, {
        values: { [props.ort!]: 'L' },
      });
      mem.records = [rec('e1', { title: 'T', location: 'R1', date: null })];
      await run();
      mem.records = [rec('e1', { title: 'T', location: 'R2', date: null })];
      await run();
      const open = await prisma.syncConflict.findMany({ where: { resolvedAt: null } });
      expect(open).toHaveLength(1);
      expect(open[0]!.remoteValue).toBe('R2');
      // Lokal behalten: nächster Lauf ohne Remote-Änderung bleibt ruhig
      await engine.resolveConflict(open[0]!.id, 'local', ownerId);
      mem.records = [rec('e1', { title: 'T!', location: 'R2', date: null })];
      expect(await run()).toMatchObject({ stats: { conflicts: 0 } });
      expect((await only()).values[props.ort!]).toBe('L');
    });
  });

  describe('Löschungen', () => {
    for (const policy of ['mark', 'archive', 'trash'] as const) {
      it(`Richtlinie ${policy}, auch mit lokaler Änderung; Rückkehr stellt wieder her`, async () => {
        await setup('local_preserve', policy);
        mem.records = [
          rec('e1', { title: 'T', location: 'A', date: null }),
          rec('e2', { title: 'U', location: 'B', date: null }),
        ];
        await run();
        const before = await rows(dbId);
        const t = before.find((r) => r.title === 'T')!;
        await owner.patch(`/api/databases/${dbId}/rows/${t.id}/properties`, {
          values: { [props.ort!]: 'L' },
        });
        mem.records = [rec('e2', { title: 'U', location: 'B', date: null })];
        expect(await run()).toMatchObject({ stats: { deleted: 1 } });
        const page = await prisma.page.findUniqueOrThrow({ where: { id: t.id } });
        // Nie endgültig gelöscht
        expect(page).toBeTruthy();
        expect(Boolean(page.archivedAt)).toBe(policy === 'archive');
        expect(Boolean(page.deletedAt)).toBe(policy === 'trash');
        const status = await prisma.propertyValue.findUnique({
          where: { rowId_propertyId: { rowId: t.id, propertyId: props.status! } },
        });
        expect(status?.vOptionIds).toEqual([options.Entfernt]);
        // Wieder da: dieselbe Zeile, aktiv, lokale Änderung erhalten
        mem.records = [
          rec('e1', { title: 'T', location: 'A', date: null }),
          rec('e2', { title: 'U', location: 'B', date: null }),
        ];
        await run();
        const back = await prisma.page.findUniqueOrThrow({ where: { id: t.id } });
        expect(back.deletedAt).toBeNull();
        expect(back.archivedAt).toBeNull();
        const all = await rows(dbId);
        expect(all).toHaveLength(2);
        const again = all.find((r) => r.id === t.id)!;
        expect(again.values[props.status!]).toBe(options.Aktiv);
        expect(again.values[props.ort!]).toBe('L');
      });
    }

    it('leere vollständige Antwort löscht nichts (Schutz vor Serverfehlern)', async () => {
      await setup('local_preserve');
      mem.records = [rec('e1', { title: 'T', location: 'A', date: null })];
      await run();
      mem.records = [];
      const out = await run();
      expect(out).toMatchObject({ status: 'partial', stats: { deleted: 0 } });
    });

    it('Einzeltermine, die aus dem Zeitfenster wandern, gelten nicht als gelöscht', async () => {
      await setup('local_preserve');
      mem.records = [
        rec('s#2020-01-01', { title: 'Alt', location: null, date: null }),
        rec('n', { title: 'Neu', location: null, date: null }),
      ];
      await run();
      mem.records = [rec('n', { title: 'Neu', location: null, date: null })];
      expect(await run()).toMatchObject({ stats: { deleted: 0 } });
    });
  });

  it('Idempotenz: dreimal derselbe Stand, parallele Auslöser, keine Dubletten', async () => {
    await setup('local_preserve');
    mem.records = Array.from({ length: 30 }, (_, i) =>
      rec(`e${i}`, { title: `T${i}`, location: 'X', date: date('2026-11-12') }),
    );
    const results = await Promise.all([run(), run(), run()]);
    expect(results.filter((r) => 'skipped' in r)).toHaveLength(2);
    await run();
    await run();
    expect(await rows(dbId)).toHaveLength(30);
    expect(await prisma.externalEntity.count()).toBe(30);
  });

  it('Abbruch mitten im Lauf: konsistent, nächster Lauf setzt fort ohne Dubletten', async () => {
    await setup('local_preserve');
    mem.records = Array.from({ length: 10 }, (_, i) =>
      rec(`e${i}`, { title: `T${i}`, location: 'X', date: null }),
    );
    // Absturz nach 4 Datensätzen (wie kill -9: kein Aufräumen, Sperre und Lauf bleiben stehen)
    const crashing = makeEngine({
      afterRecord: (n) => {
        if (n === 4) throw new Error('kill -9');
      },
    });
    const crashed = await crashing.run(connId, 'manual');
    expect(crashed).toMatchObject({ status: 'failed' });
    expect(await rows(dbId)).toHaveLength(4);
    // Cursor wurde nicht gespeichert
    expect(
      (await prisma.integrationSource.findUniqueOrThrow({ where: { id: sourceId } })).cursor,
    ).toBeNull();

    // Harter Absturz: Sperre und laufender Lauf bleiben zurück
    const hard = await prisma.syncRun.create({
      data: { connectionId: connId, trigger: 'schedule' },
    });
    await prisma.$executeRaw`UPDATE integration_connections SET sync_lock_id = gen_random_uuid(), sync_locked_until = now() + interval '1 minute' WHERE id = ${connId}::uuid`;
    expect(await run()).toEqual({ skipped: 'locked' });
    // Sperre verfällt
    await prisma.$executeRaw`UPDATE integration_connections SET sync_locked_until = now() - interval '1 second' WHERE id = ${connId}::uuid`;
    expect(await run()).toMatchObject({ status: 'succeeded', stats: { created: 6, unchanged: 4 } });
    expect(await rows(dbId)).toHaveLength(10);
    expect(await prisma.externalEntity.count()).toBe(10);
    expect((await prisma.syncRun.findUniqueOrThrow({ where: { id: hard.id } })).status).toBe(
      'failed',
    );
  });

  it('nach 5 Fehlschlägen pausiert; Anmeldefehler setzt Fehlerstatus', async () => {
    await setup('local_preserve');
    mem.fail = new Error('Server antwortet nicht');
    for (let i = 0; i < 5; i++) await run();
    let c = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(c.status).toBe('paused');
    expect(c.consecutiveFailures).toBe(5);
    expect(await engine.run(connId, 'schedule')).toEqual({ skipped: 'disabled' });
    await prisma.integrationConnection.update({
      where: { id: connId },
      data: { status: 'active' },
    });
    mem.fail = new ConnectorError('auth', 'Anmeldung fehlgeschlagen');
    await run();
    c = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(c.status).toBe('error');
    mem.fail = null;
    mem.records = [rec('e1', { title: 'T', location: null, date: null })];
    await run();
    c = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(c).toMatchObject({ status: 'active', consecutiveFailures: 0 });
  });

  it('Mapping-Änderung wendet alle Datensätze neu an', async () => {
    await setup('remote');
    mem.records = [rec('e1', { title: 'T', location: 'A', date: null, organizer: 'Frau M.' })];
    await run();
    const src = await prisma.integrationSource.findUniqueOrThrow({ where: { id: sourceId } });
    const mapping = src.mapping as {
      fields: { source: string; target: string; ownership: string }[];
    };
    mapping.fields[1]!.source = 'organizer';
    await prisma.integrationSource.update({ where: { id: sourceId }, data: { mapping } });
    expect(await run()).toMatchObject({ stats: { updated: 1 } });
    expect((await only()).values[props.ort!]).toBe('Frau M.');
  });

  it('Schlüsselrotation: alte Geheimnisse lesbar, beim Lesen neu verschlüsselt', async () => {
    await setup('local_preserve');
    const old = new SecretBox(KEY);
    await prisma.integrationConnection.update({
      where: { id: connId },
      data: { secrets: old.encrypt(JSON.stringify({ password: 'p' }), secretsContext(connId)) },
    });
    const rotated = new SecretBox(process.env.JOTION_MASTER_KEY!, [KEY]);
    const e = makeEngine({ box: rotated });
    expect(
      await e.secretsOf(
        await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connId } }),
      ),
    ).toEqual({ password: 'p' });
    const stored = (await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connId } }))
      .secrets!;
    expect(rotated.needsRotation(stored)).toBe(false);
    expect(() => old.decrypt(stored, secretsContext(connId))).toThrow();
    // Falscher Kontext (andere Verbindung) schlägt fehl
    expect(() => rotated.decrypt(stored, secretsContext(crypto.randomUUID()))).toThrow();
  });
});
