import { createPrismaClient } from '@jotion/db';
import { afterAll, describe, expect, it } from 'vitest';
import { runMaintenance } from './maintenance';

// Läuft gegen DATABASE_URL (Testdatenbank). Legt eigene Daten an und räumt sie auf.
const db = createPrismaClient();
afterAll(() => db.$disconnect());

describe('Wartung', () => {
  it('löscht nur Papierkorb-Wurzeln älter als 30 Tage samt Teilbaum', async () => {
    const s = Date.now();
    const user = await db.user.create({
      data: { email: `m-${s}@test.local`, name: 'M', passwordHash: 'x' },
    });
    const ws = await db.workspace.create({ data: { name: 'Wartung' } });
    const base = {
      workspaceId: ws.id,
      position: 'a0',
      scope: 'TEAM' as const,
      ownerId: user.id,
      createdById: user.id,
      lastEditedById: user.id,
    };
    const old = await db.page.create({ data: { ...base, title: 'alt' } });
    const oldChild = await db.page.create({
      data: { ...base, title: 'alt-kind', parentId: old.id },
    });
    const fresh = await db.page.create({ data: { ...base, title: 'neu' } });
    const alive = await db.page.create({ data: { ...base, title: 'lebt' } });
    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db.page.updateMany({
      where: { id: { in: [old.id, oldChild.id] } },
      data: { deletedAt: longAgo, trashRootId: old.id },
    });
    await db.page.update({
      where: { id: fresh.id },
      data: { deletedAt: new Date(), trashRootId: fresh.id },
    });
    await db.session.create({
      data: { userId: user.id, tokenHash: `t-${s}`, expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await runMaintenance(db);
    expect(result.purgedPages).toBeGreaterThanOrEqual(1);
    expect(result.expiredSessions).toBeGreaterThanOrEqual(1);
    expect(await db.page.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.page.findUnique({ where: { id: oldChild.id } })).toBeNull();
    expect(await db.page.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await db.page.findUnique({ where: { id: alive.id } })).not.toBeNull();

    await db.workspace.delete({ where: { id: ws.id } });
    await db.user.delete({ where: { id: user.id } });
  });
});
