import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PERMISSION_LEVELS, type PermissionLevel } from '@jotion/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RealtimeService } from '../src/events/realtime.service';
import { PrismaService } from '../src/infra/prisma.service';
import { addMember, Client, createTestApp, resetState, setupOwner } from './helpers';

/**
 * Phase 10: Zugriffsstufen je Mitglied, Vererbung, Lese-Link und Leak-Tests.
 *  owner  = Workspace-Owner
 *  member = Mitglied, dessen Stufe variiert
 *  other  = weiteres Mitglied ohne Angabe
 */
let app: NestFastifyApplication;
let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let ownerId: string;
let memberId: string;
let otherId: string;

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
  ownerId = o.userId;
  const m = await addMember(app, owner, ws, 'member@test.local');
  member = m.client;
  memberId = m.userId;
  const x = await addMember(app, owner, ws, 'other@test.local');
  other = x.client;
  otherId = x.userId;
});

const create = (c: Client, body: object) => c.post(`/api/workspaces/${ws}/pages`, body);
const share = (c: Client, pageId: string, userId: string | null, level: PermissionLevel | null) =>
  c.put(`/api/pages/${pageId}/permissions`, { userId, level });

type Action = { name: string; run: (pageId: string, dbId: string) => Promise<number> };

/** Aktionen der Matrix; Ergebnis ist der HTTP-Status für das Mitglied */
const ACTIONS: Action[] = [
  { name: 'Seite lesen', run: async (id) => (await member.get(`/api/pages/${id}`)).status },
  {
    name: 'Inhalt lesen',
    run: async (id) => (await member.get(`/api/pages/${id}/content`)).status,
  },
  {
    name: 'In Suche gefunden',
    run: async () => {
      const r = await member.get(`/api/workspaces/${ws}/search/content?q=Matrixseite`);
      return r.body.length > 0 ? 200 : 404;
    },
  },
  {
    name: 'Titel ändern',
    run: async (id) => (await member.patch(`/api/pages/${id}`, { title: 'Matrixseite' })).status,
  },
  {
    name: 'Unterseite anlegen',
    run: async (id) => (await create(member, { parentId: id, title: 'Kind' })).status,
  },
  {
    name: 'Zeile lesen (Datenbank darunter)',
    run: async (_id, db) => (await member.post(`/api/databases/${db}/query`, {})).status,
  },
  {
    name: 'Zeile anlegen (Datenbank darunter)',
    run: async (_id, db) => (await member.post(`/api/databases/${db}/rows`, { title: 'r' })).status,
  },
  {
    name: 'Freigabe ändern',
    run: async (id) => (await share(member, id, otherId, 'view')).status,
  },
  {
    name: 'Lese-Link erzeugen',
    run: async (id) => (await member.post(`/api/pages/${id}/share-link`)).status,
  },
  {
    name: 'In den Papierkorb',
    run: async (id) => (await member.del(`/api/pages/${id}`)).status,
  },
];

const EXPECTED: Record<PermissionLevel, number[]> = {
  full: [200, 200, 200, 200, 201, 200, 201, 200, 201, 204],
  edit: [200, 200, 200, 200, 201, 200, 201, 403, 403, 204],
  comment: [200, 200, 200, 403, 403, 200, 403, 403, 403, 403],
  view: [200, 200, 200, 403, 403, 200, 403, 403, 403, 403],
  none: [404, 404, 404, 404, 404, 404, 404, 404, 404, 404],
};

describe('Berechtigungsmatrix (Team-Seite, Angabe für das Mitglied)', () => {
  const results: Record<string, number[]> = {};

  for (const level of PERMISSION_LEVELS) {
    it(`Stufe ${level}`, async () => {
      const page = (await create(owner, { title: 'Matrixseite', scope: 'TEAM' })).body;
      const db = (
        await owner.post(`/api/workspaces/${ws}/databases`, { title: 'DB', parentId: page.id })
      ).body;
      expect((await share(owner, page.id, memberId, level)).status).toBe(200);
      const got: number[] = [];
      // Papierkorb zuletzt, sonst fehlt die Seite den übrigen Aktionen
      for (const a of ACTIONS) got.push(await a.run(page.id, db.id));
      results[level] = got;
      expect(Object.fromEntries(ACTIONS.map((a, i) => [a.name, got[i]]))).toEqual(
        Object.fromEntries(ACTIONS.map((a, i) => [a.name, EXPECTED[level][i]])),
      );
    });
  }

  afterAll(() => {
    // Generierte Doku (JOTION_WRITE_MATRIX=1 pnpm test sharing)
    if (process.env.JOTION_WRITE_MATRIX !== '1' || Object.keys(results).length < 5) return;
    const head = `| Aktion | ${PERMISSION_LEVELS.join(' | ')} |`;
    const sep = `|---|${PERMISSION_LEVELS.map(() => '---').join('|')}|`;
    const rows = ACTIONS.map(
      (a, i) => `| ${a.name} | ${PERMISSION_LEVELS.map((l) => results[l]![i]).join(' | ')} |`,
    );
    const md = [
      '# Berechtigungsmatrix',
      '',
      'Generiert aus `apps/api/test/sharing.test.ts` (`JOTION_WRITE_MATRIX=1`). HTTP-Status für ein',
      'Mitglied mit der jeweiligen Stufe auf einer Team-Seite: 2xx erlaubt, 403 sichtbar aber nicht',
      'erlaubt, 404 unsichtbar.',
      '',
      head,
      sep,
      ...rows,
      '',
    ].join('\n');
    writeFileSync(join(__dirname, '../../../docs/permission-matrix.md'), md);
  });
});

describe('Vererbung und Vorrang', () => {
  it('Angabe auf der Elternseite gilt für Unterseiten, nähere Angabe gewinnt', async () => {
    const root = (await create(owner, { title: 'Wurzel', scope: 'TEAM' })).body;
    const child = (await create(owner, { title: 'Kind', parentId: root.id })).body;
    const grand = (await create(owner, { title: 'Enkel', parentId: child.id })).body;
    await share(owner, root.id, memberId, 'view');
    expect((await member.patch(`/api/pages/${grand.id}`, { title: 'x' })).status).toBe(403);
    await share(owner, child.id, memberId, 'edit');
    expect((await member.patch(`/api/pages/${grand.id}`, { title: 'x' })).status).toBe(200);
    expect((await member.patch(`/api/pages/${root.id}`, { title: 'x' })).status).toBe(403);
    const s = (await member.get(`/api/pages/${grand.id}/sharing`)).body;
    expect(s.myLevel).toBe('edit');
    expect(s.canManage).toBe(false);
  });

  it('Nutzerangabe gewinnt auf derselben Ebene vor der Angabe für alle', async () => {
    const page = (await create(owner, { title: 'Geheimprojekt', scope: 'TEAM' })).body;
    await share(owner, page.id, null, 'none');
    await share(owner, page.id, memberId, 'comment');
    expect((await other.get(`/api/pages/${page.id}`)).status).toBe(404);
    const r = await member.get(`/api/pages/${page.id}`);
    expect(r.status).toBe(200);
    expect(r.body.level).toBe('comment');
    expect(r.body.canEdit).toBe(false);
    // Workspace-Owner hat auf Team-Seiten immer volle Rechte
    expect((await owner.get(`/api/pages/${page.id}`)).body.level).toBe('full');
    expect((await share(owner, page.id, ownerId, 'view')).status).toBe(422);
  });

  it('wer Rechte verwaltet, sperrt sich nicht selbst aus', async () => {
    const page = (await create(owner, { title: 'Gemeinsam', scope: 'TEAM' })).body;
    // Mitglied hat ohne Angabe volle Rechte und setzt "alle: kein Zugriff"
    const r = await share(member, page.id, null, 'none');
    expect(r.status).toBe(200);
    expect((await member.get(`/api/pages/${page.id}`)).body.level).toBe('full');
    expect((await other.get(`/api/pages/${page.id}`)).status).toBe(404);
  });

  it('Zeilen erben die Rechte der Datenbank und lassen sich nicht einzeln freigeben', async () => {
    const db = (
      await owner.post(`/api/workspaces/${ws}/databases`, { title: 'Aufgaben', scope: 'TEAM' })
    ).body;
    const row = (await owner.post(`/api/databases/${db.id}/rows`, { title: 'Zeile' })).body;
    await share(owner, db.id, memberId, 'view');
    expect((await member.get(`/api/databases/${db.id}/rows/${row.id}`)).status).toBe(200);
    expect((await member.patch(`/api/pages/${row.id}`, { title: 'x' })).status).toBe(403);
    expect((await share(owner, row.id, memberId, 'edit')).status).toBe(422);
  });
});

describe('Private Seiten teilen', () => {
  it('erscheinen unter "Mit mir geteilt" und bleiben für andere unsichtbar', async () => {
    const priv = (await create(owner, { title: 'Urlaubsplanung', scope: 'PRIVATE' })).body;
    const child = (await create(owner, { title: 'Packliste', parentId: priv.id })).body;
    expect((await member.get(`/api/pages/${priv.id}`)).status).toBe(404);
    await share(owner, priv.id, memberId, 'edit');
    const sb = (await member.get(`/api/workspaces/${ws}/sidebar`)).body;
    expect(sb.shared.map((n: { id: string }) => n.id)).toEqual([priv.id]);
    expect(sb.private).toEqual([]);
    expect(
      (await member.get(`/api/pages/${priv.id}/children`)).body.map((n: { id: string }) => n.id),
    ).toEqual([child.id]);
    // Unterseiten des Mitglieds gehören weiter dem Owner der privaten Seite
    const sub = (await create(member, { parentId: priv.id, title: 'Neu' })).body;
    expect(sub.ownerId).toBe(ownerId);
    expect((await owner.get(`/api/pages/${sub.id}`)).status).toBe(200);
    // Ohne volle Rechte nicht in den eigenen Bereich verschieben (Owner würde wechseln)
    const mine = (await create(member, { title: 'Meins', scope: 'PRIVATE' })).body;
    expect((await member.post(`/api/pages/${child.id}/move`, { parentId: mine.id })).status).toBe(
      403,
    );
    expect((await other.get(`/api/workspaces/${ws}/sidebar`)).body.shared).toEqual([]);
    expect((await other.get(`/api/pages/${priv.id}`)).status).toBe(404);
  });

  it('Teilseite unter verborgener Elternseite erscheint als Einstieg, ohne Pfad zu verraten', async () => {
    const root = (await create(owner, { title: 'Verborgen', scope: 'TEAM' })).body;
    const inner = (await create(owner, { title: 'Freigegeben', parentId: root.id })).body;
    await share(owner, root.id, null, 'none');
    await share(owner, inner.id, memberId, 'view');
    const sb = (await member.get(`/api/workspaces/${ws}/sidebar`)).body;
    expect(sb.team.map((n: { id: string }) => n.id)).not.toContain(root.id);
    expect(sb.shared.map((n: { id: string }) => n.id)).toEqual([inner.id]);
    const p = (await member.get(`/api/pages/${inner.id}`)).body;
    expect(p.breadcrumbs).toEqual([]);
    const found = (await member.get(`/api/workspaces/${ws}/search/content?q=Freigegeben`)).body;
    expect(found).toHaveLength(1);
    expect(JSON.stringify(found)).not.toContain('Verborgen');
  });
});

describe('Leak-Tests', () => {
  it('Suche, Erwähnungen, Rückverweise und Relationstitel verraten keine gesperrten Seiten', async () => {
    const secret = (await create(owner, { title: 'Gehaltsliste', scope: 'TEAM' })).body;
    await share(owner, secret.id, null, 'none');
    const search = (await member.get(`/api/workspaces/${ws}/search/content?q=Gehalt`)).body;
    expect(search).toEqual([]);
    const quick = (await member.get(`/api/workspaces/${ws}/search?q=Gehalt`)).body;
    expect(JSON.stringify(quick)).not.toContain('Gehaltsliste');
    const mentions = (await member.get(`/api/workspaces/${ws}/mention-candidates?q=Gehalt`)).body;
    expect(mentions.pages).toEqual([]);
    expect((await member.get(`/api/pages/${secret.id}/summary`)).status).toBe(404);

    // Relation von einer sichtbaren in eine gesperrte Datenbank: IDs ja, Titel nein
    const open = (
      await owner.post(`/api/workspaces/${ws}/databases`, { title: 'Offen', scope: 'TEAM' })
    ).body;
    const closed = (
      await owner.post(`/api/workspaces/${ws}/databases`, { title: 'Zu', scope: 'TEAM' })
    ).body;
    const rel = (
      await owner.post(`/api/databases/${open.id}/properties`, {
        name: 'Link',
        type: 'relation',
        config: { targetDatabaseId: closed.id },
      })
    ).body;
    const target = (await owner.post(`/api/databases/${closed.id}/rows`, { title: 'Bonus Chef' }))
      .body;
    const src = (
      await owner.post(`/api/databases/${open.id}/rows`, {
        title: 'Quelle',
        values: { [rel.id]: [target.id] },
      })
    ).body;
    await share(owner, closed.id, null, 'none');
    const rows = (await member.post(`/api/databases/${open.id}/query`, {})).body.rows;
    const r = rows.find((x: { id: string }) => x.id === src.id);
    expect(r.values[rel.id]).toEqual([target.id]);
    expect(JSON.stringify(r)).not.toContain('Bonus Chef');
    expect(
      (await owner.post(`/api/databases/${open.id}/query`, {})).body.rows[0].refs,
    ).toBeTruthy();
  });

  it('Datenbank-Auswahl und Vorlagen-Galerie zeigen keine gesperrten Seiten', async () => {
    const db = (
      await owner.post(`/api/workspaces/${ws}/databases`, { title: 'Personal', scope: 'TEAM' })
    ).body;
    await owner.put(`/api/pages/${db.id}/template`, { isTemplate: true });
    await share(owner, db.id, null, 'none');
    const dbs = (await member.get(`/api/workspaces/${ws}/databases?q=Personal`)).body;
    expect(dbs).toEqual([]);
    const tpls = (await member.get(`/api/workspaces/${ws}/templates`)).body;
    expect(JSON.stringify(tpls)).not.toContain('Personal');
  });
});

describe('Lese-Link', () => {
  it('zeigt Seite und Unterseiten ohne Anmeldung, nichts außerhalb', async () => {
    const page = (await create(owner, { title: 'Rezept', scope: 'TEAM' })).body;
    const child = (await create(owner, { title: 'Variante', parentId: page.id })).body;
    const outside = (await create(owner, { title: 'Draußen', scope: 'TEAM' })).body;
    const link = (await owner.post(`/api/pages/${page.id}/share-link`)).body;
    expect(link.url).toMatch(/\/share\//);
    const anon = new Client(app);
    const r = await anon.get(`/api/share/${link.token}`);
    expect(r.status).toBe(200);
    expect(r.body.page.title).toBe('Rezept');
    expect(r.body.children.map((c: { id: string }) => c.id)).toEqual([child.id]);
    expect((await anon.get(`/api/share/${link.token}?page=${child.id}`)).body.page.title).toBe(
      'Variante',
    );
    expect((await anon.get(`/api/share/${link.token}?page=${outside.id}`)).status).toBe(404);
    expect((await anon.get(`/api/pages/${page.id}`)).status).toBe(401);
    // Deaktivieren macht den Link ungültig
    expect((await owner.del(`/api/pages/${page.id}/share-link`)).status).toBe(204);
    expect((await anon.get(`/api/share/${link.token}`)).status).toBe(404);
  });
});

describe('Echtzeit', () => {
  it('Ereignisse gesperrter Seiten erreichen nur Mitglieder mit Zugriff', async () => {
    const page = (await create(owner, { title: 'Bonusliste', scope: 'TEAM' })).body;
    await share(owner, page.id, null, 'none');
    await share(owner, page.id, otherId, 'view');
    const realtime = app.get(RealtimeService);
    // Bisherige Ereignisse veröffentlichen, dann nur die Titeländerung betrachten
    await app
      .get(PrismaService)
      .client.changeEvent.updateMany({ data: { publishedAt: new Date() } });
    const sub = new Redis(process.env.REDIS_URL!);
    const raw: string[] = [];
    await sub.subscribe(`jotion:events:${ws}`);
    sub.on('message', (_ch, msg) => raw.push(msg));
    await owner.patch(`/api/pages/${page.id}`, { title: 'Bonusliste 2027' });
    await realtime.relayOnce();
    await new Promise((r) => setTimeout(r, 100));
    sub.disconnect();
    expect(raw).toHaveLength(1);

    const got = new Map<string, unknown[]>();
    const unsub = [ownerId, memberId, otherId].map((userId) =>
      realtime.subscribe(ws, {
        userId,
        send: (e) => got.set(userId, [...(got.get(userId) ?? []), e]),
      }),
    );
    // Verteilung wie bei einer Nachricht aus Redis
    (realtime as unknown as { dispatch: (w: string, m: string) => void }).dispatch(ws, raw[0]!);
    unsub.forEach((u) => u());
    expect(got.get(ownerId)).toHaveLength(1);
    expect(got.get(otherId)).toHaveLength(1);
    expect(got.get(memberId)).toBeUndefined();
    // Die Zielgruppe selbst wird nicht an Clients weitergegeben
    expect(JSON.stringify(got.get(ownerId))).not.toContain('audience');
  });
});
