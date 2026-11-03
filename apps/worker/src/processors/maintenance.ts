import type { PrismaClient } from '@jotion/db';
import { EVENT_RETENTION_DAYS, TRASH_RETENTION_DAYS } from '@jotion/shared';

export interface MaintenanceResult {
  purgedPages: number;
  expiredSessions: number;
  oldEvents: number;
  oldResetTokens: number;
}

/** Aufräumen: alte Papierkorb-Einträge, abgelaufene Sessions, alte Ereignisse und Reset-Tokens. */
export async function runMaintenance(
  db: PrismaClient,
  now = new Date(),
): Promise<MaintenanceResult> {
  const day = 24 * 60 * 60 * 1000;
  const trashCutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * day);
  // Nur Wurzeln löschen; Unterseiten folgen per ON DELETE CASCADE
  const purgedPages = await db.$executeRaw`
    DELETE FROM pages WHERE trash_root_id = id AND deleted_at < ${trashCutoff}`;
  const expiredSessions = (await db.session.deleteMany({ where: { expiresAt: { lt: now } } }))
    .count;
  const oldEvents = (
    await db.changeEvent.deleteMany({
      where: { publishedAt: { lt: new Date(now.getTime() - EVENT_RETENTION_DAYS * day) } },
    })
  ).count;
  const oldResetTokens = (
    await db.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 7 * day) } },
    })
  ).count;
  return { purgedPages, expiredSessions, oldEvents, oldResetTokens };
}
