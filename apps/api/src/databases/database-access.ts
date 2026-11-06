import { Injectable } from '@nestjs/common';
import type { Database, Page, Prisma, WorkspaceRole } from '@jotion/db';
import { parsePropertyConfig, type PropertyType } from '@jotion/shared';
import type { QueryProperty } from '@jotion/query';
import { AppError, forbidden, notFound } from '../common/errors';
import { recordEvent } from '../events/outbox';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { PermissionService } from '../permissions/permission.service';

export interface DatabaseAccess {
  /** Die aufgerufene Datenbank (bei Linked Databases die verknüpfte Seite mit eigenen Ansichten) */
  db: Database;
  page: Page;
  role: WorkspaceRole;
  /** Datenbank mit Zeilen und Properties (Quelle bei Linked Databases), null wenn nicht sichtbar */
  data: { db: Database; page: Page } | null;
}

export interface LoadedProperty extends QueryProperty {
  name: string;
  position: string;
}

/**
 * Rechteprüfung für Datenbanken. Eine Datenbank ist eine Seite (kind = DATABASE) und erbt
 * Scope und Owner wie jede Seite. Bei Linked Databases muss zusätzlich die Quelle sichtbar sein,
 * sonst gibt es keine Zeilen und keine Properties (keine Umgehung privater Datenbanken).
 * Fehlender Zugriff wird immer als 404 gemeldet.
 */
@Injectable()
export class DatabaseAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly redis: RedisService,
  ) {}

  async require(
    userId: string,
    databaseId: string,
    opts: { includeTrashed?: boolean } = {},
  ): Promise<DatabaseAccess> {
    const { page, role } = await this.perms.requirePage(userId, databaseId, opts);
    if (page.kind !== 'DATABASE') throw notFound('Datenbank');
    const db = await this.prisma.client.database.findUnique({ where: { id: page.id } });
    if (!db) throw notFound('Datenbank');
    let data: DatabaseAccess['data'] = { db, page };
    if (!db.sourceDatabaseId) {
      // Linked Database, deren Quelle endgültig gelöscht wurde (source_database_id = NULL):
      // erkennbar daran, dass sie keine Titel-Spalte hat
      const hasTitle = await this.prisma.client.dbProperty.count({
        where: { databaseId: db.id, type: 'title' },
      });
      if (!hasTitle) data = null;
    } else {
      data = null;
      const srcPage = await this.prisma.client.page.findUnique({
        where: { id: db.sourceDatabaseId },
      });
      const srcDb = await this.prisma.client.database.findUnique({
        where: { id: db.sourceDatabaseId },
      });
      if (
        srcPage &&
        srcDb &&
        !srcPage.deletedAt &&
        srcPage.workspaceId === page.workspaceId &&
        this.perms.canSee(userId, srcPage)
      )
        data = { db: srcDb, page: srcPage };
    }
    return { db, page, role, data };
  }

  /** Ansichten der aufgerufenen Datenbank ändern: Seite nicht im Papierkorb und nicht gesperrt. */
  async requireEditableStructure(userId: string, databaseId: string): Promise<DatabaseAccess> {
    const access = await this.require(userId, databaseId);
    if ((access.page.settings as { locked?: boolean } | null)?.locked)
      throw forbidden('Datenbank ist gesperrt');
    return access;
  }

  /** Zeilen/Properties ändern: Quelle muss sichtbar und nicht gesperrt sein. */
  async requireData(
    userId: string,
    databaseId: string,
    opts: { schema?: boolean; includeTrashed?: boolean } = {},
  ): Promise<DatabaseAccess & { data: NonNullable<DatabaseAccess['data']> }> {
    const access = await this.require(userId, databaseId, { includeTrashed: opts.includeTrashed });
    if (!access.data) throw notFound('Datenbank');
    if (opts.schema && (access.data.page.settings as { locked?: boolean } | null)?.locked)
      throw forbidden('Datenbank ist gesperrt');
    return access as DatabaseAccess & { data: NonNullable<DatabaseAccess['data']> };
  }

  async properties(databaseId: string, tx?: Prisma.TransactionClient): Promise<LoadedProperty[]> {
    const rows = await (tx ?? this.prisma.client).dbProperty.findMany({
      where: { databaseId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type as PropertyType,
      position: p.position,
      config: safeConfig(p.type as PropertyType, p.config),
    }));
  }

  /** Ereignis für Echtzeit-Invalidierung; bei privaten Datenbanken nur an den Owner. */
  event(
    tx: Prisma.TransactionClient,
    page: Page,
    type: 'database.changed' | 'database.rows.changed',
    actorId: string,
    payload: Prisma.InputJsonValue = {},
  ) {
    // Diagramm-Cache sofort ungültig machen (der Relay erhöht nach dem Veröffentlichen erneut)
    void this.redis.client.incr(`jotion:chartv:${page.id}`).catch(() => undefined);
    return recordEvent(tx, {
      workspaceId: page.workspaceId,
      type,
      entityId: page.id,
      actorId,
      audienceUserId: page.scope === 'PRIVATE' ? page.ownerId : null,
      payload,
    });
  }

  async assertMembers(workspaceId: string, userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    const n = await this.prisma.client.workspaceMember.count({
      where: { workspaceId, userId: { in: userIds } },
    });
    if (n !== new Set(userIds).size)
      throw new AppError('validation_failed', 'Person ist kein Mitglied des Workspace');
  }
}

/** Gespeicherte Konfiguration lesen; beschädigte Einträge auf Standardwerte zurückfallen lassen. */
export function safeConfig(type: PropertyType, config: unknown) {
  try {
    return parsePropertyConfig(type, config);
  } catch {
    try {
      return parsePropertyConfig(type, {});
    } catch {
      return {} as never;
    }
  }
}
