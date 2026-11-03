import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from './index';

// Phase 4: Seitenbaum-Trigger (Migration 20261102010000_phase1) mit Datenbankseiten und Zeilen
const db: PrismaClient = createPrismaClient();
let userId: string;
let otherId: string;
let ws: string;

const base = () => ({
  workspaceId: ws,
  position: 'a0',
  ownerId: userId,
  createdById: userId,
  lastEditedById: userId,
});

async function database(parentId: string | null, scope: 'PRIVATE' | 'TEAM' = 'TEAM') {
  const page = await db.page.create({ data: { ...base(), parentId, kind: 'DATABASE', scope } });
  await db.database.create({ data: { id: page.id, workspaceId: ws } });
  return page;
}
const row = (dbId: string) =>
  db.page.create({ data: { ...base(), parentId: dbId, databaseId: dbId, kind: 'DATABASE_ROW' } });
const info = async (id: string) =>
  (
    await db.$queryRaw<{ path: string; scope: string; owner_id: string }[]>`
      SELECT path::text, scope::text, owner_id::text FROM pages WHERE id = ${id}::uuid`
  )[0]!;

beforeAll(async () => {
  const s = Date.now();
  userId = (
    await db.user.create({ data: { email: `dbr-${s}@t.local`, name: 'A', passwordHash: 'x' } })
  ).id;
  otherId = (
    await db.user.create({ data: { email: `dbr2-${s}@t.local`, name: 'B', passwordHash: 'x' } })
  ).id;
  ws = (await db.workspace.create({ data: { name: 'DB-Zeilen' } })).id;
});
afterAll(async () => {
  await db.workspace.deleteMany({ where: { id: ws } });
  await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await db.$disconnect();
});

describe('Datenbankzeilen im Seitenbaum', () => {
  it('erben Pfad, Scope und Owner der Datenbank, auch beim Verschieben der Datenbank', async () => {
    const priv = await db.page.create({ data: { ...base(), scope: 'PRIVATE' } });
    const d = await database(priv.id);
    const r = await row(d.id);
    expect((await info(r.id)).scope).toBe('PRIVATE');
    expect((await info(r.id)).path.split('.')).toHaveLength(3);
    // Datenbank in eine Teamseite eines anderen Owners verschieben: Zeilen folgen
    const team = await db.page.create({ data: { ...base(), scope: 'TEAM', ownerId: otherId } });
    await db.page.update({ where: { id: d.id }, data: { parentId: team.id } });
    expect(await info(r.id)).toMatchObject({ scope: 'TEAM', owner_id: otherId });
    expect((await info(r.id)).path.startsWith(team.id.replaceAll('-', ''))).toBe(true);
  });

  it('erzwingen per Constraint, dass Zeilen direkt unter ihrer Datenbank liegen', async () => {
    const d = await database(null);
    const other = await database(null);
    const r = await row(d.id);
    await expect(
      db.page.update({ where: { id: r.id }, data: { parentId: other.id } }),
    ).rejects.toThrow(/pages_database_row_check/);
    await expect(
      db.page.create({ data: { ...base(), parentId: d.id, kind: 'DATABASE_ROW' } }),
    ).rejects.toThrow(/pages_database_row_check/);
    await expect(
      db.page.create({ data: { ...base(), databaseId: d.id, kind: 'PAGE' } }),
    ).rejects.toThrow(/pages_database_row_check/);
  });

  it('Zyklenschutz gilt weiter: Datenbank nicht in die eigene Zeile verschiebbar', async () => {
    const d = await database(null);
    const r = await row(d.id);
    const sub = await db.page.create({ data: { ...base(), parentId: r.id } });
    await expect(
      db.page.update({ where: { id: d.id }, data: { parentId: sub.id } }),
    ).rejects.toThrow(/own subtree/);
  });

  it('endgültiges Löschen der Datenbank entfernt Zeilen und Werte', async () => {
    const d = await database(null);
    const r = await row(d.id);
    const prop = await db.dbProperty.create({
      data: { databaseId: d.id, type: 'number', name: 'N', position: 'a0' },
    });
    await db.propertyValue.create({
      data: { rowId: r.id, propertyId: prop.id, databaseId: d.id, vNumber: 1 },
    });
    await db.page.delete({ where: { id: d.id } });
    expect(await db.page.count({ where: { id: r.id } })).toBe(0);
    expect(await db.propertyValue.count({ where: { propertyId: prop.id } })).toBe(0);
  });
});
