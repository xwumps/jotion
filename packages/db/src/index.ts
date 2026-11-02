import { PrismaClient } from '../generated/client';

export * from '../generated/client';

export interface CreatePrismaOptions {
  url?: string;
  log?: boolean;
}

/** Erstellt einen PrismaClient. Jeder Prozess hält genau eine Instanz. */
export function createPrismaClient(options: CreatePrismaOptions = {}): PrismaClient {
  return new PrismaClient({
    ...(options.url ? { datasources: { db: { url: options.url } } } : {}),
    log: options.log ? ['warn', 'error'] : ['error'],
  });
}

/** Prüft die Datenbankverbindung (für Healthchecks). */
export async function pingDatabase(client: PrismaClient): Promise<void> {
  await client.$queryRaw`SELECT 1`;
}

/** Liefert die angewendeten Migrationen in Reihenfolge (für Diagnose und Upgrade-Tests). */
export async function appliedMigrations(client: PrismaClient): Promise<string[]> {
  const rows = await client.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY started_at`;
  return rows.map((r) => r.migration_name);
}
