import { Injectable } from '@nestjs/common';
import type { Page, WorkspaceRole } from '@jotion/db';
import { AppError, forbidden, notFound } from '../common/errors';
import { PrismaService } from '../infra/prisma.service';

export interface PageAccess {
  page: Page;
  role: WorkspaceRole;
}

/**
 * Zentrale Rechteprüfung (Phase 1: Workspace-Rollen und privat/Team).
 * Regeln:
 *  - Alles innerhalb eines Workspace verlangt Mitgliedschaft.
 *  - TEAM-Seiten sehen und bearbeiten alle Mitglieder, PRIVATE-Seiten nur ihr Owner.
 *  - Endgültig löschen: Owner der Seite, bei TEAM-Seiten zusätzlich Workspace-Owner.
 *  - Mitglieder, Einladungen und Workspace-Einstellungen verwaltet nur der Workspace-Owner.
 * Fehlender Zugriff auf Seiten wird als 404 gemeldet, damit keine Existenz verraten wird.
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

  canSee(userId: string, page: Pick<Page, 'scope' | 'ownerId'>): boolean {
    return page.scope === 'TEAM' || page.ownerId === userId;
  }

  canDeletePermanently(
    userId: string,
    role: WorkspaceRole,
    page: Pick<Page, 'scope' | 'ownerId' | 'createdById'>,
  ): boolean {
    if (page.scope === 'PRIVATE') return page.ownerId === userId;
    return role === 'OWNER' || page.createdById === userId;
  }

  /** Lädt eine sichtbare Seite. Gelöschte Seiten nur mit includeTrashed. */
  async requirePage(
    userId: string,
    pageId: string,
    opts: { includeTrashed?: boolean } = {},
  ): Promise<PageAccess> {
    const page = await this.prisma.client.page.findUnique({ where: { id: pageId } });
    if (!page) throw notFound('Seite');
    const role = await this.memberRole(userId, page.workspaceId);
    if (!role || !this.canSee(userId, page)) throw notFound('Seite');
    if (page.deletedAt && !opts.includeTrashed) throw notFound('Seite');
    return { page, role };
  }

  /** Wie requirePage, aber die Seite muss bearbeitbar sein (nicht im Papierkorb). */
  async requireEditablePage(userId: string, pageId: string): Promise<PageAccess> {
    const access = await this.requirePage(userId, pageId);
    if (access.page.deletedAt) throw new AppError('conflict', 'Seite liegt im Papierkorb');
    return access;
  }
}
