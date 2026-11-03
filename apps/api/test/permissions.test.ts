import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, type Client, createTestApp, resetState, setupOwner } from './helpers';

/**
 * Rechtematrix Phase 1. Akteure:
 *  owner  = Workspace-Owner (A)
 *  member = Mitglied (B)
 *  outsider = Nutzer eines anderen Workspace (C)
 */
let app: NestFastifyApplication;
let owner: Client;
let member: Client;
let outsider: Client;
let ws: string;
let memberId: string;
let ownerId: string;

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
  // Outsider: Mitglied eines eigenen Workspace, nicht von ws
  const otherWs = await owner.post('/api/workspaces', { name: 'Anderer' });
  const c = await addMember(app, owner, otherWs.body.id, 'outsider@test.local');
  outsider = c.client;
});

const create = (c: Client, body: object) => c.post(`/api/workspaces/${ws}/pages`, body);

describe('Private Seiten', () => {
  it('sind für andere Mitglieder unsichtbar und nicht änderbar', async () => {
    const priv = (await create(owner, { title: 'Tagebuch', scope: 'PRIVATE' })).body;
    const child = (await create(owner, { title: 'Eintrag', parentId: priv.id })).body;
    expect(child.scope).toBe('PRIVATE');

    for (const id of [priv.id, child.id]) {
      expect((await member.get(`/api/pages/${id}`)).status).toBe(404);
      expect((await member.get(`/api/pages/${id}/children`)).status).toBe(404);
      expect((await member.patch(`/api/pages/${id}`, { title: 'gehackt' })).status).toBe(404);
      expect(
        (await member.post(`/api/pages/${id}/move`, { parentId: null, scope: 'TEAM' })).status,
      ).toBe(404);
      expect((await member.del(`/api/pages/${id}`)).status).toBe(404);
      expect((await member.post(`/api/pages/${id}/favorite`)).status).toBe(404);
      expect((await create(member, { parentId: id, title: 'x' })).status).toBe(404);
    }
    const sidebar = (await member.get(`/api/workspaces/${ws}/sidebar`)).body;
    expect([...sidebar.private, ...sidebar.team].map((n: { id: string }) => n.id)).not.toContain(
      priv.id,
    );
    expect((await owner.get(`/api/pages/${child.id}`)).status).toBe(200);
  });

  it('tauchen nicht im Papierkorb anderer auf', async () => {
    const priv = (await create(owner, { title: 'Geheim', scope: 'PRIVATE' })).body;
    await owner.del(`/api/pages/${priv.id}`);
    expect((await member.get(`/api/workspaces/${ws}/trash`)).body).toEqual([]);
    expect((await owner.get(`/api/workspaces/${ws}/trash`)).body).toHaveLength(1);
  });
});

describe('Teamseiten', () => {
  it('können alle Mitglieder lesen, bearbeiten und in den Papierkorb legen', async () => {
    const team = (await create(owner, { title: 'Projekt', scope: 'TEAM' })).body;
    expect((await member.get(`/api/pages/${team.id}`)).status).toBe(200);
    expect((await member.patch(`/api/pages/${team.id}`, { title: 'Projekt X' })).body.title).toBe(
      'Projekt X',
    );
    expect((await create(member, { parentId: team.id, title: 'Unterseite' })).status).toBe(201);
    expect((await member.del(`/api/pages/${team.id}`)).status).toBe(204);
  });

  it('endgültig löschen: Ersteller oder Owner, nicht andere Mitglieder', async () => {
    const byOwner = (await create(owner, { title: 'A', scope: 'TEAM' })).body;
    const byMember = (await create(member, { title: 'B', scope: 'TEAM' })).body;
    await owner.del(`/api/pages/${byOwner.id}`);
    await member.del(`/api/pages/${byMember.id}`);

    const trash = (await member.get(`/api/workspaces/${ws}/trash`)).body as {
      id: string;
      canDeletePermanently: boolean;
    }[];
    expect(trash.find((t) => t.id === byOwner.id)?.canDeletePermanently).toBe(false);
    expect(trash.find((t) => t.id === byMember.id)?.canDeletePermanently).toBe(true);

    expect((await member.del(`/api/pages/${byOwner.id}/permanent`)).status).toBe(403);
    expect((await owner.del(`/api/pages/${byMember.id}/permanent`)).status).toBe(204);
    expect((await owner.del(`/api/pages/${byOwner.id}/permanent`)).status).toBe(204);
  });

  it('privat machen darf nur Ersteller oder Owner', async () => {
    const team = (await create(owner, { title: 'Team', scope: 'TEAM' })).body;
    const res = await member.post(`/api/pages/${team.id}/move`, {
      parentId: null,
      scope: 'PRIVATE',
    });
    expect(res.status).toBe(403);
    const own = (await create(member, { title: 'Eigene', scope: 'TEAM' })).body;
    expect(
      (await member.post(`/api/pages/${own.id}/move`, { parentId: null, scope: 'PRIVATE' })).body
        .scope,
    ).toBe('PRIVATE');
    expect((await owner.get(`/api/pages/${own.id}`)).status).toBe(404);
  });
});

describe('Fremde Workspaces', () => {
  it('sind für Nicht-Mitglieder komplett verborgen', async () => {
    const team = (await create(owner, { title: 'Intern', scope: 'TEAM' })).body;
    expect((await outsider.get(`/api/workspaces/${ws}/sidebar`)).status).toBe(404);
    expect((await outsider.get(`/api/workspaces/${ws}`)).status).toBe(404);
    expect((await outsider.get(`/api/workspaces/${ws}/members`)).status).toBe(404);
    expect((await outsider.get(`/api/workspaces/${ws}/trash`)).status).toBe(404);
    expect((await outsider.get(`/api/workspaces/${ws}/recent`)).status).toBe(404);
    expect((await outsider.get(`/api/pages/${team.id}`)).status).toBe(404);
    expect((await outsider.patch(`/api/pages/${team.id}`, { title: 'x' })).status).toBe(404);
    expect((await create(outsider, { title: 'x' })).status).toBe(404);
  });
});

describe('Workspace-Verwaltung', () => {
  it('Mitglieder sehen die Mitgliederliste, verwalten aber nichts', async () => {
    expect((await member.get(`/api/workspaces/${ws}/members`)).body).toHaveLength(2);
    expect((await member.post(`/api/workspaces/${ws}/invitations`, {})).status).toBe(403);
    expect((await member.get(`/api/workspaces/${ws}/invitations`)).status).toBe(403);
    expect(
      (await member.patch(`/api/workspaces/${ws}/members/${ownerId}`, { role: 'MEMBER' })).status,
    ).toBe(403);
    expect((await member.del(`/api/workspaces/${ws}/members/${ownerId}`)).status).toBe(403);
    expect((await member.patch(`/api/workspaces/${ws}`, { name: 'Neu' })).status).toBe(403);
  });

  it('der letzte Owner kann weder herabgestuft werden noch austreten', async () => {
    expect(
      (await owner.patch(`/api/workspaces/${ws}/members/${ownerId}`, { role: 'MEMBER' })).status,
    ).toBe(409);
    expect((await owner.del(`/api/workspaces/${ws}/members/${ownerId}`)).status).toBe(409);
    await owner.patch(`/api/workspaces/${ws}/members/${memberId}`, { role: 'OWNER' });
    expect(
      (await owner.patch(`/api/workspaces/${ws}/members/${ownerId}`, { role: 'MEMBER' })).status,
    ).toBe(204);
  });

  it('Mitglied kann selbst austreten und verliert sofort den Zugriff', async () => {
    const team = (await create(owner, { title: 'Team', scope: 'TEAM' })).body;
    expect((await member.del(`/api/workspaces/${ws}/members/${memberId}`)).status).toBe(204);
    expect((await member.get(`/api/pages/${team.id}`)).status).toBe(404);
  });

  it('Owner entfernt Mitglied', async () => {
    expect((await owner.del(`/api/workspaces/${ws}/members/${memberId}`)).status).toBe(204);
    expect((await member.get(`/api/workspaces/${ws}/sidebar`)).status).toBe(404);
  });
});
