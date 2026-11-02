import { afterAll, describe, expect, it } from 'vitest';
import { appliedMigrations, createPrismaClient, pingDatabase } from './index';

// Läuft gegen eine migrierte Datenbank (DATABASE_URL). In CI per Service-Container.
const client = createPrismaClient();

afterAll(async () => {
  await client.$disconnect();
});

describe('Datenbank nach Migration', () => {
  it('ist erreichbar', async () => {
    await expect(pingDatabase(client)).resolves.toBeUndefined();
  });

  it('hat die Init-Migration angewendet', async () => {
    expect(await appliedMigrations(client)).toContain('20261102000000_init');
  });

  it('hat alle benötigten Extensions', async () => {
    const rows = await client.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension`;
    const names = rows.map((r) => r.extname);
    for (const ext of ['pg_trgm', 'unaccent', 'btree_gin', 'ltree']) expect(names).toContain(ext);
  });

  it('kann Systemeinstellungen schreiben und lesen', async () => {
    const key = `test.${Date.now()}`;
    await client.systemSetting.create({ data: { key, value: { ok: true } } });
    const row = await client.systemSetting.findUniqueOrThrow({ where: { key } });
    expect(row.value).toEqual({ ok: true });
    await client.systemSetting.delete({ where: { key } });
  });
});
