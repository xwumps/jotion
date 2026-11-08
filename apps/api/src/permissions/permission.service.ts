import { Injectable } from '@nestjs/common';
import { Prisma, type Page, type WorkspaceRole } from '@jotion/db';
import { LEVEL_RANK, type PermissionLevel } from '@jotion/shared';
import { AppError, forbidden, notFound } from '../common/errors';
import { PrismaService } from '../infra/prisma.service';

export interface PageAccess {
  page: Page;
  role: WorkspaceRole;
  /** Phase 10: Zugriffsstufe des Nutzers auf diese Seite */
  level: PermissionLevel;
}

export const atLeast = (level: PermissionLevel, required: PermissionLevel) =>
  LEVEL_RANK[level] >= LEVEL_RANK[required];

/**
 * Zentrale Rechteprüfung.
 *  - Alles innerhalb eines Workspace verlangt Mitgliedschaft.
 *  - Phase 10: Zugriffsstufe je Seite (voll, bearbeiten, kommentieren, ansehen, kein Zugriff) aus
 *    der SQL-Funktion jotion_page_level (einzige Quelle der Regeln, auch für Listen und Suche):
 *    Workspace-Owner volle Rechte auf Team-Seiten, Owner privater Seiten immer volle Rechte, sonst
 *    die nächstgelegene Angabe auf der Seite oder einer Elternseite, ohne Angabe Team-Seiten volle
 *    Rechte, private Seiten kein Zugriff.
 *  - Endgültig löschen: Owner der Seite, bei Team-Seiten zusätzlich Workspace-Owner und Ersteller.
 *  - Mitglieder, Einladungen und Workspace-Einstellungen verwaltet nur der Workspace-Owner.
 * Fehlender Lesezugriff wird als 404 gemeldet, damit keine Existenz verraten wird; wer lesen,
 * aber nicht ändern darf, bekommt 403.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  async memberRole(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
    const m = await this.prisma.client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    return m?.role ?? null;
  }

  async requireMember(userId: string, workspaceId: string): Promise<WorkspaceRole> {
    const role = await this.memberRole(userId, workspaceId);
    if (!role) throw notFound('Workspace');
    return role;
  }

  async requireOwner(userId: string, workspaceId: string): Promise<void> {
    const role = await this.requireMember(userId, workspaceId);
    if (role !== 'OWNER') throw forbidden('Nur Workspace-Owner dürfen das');
  }

  /** Zugriffsstufe eines Nutzers auf Seiten (ohne Mitgliedschaftsprüfung). */
  async levels(userId: string, pageIds: string[]): Promise<Map<string, PermissionLevel>> {
    if (!pageIds.length) return new Map();
    const rows = await this.prisma.client.$queryRaw<{ id: string; level: PermissionLevel }[]>`
      SELECT id::text, jotion_page_level(path, scope, owner_id, workspace_id, ${userId}::uuid) AS level
        FROM pages WHERE id = ANY(${pageIds}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.level]));
  }

  async level(userId: string, pageId: string): Promise<PermissionLevel> {
    return (await this.levels(userId, [pageId])).get(pageId) ?? 'none';
  }

  /**
   * SQL-Bedingung "Nutzer sieht die Seite" für Listen und Suche (Alias der Seitentabelle).
   * Mitgliedschaft im Workspace muss der Aufrufer zusätzlich sicherstellen.
   */
  static visibleSql(userId: string, alias = 'p', min: PermissionLevel = 'view'): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`jotion_level_rank(jotion_page_level(${a}.path, ${a}.scope, ${a}.owner_id, ${a}.workspace_id, ${userId}::uuid)) >= ${LEVEL_RANK[min]}`;
  }

  canDeletePermanently(
    userId: string,
    role: WorkspaceRole,
    page: Pick<Page, 'scope' | 'ownerId' | 'createdById'>,
  ): boolean {
    if (page.scope === 'PRIVATE') return page.ownerId === userId;
    return role === 'OWNER' || page.createdById === userId;
  }

  /**
   * Lädt eine Seite mit mindestens der verlangten Stufe (Standard: ansehen). Gelöschte Seiten nur
   * mit includeTrashed.
   */
  async requirePage(
    userId: string,
    pageId: string,
    opts: { includeTrashed?: boolean; level?: PermissionLevel } = {},
  ): Promise<PageAccess> {
    const page = await this.prisma.client.page.findUnique({ where: { id: pageId } });
    if (!page) throw notFound('Seite');
    const role = await this.memberRole(userId, page.workspaceId);
    if (!role) throw notFound('Seite');
    const level = await this.level(userId, page.id);
    if (!atLeast(level, 'view')) throw notFound('Seite');
    if (page.deletedAt && !opts.includeTrashed) throw notFound('Seite');
    if (opts.level && !atLeast(level, opts.level))
      throw forbidden(
        opts.level === 'comment'
          ? 'Keine Berechtigung zum Kommentieren'
          : 'Keine Berechtigung zum Bearbeiten',
      );
    return { page, role, level };
  }

  /** Seite bearbeiten: mindestens "bearbeiten", nicht im Papierkorb. */
  async requireEditablePage(userId: string, pageId: string): Promise<PageAccess> {
    const access = await this.requirePage(userId, pageId, { level: 'edit' });
    if (access.page.deletedAt) throw new AppError('conflict', 'Seite liegt im Papierkorb');
    return access;
  }
}
