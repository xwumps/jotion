import { Injectable, Logger } from '@nestjs/common';

/** Phase 9: Änderung an Zeilen (Grundlage für Automatisierungen). */
export interface RowEvent {
  kind: 'created' | 'updated' | 'trashed';
  workspaceId: string;
  databaseId: string;
  rowIds: string[];
  /** Geänderte Properties ("title" für den Titel); bei created alle gesetzten */
  changed: string[];
  actorId: string | null;
  /** Tiefe der Automatisierungskette, die die Änderung ausgelöst hat (0 = Nutzer) */
  depth: number;
}

/** Kontext einer Änderung, die eine Automatisierung ausführt */
export interface ChangeContext {
  depth?: number;
}

type Listener = (e: RowEvent) => Promise<void> | void;

/**
 * Einfacher Ereignis-Bus nach dem Speichern: RowsService meldet, Automatisierungen hören zu.
 * Entkoppelt beide (Automatisierungen schreiben ihrerseits über RowsService).
 */
@Injectable()
export class RowEventsBus {
  private readonly logger = new Logger('RowEvents');
  private readonly listeners: Listener[] = [];

  subscribe(fn: Listener): void {
    this.listeners.push(fn);
  }

  async emit(e: RowEvent): Promise<void> {
    if (!e.rowIds.length) return;
    for (const fn of this.listeners) {
      try {
        await fn(e);
      } catch (err) {
        // Fehler der Zuhörer brechen die Änderung des Nutzers nie ab
        this.logger.error(`Zuhörer fehlgeschlagen: ${(err as Error).message}`);
      }
    }
  }
}
