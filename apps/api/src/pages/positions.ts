import { Prisma } from '@jotion/db';
import { keyBetween, keysBetween, OrderKeyError } from '@jotion/shared';
import { AppError } from '../common/errors';

/** Geschwistergruppe: Kinder einer Seite, oder Wurzelseiten eines Bereichs (Team / privat je Owner). */
export interface SiblingGroup {
  workspaceId: string;
  parentId: string | null;
  scope: 'PRIVATE' | 'TEAM';
  ownerId: string;
}

function groupWhere(g: SiblingGroup): Prisma.Sql {
  if (g.parentId) return Prisma.sql`parent_id = ${g.parentId}::uuid`;
  if (g.scope === 'TEAM')
    return Prisma.sql`workspace_id = ${g.workspaceId}::uuid AND parent_id IS NULL AND scope = 'TEAM'`;
  return Prisma.sql`workspace_id = ${g.workspaceId}::uuid AND parent_id IS NULL AND scope = 'PRIVATE' AND owner_id = ${g.ownerId}::uuid`;
}

function groupLockKey(g: SiblingGroup): string {
  return g.parentId
    ? `pages:${g.parentId}`
    : `pages:${g.workspaceId}:${g.scope}:${g.scope === 'PRIVATE' ? g.ownerId : ''}`;
}

/**
 * Berechnet einen Positionsschlüssel in einer Geschwistergruppe. Serialisiert parallele
 * Einfügungen derselben Gruppe per Advisory Lock (bis Transaktionsende).
 */
export async function computePosition(
  tx: Prisma.TransactionClient,
  group: SiblingGroup,
  opts: { afterId?: string | null; beforeId?: string | null; excludeId?: string },
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${groupLockKey(group)}, 0))`;

  const load = () =>
    tx.$queryRaw<{ id: string; position: string }[]>`
      SELECT id::text, position FROM pages
       WHERE ${groupWhere(group)} AND deleted_at IS NULL
         ${opts.excludeId ? Prisma.sql`AND id <> ${opts.excludeId}::uuid` : Prisma.empty}
       ORDER BY position, id`;

  let siblings = await load();
  const between = () => {
    let prev: string | null = null;
    let next: string | null = null;
    if (opts.afterId) {
      const i = siblings.findIndex((s) => s.id === opts.afterId);
      if (i < 0) throw new AppError('bad_request', 'afterId gehört nicht zur Zielgruppe');
      prev = siblings[i]!.position;
      next = siblings[i + 1]?.position ?? null;
    } else if (opts.beforeId) {
      const i = siblings.findIndex((s) => s.id === opts.beforeId);
      if (i < 0) throw new AppError('bad_request', 'beforeId gehört nicht zur Zielgruppe');
      next = siblings[i]!.position;
      prev = siblings[i - 1]?.position ?? null;
    } else {
      prev = siblings.at(-1)?.position ?? null;
    }
    return keyBetween(prev, next);
  };

  try {
    return between();
  } catch (err) {
    if (!(err instanceof OrderKeyError)) throw err;
    // Doppelte oder beschädigte Schlüssel (z. B. nach Import): Gruppe neu durchnummerieren
    const keys = keysBetween(null, null, siblings.length);
    for (const [i, s] of siblings.entries()) {
      await tx.$executeRaw`UPDATE pages SET position = ${keys[i]!} WHERE id = ${s.id}::uuid`;
    }
    siblings = await load();
    return between();
  }
}
