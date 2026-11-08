import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@jotion/db';
import { docToJson } from '@jotion/editor/projection';
import {
  setPermissionSchema,
  type PageContentDto,
  type PageIcon,
  type PermissionEntryDto,
  type PermissionLevel,
  type PublicPageDto,
  type SharingDto,
} from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import { CollabService } from '../collab/collab.service';
import { DocStore } from '../collab/doc-store';
import { AppError, forbidden, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { generateToken } from '../common/tokens';
import { parse } from '../common/validation';
import { SERVER_ENV } from '../config/config.module';
import { recordEvent } from '../events/outbox';
import { PrismaService } from '../infra/prisma.service';
import { atLeast, PermissionService } from '../permissions/permission.service';

/** Seitenarten, auf denen Freigaben gesetzt werden können (Zeilen erben von der Datenbank) */
const SHAREABLE = new Set(['PAGE', 'DATABASE']);

/**
 * Phase 10: Teilen. Angaben je Mitglied oder für alle Mitglieder (Team-Seiten), vererbt an
 * Unterseiten; Lese-Link für Personen ohne Konto (Seite und Unterseiten, nur Text).
 */
@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly collab: CollabService,
    private readonly store: DocStore,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
  ) {}

  async get(user: AuthUser, pageId: string): Promise<SharingDto> {
    const { page, level } = await this.perms.requirePage(user.id, pageId, { includeTrashed: true });
    const canManage = atLeast(level, 'full') && SHAREABLE.has(page.kind);
    const ancestors = await this.prisma.client.$queryRaw<
      { id: string; title: string; depth: number }[]
    >`SELECT id::text, title, nlevel(path) AS depth FROM pages
       WHERE workspace_id = ${page.workspaceId}::uuid
         AND path @> (SELECT path FROM pages WHERE id = ${page.id}::uuid)`;
    const depth = new Map(ancestors.map((a) => [a.id, a.depth]));
    const titles = new Map(ancestors.map((a) => [a.id, a.title]));
    const perms = await this.prisma.client.pagePermission.findMany({
      where: { pageId: { in: ancestors.map((a) => a.id) } },
    });
    // Nächstgelegene Angabe je Nutzer (bzw. für alle) gewinnt
    perms.sort((a, b) => (depth.get(b.pageId) ?? 0) - (depth.get(a.pageId) ?? 0));
    const seen = new Set<string>();
    const nearest = perms.filter((p) => {
      const k = p.userId ?? '*';
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const members = await this.prisma.client.workspaceMember.findMany({
      where: { workspaceId: page.workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    const users = new Map(members.map((m) => [m.userId, m.user]));
    const levels = await this.memberLevels(
      page,
      members.map((m) => m.userId),
    );
    const general = nearest.find((p) => p.userId === null);
    const entries: PermissionEntryDto[] = nearest
      .filter((p) => p.userId === null || users.has(p.userId))
      .map((p) => ({
        userId: p.userId,
        name: p.userId ? (users.get(p.userId)?.name ?? null) : null,
        email: p.userId ? (users.get(p.userId)?.email ?? null) : null,
        level: p.level,
        sourcePageId: p.pageId,
        sourceTitle: titles.get(p.pageId) ?? '',
        inherited: p.pageId !== page.id,
      }));
    const link = canManage
      ? await this.prisma.client.pageShareLink.findUnique({ where: { pageId: page.id } })
      : null;
    return {
      pageId: page.id,
      scope: page.scope,
      myLevel: level,
      canManage,
      general: page.scope === 'TEAM' ? (general?.level ?? 'full') : 'none',
      entries,
      // Wer keine Rechte verwaltet, sieht nur die Angaben, nicht die Stufen aller Mitglieder
      members: canManage
        ? members.map((m) => ({
            userId: m.userId,
            name: m.user.name,
            email: m.user.email,
            level: levels.get(m.userId) ?? 'none',
            fixed: page.scope === 'TEAM' ? m.role === 'OWNER' : m.userId === page.ownerId,
          }))
        : [],
      shareLink: link ? { token: link.token, url: this.url(link.token) } : null,
    };
  }

  /** Angabe setzen oder entfernen (verlangt volle Rechte). */
  async setPermission(user: AuthUser, pageId: string, body: unknown): Promise<SharingDto> {
    const input = parse(setPermissionSchema, body);
    const page = await this.requireManage(user, pageId);
    if (input.userId === null && page.scope === 'PRIVATE')
      throw new AppError(
        'validation_failed',
        'Private Seiten haben keine Angabe für alle Mitglieder',
      );
    if (input.userId) {
      const m = await this.perms.memberRole(input.userId, page.workspaceId);
      if (!m) throw notFound('Mitglied');
      if (page.scope === 'PRIVATE' && input.userId === page.ownerId)
        throw new AppError(
          'validation_failed',
          'Der Owner einer privaten Seite hat immer volle Rechte',
        );
      if (page.scope === 'TEAM' && m === 'OWNER')
        throw new AppError(
          'validation_failed',
          'Workspace-Owner haben auf Team-Seiten immer volle Rechte',
        );
    }
    await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.pagePermission.findFirst({
        where: { pageId: page.id, userId: input.userId },
      });
      if (input.level === null) {
        if (existing) await tx.pagePermission.delete({ where: { id: existing.id } });
      } else if (existing) {
        await tx.pagePermission.update({
          where: { id: existing.id },
          data: { level: input.level },
        });
      } else {
        await tx.pagePermission.create({
          data: {
            workspaceId: page.workspaceId,
            pageId: page.id,
            userId: input.userId,
            level: input.level,
            createdById: user.id,
          },
        });
      }
      // Wer Rechte verwaltet, sperrt sich nicht selbst aus
      const [own] = await tx.$queryRaw<{ level: PermissionLevel }[]>`
        SELECT jotion_page_level(path, scope, owner_id, workspace_id, ${user.id}::uuid) AS level
          FROM pages WHERE id = ${page.id}::uuid`;
      if (!own || !atLeast(own.level, 'full')) {
        const mine = await tx.pagePermission.findFirst({
          where: { pageId: page.id, userId: user.id },
        });
        if (mine)
          await tx.pagePermission.update({ where: { id: mine.id }, data: { level: 'full' } });
        else
          await tx.pagePermission.create({
            data: {
              workspaceId: page.workspaceId,
              pageId: page.id,
              userId: user.id,
              level: 'full',
              createdById: user.id,
            },
          });
      }
      await recordEvent(tx, {
        workspaceId: page.workspaceId,
        type: 'page.access.changed',
        entityId: page.id,
        actorId: user.id,
        audienceUserId: null,
        payload: {},
      });
    });
    // Offene Editoren mit neuen Rechten verbinden (schreibgeschützt oder nicht)
    this.collab.revalidate();
    return this.get(user, page.id);
  }

  async createLink(user: AuthUser, pageId: string): Promise<{ token: string; url: string }> {
    const page = await this.requireManage(user, pageId);
    const existing = await this.prisma.client.pageShareLink.findUnique({
      where: { pageId: page.id },
    });
    if (existing) return { token: existing.token, url: this.url(existing.token) };
    const token = generateToken();
    await this.prisma.client.pageShareLink.create({
      data: { pageId: page.id, token, createdById: user.id },
    });
    return { token, url: this.url(token) };
  }

  async deleteLink(user: AuthUser, pageId: string): Promise<void> {
    const page = await this.requireManage(user, pageId);
    await this.prisma.client.pageShareLink.deleteMany({ where: { pageId: page.id } });
  }

  /**
   * Öffentliche Leseansicht über den Link: die geteilte Seite oder eine ihrer Unterseiten.
   * Gelöschte, archivierte und Vorlagen-Seiten bleiben verborgen.
   */
  async publicPage(token: string, pageId?: string): Promise<PublicPageDto> {
    const link = await this.prisma.client.pageShareLink.findUnique({ where: { token } });
    if (!link) throw notFound('Seite');
    const root = await this.prisma.client.page.findUnique({ where: { id: link.pageId } });
    if (!root || root.deletedAt) throw notFound('Seite');
    let page: Page | null = root;
    if (pageId && pageId !== root.id) {
      const [inside] = await this.prisma.client.$queryRaw<{ ok: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pages c, pages r
          WHERE c.id = ${pageId}::uuid AND r.id = ${root.id}::uuid AND c.path <@ r.path) AS ok`;
      page = inside?.ok
        ? await this.prisma.client.page.findUnique({ where: { id: pageId } })
        : null;
    }
    if (!page || page.deletedAt || page.kind === 'ROW_TEMPLATE') throw notFound('Seite');
    const children = await this.prisma.client.page.findMany({
      where: {
        parentId: page.id,
        deletedAt: null,
        archivedAt: null,
        kind: { in: ['PAGE', 'DATABASE'] },
      },
      orderBy: { position: 'asc' },
      select: { id: true, title: true, icon: true, kind: true },
    });
    const doc = await this.store.loadDoc(page.id);
    try {
      return {
        rootId: root.id,
        page: {
          id: page.id,
          title: page.title,
          icon: (page.icon as PageIcon | null) ?? null,
          kind: page.kind === 'DATABASE' ? 'DATABASE' : 'PAGE',
          parentId: page.id === root.id ? null : page.parentId,
        },
        doc: docToJson(doc) as PageContentDto['doc'],
        children: children.map((c) => ({
          id: c.id,
          title: c.title,
          icon: (c.icon as PageIcon | null) ?? null,
        })),
      };
    } finally {
      doc.destroy();
    }
  }

  private async requireManage(user: AuthUser, pageId: string): Promise<Page> {
    const { page } = await this.perms.requirePage(user.id, pageId, { level: 'full' }).catch((e) => {
      if (e instanceof AppError && e.code === 'forbidden')
        throw forbidden('Nur mit vollen Rechten lassen sich Freigaben ändern');
      throw e;
    });
    if (!SHAREABLE.has(page.kind))
      throw new AppError(
        'validation_failed',
        'Zeilen erben die Freigaben ihrer Datenbank; bitte dort ändern',
      );
    return page;
  }

  private async memberLevels(page: Page, userIds: string[]): Promise<Map<string, PermissionLevel>> {
    if (!userIds.length) return new Map();
    const rows = await this.prisma.client.$queryRaw<{ user_id: string; level: PermissionLevel }[]>`
      SELECT u::text AS user_id, jotion_page_level(p.path, p.scope, p.owner_id, p.workspace_id, u) AS level
        FROM pages p, unnest(${userIds}::uuid[]) AS u WHERE p.id = ${page.id}::uuid`;
    return new Map(rows.map((r) => [r.user_id, r.level]));
  }

  private url(token: string): string {
    return new URL(`/share/${token}`, this.env.JOTION_PUBLIC_URL).toString();
  }
}
