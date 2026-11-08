import type { Page, PrismaClient } from '@jotion/db';
import { AppError } from '../common/errors';

/**
 * Regeln für Datenbankseiten im Seitenbaum (Phase 4), genutzt vom PagesService.
 *  - Zeilen liegen immer direkt unter ihrer Datenbank und erscheinen nicht in der Sidebar.
 *  - In eine Datenbankseite können keine normalen Seiten gelegt werden (dafür gibt es Zeilen).
 *  - Unterseiten-Blöcke gibt es nur für Seiten und Full-Page-Datenbanken, nicht für Zeilen
 *    und Inline-Datenbanken (die stehen als Datenbank-Block im Inhalt).
 */
export function assertPageParent(parent: Pick<Page, 'kind'> | null): void {
  if (parent?.kind === 'DATABASE')
    throw new AppError('bad_request', 'Einträge einer Datenbank werden als Zeilen angelegt');
  // Phase 10: Synced Blocks und Zeilen-Vorlagen haben keine Unterseiten
  if (parent?.kind === 'SYNCED_BLOCK' || parent?.kind === 'ROW_TEMPLATE')
    throw new AppError('bad_request', 'Hier lassen sich keine Unterseiten anlegen');
}

export function assertMovable(page: Pick<Page, 'kind'>): void {
  if (page.kind === 'DATABASE_ROW')
    throw new AppError('bad_request', 'Zeilen bleiben in ihrer Datenbank');
  if (page.kind === 'SYNCED_BLOCK')
    throw new AppError('bad_request', 'Synced Blocks bleiben bei ihrer Ursprungsseite');
}

export async function wantsSubpageBlock(
  db: PrismaClient,
  page: Pick<Page, 'id' | 'kind'>,
): Promise<boolean> {
  if (page.kind === 'PAGE') return true;
  if (page.kind === 'DATABASE_ROW') return false;
  const info = await db.database.findUnique({ where: { id: page.id }, select: { isInline: true } });
  return !info?.isInline;
}

/** Eine Zeile lässt sich nur zurückholen, solange ihre Datenbank nicht im Papierkorb liegt. */
export function assertRestorable(page: Pick<Page, 'kind'>, parent: Pick<Page, 'deletedAt'> | null) {
  if (page.kind === 'DATABASE_ROW' && (!parent || parent.deletedAt))
    throw new AppError('conflict', 'Bitte zuerst die Datenbank wiederherstellen');
}
