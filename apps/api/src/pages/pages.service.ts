import { Injectable } from '@nestjs/common';
import { Prisma, type Page } from '@jotion/db';
import type {
  BreadcrumbDto,
  FavoriteDto,
  PageCover,
  PageDto,
  PageIcon,
  PageSettings,
  PageTreeNodeDto,
  RecentPageDto,
  TrashItemDto,
  createPageSchema,
  movePageSchema,
  reorderFavoriteSchema,
  updatePageSchema,
} from '@jotion/shared';
import { keyBetween } from '@jotion/shared';
import type { z } from 'zod';
import { AppError, forbidden, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { recordEvent } from '../events/outbox';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../permissions/permission.service';
import { computePosition } from './positions';

type Tx = Prisma.TransactionClient;

interface NodeRow {
  id: string;
  parent_id: string | null;
  position: string;
  title: string;
  icon: PageIcon | null;
  scope: 'PRIVATE' | 'TEAM';
  has_children: boolean;
}

const VISIBLE_CHILDREN = Prisma.sql`c.deleted_at IS NULL AND c.archived_at IS NULL`;

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
  ) {}

  // ---------------------------------------------------------------- Baum

  async sidebar(
    user: AuthUser,
    workspaceId: string,
  ): Promise<{ private: PageTreeNodeDto[]; team: PageTreeNodeDto[] }> {
    await this.perms.requireMember(user.id, workspaceId);
    const rows = await this.prisma.client.$queryRaw<NodeRow[]>`
      SELECT p.id::text, NULL::text AS parent_id, p.position, p.title, p.icon, p.scope::text AS scope,
             EXISTS (SELECT 1 FROM pages c WHERE c.parent_id = p.id AND ${VISIBLE_CHILDREN}) AS has_children
        FROM pages p
       WHERE p.workspace_id = ${workspaceId}::uuid AND p.parent_id IS NULL
         AND p.deleted_at IS NULL AND p.archived_at IS NULL
         AND (p.scope = 'TEAM' OR p.owner_id = ${user.id}::uuid)
       ORDER BY p.position, p.id`;
    const nodes = rows.map(toNode);
    return {
      private: nodes.filter((n) => n.scope === 'PRIVATE'),
      team: nodes.filter((n) => n.scope === 'TEAM'),
    };
  }

  async children(user: AuthUser, pageId: string): Promise<PageTreeNodeDto[]> {
    await this.perms.requirePage(user.id, pageId);
    const rows = await this.prisma.client.$queryRaw<NodeRow[]>`
      SELECT p.id::text, p.parent_id::text, p.position, p.title, p.icon, p.scope::text AS scope,
             EXISTS (SELECT 1 FROM pages c WHERE c.parent_id = p.id AND ${VISIBLE_CHILDREN}) AS has_children
        FROM pages p
       WHERE p.parent_id = ${pageId}::uuid AND p.deleted_at IS NULL AND p.archived_at IS NULL
       ORDER BY p.position, p.id`;
    return rows.map(toNode);
  }

  // ---------------------------------------------------------------- Lesen

  async get(user: AuthUser, pageId: string): Promise<PageDto> {
    const { page } = await this.perms.requirePage(user.id, pageId, { includeTrashed: true });
    if (!page.deletedAt) {
      await this.prisma.client.pageVisit.upsert({
        where: { userId_pageId: { userId: user.id, pageId } },
        create: { userId: user.id, pageId },
        update: { visitedAt: new Date() },
      });
    }
    return this.toDto(user, page);
  }

  async breadcrumbs(pageId: string): Promise<BreadcrumbDto[]> {
    return this.prisma.client.$queryRaw<BreadcrumbDto[]>`
      SELECT a.id::text, a.title, a.icon FROM pages a
       WHERE a.path @> (SELECT path FROM pages WHERE id = ${pageId}::uuid) AND a.id <> ${pageId}::uuid
       ORDER BY nlevel(a.path)`;
  }

  // ---------------------------------------------------------------- Schreiben

  async create(
    user: AuthUser,
    workspaceId: string,
    input: z.output<typeof createPageSchema>,
  ): Promise<PageDto> {
    await this.perms.requireMember(user.id, workspaceId);
    let parent: Page | null = null;
    if (input.parentId) {
      parent = (await this.perms.requireEditablePage(user.id, input.parentId)).page;
      if (parent.workspaceId !== workspaceId) throw notFound('Seite');
    }
    if (input.icon?.type === 'file') await this.assertFile(workspaceId, input.icon.fileId);
    const scope = parent ? parent.scope : (input.scope ?? 'PRIVATE');
    const ownerId = parent ? parent.ownerId : user.id;

    const page = await this.prisma.client.$transaction(async (tx) => {
      const position = await computePosition(
        tx,
        { workspaceId, parentId: parent?.id ?? null, scope, ownerId },
        { afterId: input.afterId, beforeId: input.beforeId },
      );
      const created = await tx.page.create({
        data: {
          workspaceId,
          parentId: parent?.id ?? null,
          position,
          title: input.title ?? '',
          icon: input.icon ?? undefined,
          scope,
          ownerId,
          createdById: user.id,
          lastEditedById: user.id,
        },
      });
      await this.event(tx, created, 'page.created', user.id, { parentId: created.parentId });
      return created;
    });
    return this.toDto(user, page);
  }

  async update(
    user: AuthUser,
    pageId: string,
    input: z.output<typeof updatePageSchema>,
  ): Promise<PageDto> {
    const { page } = await this.perms.requireEditablePage(user.id, pageId);
    const settings = (page.settings ?? {}) as PageSettings;
    const touchesContent =
      input.title !== undefined || input.icon !== undefined || input.cover !== undefined;
    const unlocking = input.settings?.locked === false;
    if (settings.locked && touchesContent && !unlocking) throw forbidden('Seite ist gesperrt');
    if (input.icon?.type === 'file') await this.assertFile(page.workspaceId, input.icon.fileId);
    if (input.cover?.type === 'file') await this.assertFile(page.workspaceId, input.cover.fileId);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const u = await tx.page.update({
        where: { id: pageId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.icon !== undefined ? { icon: input.icon ?? Prisma.DbNull } : {}),
          ...(input.cover !== undefined ? { cover: input.cover ?? Prisma.DbNull } : {}),
          ...(input.settings ? { settings: { ...settings, ...input.settings } } : {}),
          lastEditedById: user.id,
          lastEditedAt: new Date(),
        },
      });
      await this.event(tx, u, 'page.updated', user.id, {
        title: u.title,
        icon: u.icon as Prisma.InputJsonValue,
      });
      return u;
    });
    return this.toDto(user, updated);
  }

  async move(
    user: AuthUser,
    pageId: string,
    input: z.output<typeof movePageSchema>,
  ): Promise<PageDto> {
    const access = await this.perms.requireEditablePage(user.id, pageId);
    const { page } = access;
    let parent: Page | null = null;
    if (input.parentId) {
      parent = (await this.perms.requireEditablePage(user.id, input.parentId)).page;
      if (parent.workspaceId !== page.workspaceId)
        throw new AppError('bad_request', 'Verschieben in andere Workspaces folgt später');
    }
    const targetParentId = input.parentId === undefined ? page.parentId : input.parentId;
    if (input.parentId === undefined && page.parentId) {
      parent = (await this.perms.requireEditablePage(user.id, page.parentId)).page;
    }
    const scope = parent ? parent.scope : (input.scope ?? page.scope);
    // Teamseite privat machen verbirgt sie vor allen anderen: nur Ersteller oder Workspace-Owner
    if (
      page.scope === 'TEAM' &&
      scope === 'PRIVATE' &&
      !this.perms.canDeletePermanently(user.id, access.role, page)
    ) {
      throw forbidden('Nur der Ersteller oder ein Owner kann eine Teamseite privat machen');
    }
    const ownerId = parent
      ? parent.ownerId
      : scope === 'PRIVATE'
        ? page.scope === 'PRIVATE'
          ? page.ownerId
          : user.id
        : page.ownerId;

    const moved = await this.prisma.client.$transaction(async (tx) => {
      const position = await computePosition(
        tx,
        { workspaceId: page.workspaceId, parentId: targetParentId, scope, ownerId },
        { afterId: input.afterId, beforeId: input.beforeId, excludeId: page.id },
      );
      const u = await tx.page.update({
        where: { id: pageId },
        data: {
          parentId: targetParentId,
          position,
          ...(targetParentId ? {} : { scope, ownerId }),
          lastEditedById: user.id,
          lastEditedAt: new Date(),
        },
      });
      // Bei Wechsel zwischen privat und Team alle informieren, sonst nur den Owner
      const audienceUserId = page.scope === 'PRIVATE' && u.scope === 'PRIVATE' ? u.ownerId : null;
      await recordEvent(tx, {
        workspaceId: u.workspaceId,
        type: 'page.moved',
        entityId: u.id,
        actorId: user.id,
        audienceUserId,
        payload: { fromParentId: page.parentId, toParentId: u.parentId },
      });
      return u;
    });
    return this.toDto(user, moved);
  }

  async setArchived(user: AuthUser, pageId: string, archived: boolean): Promise<PageDto> {
    const { page } = await this.perms.requireEditablePage(user.id, pageId);
    const u = await this.prisma.client.$transaction(async (tx) => {
      const u = await tx.page.update({
        where: { id: page.id },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.event(tx, u, 'page.archived', user.id, { archived, parentId: u.parentId });
      return u;
    });
    return this.toDto(user, u);
  }

  /** In den Papierkorb: die Seite samt Teilbaum, als Einheit wiederherstellbar. */
  async trash(user: AuthUser, pageId: string): Promise<void> {
    const { page } = await this.perms.requireEditablePage(user.id, pageId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE pages SET deleted_at = now(), deleted_by_id = ${user.id}::uuid, trash_root_id = ${page.id}::uuid
         WHERE path <@ (SELECT path FROM pages WHERE id = ${page.id}::uuid) AND deleted_at IS NULL`;
      await this.event(tx, page, 'page.trashed', user.id, { parentId: page.parentId });
    });
  }

  async restore(user: AuthUser, pageId: string): Promise<PageDto> {
    const { page } = await this.perms.requirePage(user.id, pageId, { includeTrashed: true });
    if (!page.deletedAt) throw new AppError('conflict', 'Seite ist nicht im Papierkorb');
    if (page.trashRootId !== page.id)
      throw new AppError(
        'bad_request',
        'Bitte die übergeordnete Seite im Papierkorb wiederherstellen',
      );

    const restored = await this.prisma.client.$transaction(async (tx) => {
      const parent = page.parentId
        ? await tx.page.findUnique({ where: { id: page.parentId } })
        : null;
      // Elternseite selbst gelöscht: als Wurzelseite im ursprünglichen Bereich wiederherstellen
      if (parent?.deletedAt) {
        const position = await computePosition(
          tx,
          {
            workspaceId: page.workspaceId,
            parentId: null,
            scope: page.scope,
            ownerId: page.ownerId,
          },
          { excludeId: page.id },
        );
        await tx.page.update({
          where: { id: page.id },
          data: { parentId: null, position, scope: page.scope, ownerId: page.ownerId },
        });
      }
      await tx.$executeRaw`
        UPDATE pages SET deleted_at = NULL, deleted_by_id = NULL, trash_root_id = NULL
         WHERE trash_root_id = ${page.id}::uuid`;
      const u = await tx.page.findUniqueOrThrow({ where: { id: page.id } });
      await this.event(tx, u, 'page.restored', user.id, { parentId: u.parentId });
      return u;
    });
    return this.toDto(user, restored);
  }

  async deletePermanently(user: AuthUser, pageId: string): Promise<void> {
    const { page, role } = await this.perms.requirePage(user.id, pageId, { includeTrashed: true });
    if (!page.deletedAt)
      throw new AppError('conflict', 'Nur Seiten im Papierkorb können endgültig gelöscht werden');
    if (!this.perms.canDeletePermanently(user.id, role, page))
      throw forbidden('Nur Ersteller oder Owner können endgültig löschen');
    await this.prisma.client.$transaction(async (tx) => {
      await this.event(tx, page, 'page.deleted', user.id, {});
      await tx.page.delete({ where: { id: page.id } });
    });
  }

  async trashList(user: AuthUser, workspaceId: string): Promise<TrashItemDto[]> {
    const role = await this.perms.requireMember(user.id, workspaceId);
    const rows = await this.prisma.client.$queryRaw<
      {
        id: string;
        title: string;
        icon: PageIcon | null;
        deleted_at: Date;
        deleted_by: string | null;
        parent_title: string | null;
        scope: 'PRIVATE' | 'TEAM';
        owner_id: string;
        created_by_id: string;
      }[]
    >`
      SELECT p.id::text, p.title, p.icon, p.deleted_at, u.name AS deleted_by, par.title AS parent_title,
             p.scope::text AS scope, p.owner_id::text, p.created_by_id::text
        FROM pages p
        LEFT JOIN users u ON u.id = p.deleted_by_id
        LEFT JOIN pages par ON par.id = p.parent_id
       WHERE p.workspace_id = ${workspaceId}::uuid AND p.trash_root_id = p.id
         AND (p.scope = 'TEAM' OR p.owner_id = ${user.id}::uuid)
       ORDER BY p.deleted_at DESC`;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      icon: r.icon,
      deletedAt: r.deleted_at.toISOString(),
      deletedBy: r.deleted_by,
      parentTitle: r.parent_title,
      canDeletePermanently: this.perms.canDeletePermanently(user.id, role, {
        scope: r.scope,
        ownerId: r.owner_id,
        createdById: r.created_by_id,
      }),
    }));
  }

  async archiveList(user: AuthUser, workspaceId: string): Promise<PageTreeNodeDto[]> {
    await this.perms.requireMember(user.id, workspaceId);
    const rows = await this.prisma.client.$queryRaw<NodeRow[]>`
      SELECT p.id::text, p.parent_id::text, p.position, p.title, p.icon, p.scope::text AS scope,
             EXISTS (SELECT 1 FROM pages c WHERE c.parent_id = p.id AND ${VISIBLE_CHILDREN}) AS has_children
        FROM pages p
       WHERE p.workspace_id = ${workspaceId}::uuid AND p.archived_at IS NOT NULL AND p.deleted_at IS NULL
         AND (p.scope = 'TEAM' OR p.owner_id = ${user.id}::uuid)
       ORDER BY p.archived_at DESC`;
    return rows.map(toNode);
  }

  // ---------------------------------------------------------------- Favoriten & Zuletzt

  async favorites(user: AuthUser, workspaceId: string): Promise<FavoriteDto[]> {
    await this.perms.requireMember(user.id, workspaceId);
    const rows = await this.prisma.client.$queryRaw<(NodeRow & { fav_position: string })[]>`
      SELECT p.id::text, p.parent_id::text, f.position AS fav_position, p.position, p.title, p.icon, p.scope::text AS scope,
             EXISTS (SELECT 1 FROM pages c WHERE c.parent_id = p.id AND ${VISIBLE_CHILDREN}) AS has_children
        FROM favorites f JOIN pages p ON p.id = f.page_id
       WHERE f.user_id = ${user.id}::uuid AND p.workspace_id = ${workspaceId}::uuid
         AND p.deleted_at IS NULL AND (p.scope = 'TEAM' OR p.owner_id = ${user.id}::uuid)
       ORDER BY f.position, p.id`;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      icon: r.icon,
      position: r.fav_position,
      hasChildren: r.has_children,
    }));
  }

  async addFavorite(user: AuthUser, pageId: string): Promise<void> {
    await this.perms.requirePage(user.id, pageId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fav:${user.id}`}, 0))`;
      const last = await tx.favorite.findFirst({
        where: { userId: user.id },
        orderBy: { position: 'desc' },
      });
      await tx.favorite.upsert({
        where: { userId_pageId: { userId: user.id, pageId } },
        create: { userId: user.id, pageId, position: keyBetween(last?.position ?? null, null) },
        update: {},
      });
    });
  }

  async removeFavorite(user: AuthUser, pageId: string): Promise<void> {
    await this.prisma.client.favorite.deleteMany({ where: { userId: user.id, pageId } });
  }

  async reorderFavorite(
    user: AuthUser,
    pageId: string,
    input: z.output<typeof reorderFavoriteSchema>,
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fav:${user.id}`}, 0))`;
      const favs = await tx.favorite.findMany({
        where: { userId: user.id, pageId: { not: pageId } },
        orderBy: [{ position: 'asc' }, { pageId: 'asc' }],
      });
      if (
        !(await tx.favorite.findUnique({ where: { userId_pageId: { userId: user.id, pageId } } }))
      )
        throw notFound('Favorit');
      let prev: string | null = favs.at(-1)?.position ?? null;
      let next: string | null = null;
      if (input.afterId) {
        const i = favs.findIndex((f) => f.pageId === input.afterId);
        if (i < 0) throw notFound('Favorit');
        prev = favs[i]!.position;
        next = favs[i + 1]?.position ?? null;
      } else if (input.beforeId) {
        const i = favs.findIndex((f) => f.pageId === input.beforeId);
        if (i < 0) throw notFound('Favorit');
        next = favs[i]!.position;
        prev = favs[i - 1]?.position ?? null;
      }
      await tx.favorite.update({
        where: { userId_pageId: { userId: user.id, pageId } },
        data: { position: keyBetween(prev, next) },
      });
    });
  }

  async recent(user: AuthUser, workspaceId: string): Promise<RecentPageDto[]> {
    await this.perms.requireMember(user.id, workspaceId);
    const rows = await this.prisma.client.$queryRaw<
      { id: string; title: string; icon: PageIcon | null; visited_at: Date }[]
    >`
      SELECT p.id::text, p.title, p.icon, v.visited_at
        FROM page_visits v JOIN pages p ON p.id = v.page_id
       WHERE v.user_id = ${user.id}::uuid AND p.workspace_id = ${workspaceId}::uuid
         AND p.deleted_at IS NULL AND (p.scope = 'TEAM' OR p.owner_id = ${user.id}::uuid)
       ORDER BY v.visited_at DESC LIMIT 20`;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      icon: r.icon,
      visitedAt: r.visited_at.toISOString(),
    }));
  }

  // ---------------------------------------------------------------- Hilfen

  private async assertFile(workspaceId: string, fileId: string): Promise<void> {
    const f = await this.prisma.client.file.findUnique({
      where: { id: fileId },
      select: { workspaceId: true },
    });
    if (!f || f.workspaceId !== workspaceId)
      throw new AppError('bad_request', 'Datei gehört nicht zu diesem Workspace');
  }

  private event(
    tx: Tx,
    page: Page,
    type: Parameters<typeof recordEvent>[1]['type'],
    actorId: string,
    payload: Prisma.InputJsonValue,
  ) {
    return recordEvent(tx, {
      workspaceId: page.workspaceId,
      type,
      entityId: page.id,
      actorId,
      audienceUserId: page.scope === 'PRIVATE' ? page.ownerId : null,
      payload,
    });
  }

  private async toDto(user: AuthUser, page: Page): Promise<PageDto> {
    const [breadcrumbs, fav, people, childCount] = await Promise.all([
      this.breadcrumbs(page.id),
      this.prisma.client.favorite.findUnique({
        where: { userId_pageId: { userId: user.id, pageId: page.id } },
      }),
      this.prisma.client.user.findMany({
        where: { id: { in: [page.createdById, page.lastEditedById] } },
        select: { id: true, name: true },
      }),
      this.prisma.client.page.count({
        where: { parentId: page.id, deletedAt: null, archivedAt: null },
      }),
    ]);
    const name = (id: string) => people.find((p) => p.id === id)?.name ?? '';
    return {
      id: page.id,
      workspaceId: page.workspaceId,
      parentId: page.parentId,
      position: page.position,
      title: page.title,
      icon: (page.icon as PageIcon | null) ?? null,
      cover: (page.cover as PageCover | null) ?? null,
      scope: page.scope,
      settings: (page.settings ?? {}) as PageSettings,
      ownerId: page.ownerId,
      hasChildren: childCount > 0,
      createdBy: { id: page.createdById, name: name(page.createdById) },
      lastEditedBy: { id: page.lastEditedById, name: name(page.lastEditedById) },
      createdAt: page.createdAt.toISOString(),
      lastEditedAt: page.lastEditedAt.toISOString(),
      archivedAt: page.archivedAt?.toISOString() ?? null,
      deletedAt: page.deletedAt?.toISOString() ?? null,
      isFavorite: fav !== null,
      breadcrumbs,
      canEdit: !page.deletedAt,
    };
  }
}

function toNode(r: NodeRow): PageTreeNodeDto {
  return {
    id: r.id,
    parentId: r.parent_id,
    position: r.position,
    title: r.title,
    icon: r.icon,
    scope: r.scope,
    hasChildren: r.has_children,
  };
}
