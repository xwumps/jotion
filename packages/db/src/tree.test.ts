import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from './index';

// Prüft die Datenbank-Trigger für den Seitenbaum (Migration 20261102010000_phase1).
const db: PrismaClient = createPrismaClient();
let userId: string;
let otherUserId: string;
let ws: string;
let ws2: string;

async function page(
  title: string,
  parentId: string | null = null,
  scope: 'PRIVATE' | 'TEAM' = 'TEAM',
  owner = userId,
  workspaceId = ws,
) {
  return db.page.create({
    data: {
      workspaceId,
      parentId,
      title,
      position: 'a0',
      scope,
      ownerId: owner,
      createdById: owner,
      lastEditedById: owner,
    },
  });
}

async function info(id: string) {
  const [row] = await db.$queryRaw<
    { path: string; scope: string; owner_id: string; depth: number }[]
  >`
    SELECT path::text AS path, scope::text AS scope, owner_id::text AS owner_id, nlevel(path) AS depth FROM pages WHERE id = ${id}::uuid`;
  return row!;
}

const label = (id: string) => id.replaceAll('-', '');

beforeAll(async () => {
  const suffix = Date.now();
  userId = (
    await db.user.create({
      data: { email: `tree-${suffix}@test.local`, name: 'T', passwordHash: 'x' },
    })
  ).id;
  otherUserId = (
    await db.user.create({
      data: { email: `tree2-${suffix}@test.local`, name: 'U', passwordHash: 'x' },
    })
  ).id;
  ws = (await db.workspace.create({ data: { name: 'Tree' } })).id;
  ws2 = (await db.workspace.create({ data: { name: 'Tree2' } })).id;
});

afterAll(async () => {
  await db.workspace.deleteMany({ where: { id: { in: [ws, ws2] } } });
  await db.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await db.$disconnect();
});

describe('Seitenbaum-Trigger', () => {
  it('setzt den Pfad beim Anlegen aus dem Elternteil', async () => {
    const a = await page('A');
    const b = await page('B', a.id);
    const c = await page('C', b.id);
    expect((await info(a.id)).path).toBe(label(a.id));
    expect((await info(c.id)).path).toBe(`${label(a.id)}.${label(b.id)}.${label(c.id)}`);
  });

  it('zieht beim Verschieben den ganzen Teilbaum mit', async () => {
    const root1 = await page('R1');
    const root2 = await page('R2');
    const child = await page('Kind', root1.id);
    const grand = await page('Enkel', child.id);
    await db.page.update({ where: { id: child.id }, data: { parentId: root2.id } });
    expect((await info(grand.id)).path).toBe(
      `${label(root2.id)}.${label(child.id)}.${label(grand.id)}`,
    );
    await db.page.update({ where: { id: child.id }, data: { parentId: null } });
    expect((await info(grand.id)).depth).toBe(2);
  });

  it('verhindert Verschieben in den eigenen Teilbaum', async () => {
    const a = await page('A');
    const b = await page('B', a.id);
    const c = await page('C', b.id);
    await expect(db.page.update({ where: { id: a.id }, data: { parentId: c.id } })).rejects.toThrow(
      /own subtree/,
    );
    await expect(db.page.update({ where: { id: a.id }, data: { parentId: a.id } })).rejects.toThrow(
      /own parent/,
    );
  });

  it('übernimmt Scope und Owner von der Elternseite, auch für den Teilbaum', async () => {
    const priv = await page('Privat', null, 'PRIVATE', otherUserId);
    const team = await page('Team');
    const child = await page('Kind', team.id);
    const grand = await page('Enkel', child.id);
    expect((await info(grand.id)).scope).toBe('TEAM');
    await db.page.update({ where: { id: child.id }, data: { parentId: priv.id } });
    const g = await info(grand.id);
    expect(g.scope).toBe('PRIVATE');
    expect(g.owner_id).toBe(otherUserId);
  });

  it('propagiert Scope-Änderung einer Wurzelseite nach unten', async () => {
    const root = await page('Wurzel', null, 'PRIVATE');
    const child = await page('Kind', root.id);
    await db.page.update({ where: { id: root.id }, data: { scope: 'TEAM' } });
    expect((await info(child.id)).scope).toBe('TEAM');
  });

  it('verbietet Eltern aus einem anderen Workspace', async () => {
    const foreign = await page('Fremd', null, 'TEAM', userId, ws2);
    await expect(page('X', foreign.id)).rejects.toThrow(/another workspace/);
  });

  it('löscht beim endgültigen Löschen den Teilbaum per Cascade', async () => {
    const a = await page('A');
    const b = await page('B', a.id);
    await db.page.delete({ where: { id: a.id } });
    expect(await db.page.findUnique({ where: { id: b.id } })).toBeNull();
  });
});
