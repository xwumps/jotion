import { Injectable } from '@nestjs/common';
import type { Comment, Page } from '@jotion/db';
import {
  createCommentSchema,
  markReadSchema,
  resolveThreadSchema,
  updateCommentSchema,
  type CommentDto,
  type CommentThreadDto,
  type InboxDto,
  type NotificationDto,
  type NotificationType,
  type PageCommentsDto,
} from '@jotion/shared';
import { AppError, forbidden, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { parse } from '../common/validation';
import { recordEvent } from '../events/outbox';
import { PrismaService } from '../infra/prisma.service';
import { atLeast, PermissionService } from '../permissions/permission.service';
import { notify } from './notify';

type Tx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

const excerpt = (s: string) => (s.length > 200 ? `${s.slice(0, 199)}…` : s);

/**
 * Phase 10: Kommentare (Seite oder Block, Threads, Auflösen, Erwähnungen) und Posteingang.
 * Lesen verlangt "ansehen", Schreiben "kommentieren". Eigene Kommentare darf der Autor ändern
 * und löschen, löschen dürfen zusätzlich Nutzer mit vollen Rechten.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
  ) {}

  async list(user: AuthUser, pageId: string): Promise<PageCommentsDto> {
    const { page, level } = await this.perms.requirePage(user.id, pageId, { includeTrashed: true });
    const comments = await this.prisma.client.comment.findMany({
      where: { pageId: page.id, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const userIds = new Set<string>();
    for (const c of comments) {
      userIds.add(c.authorId);
      if (c.resolvedById) userIds.add(c.resolvedById);
      for (const m of c.mentions) userIds.add(m);
    }
    const users = await this.names([...userIds]);
    const threads = new Map<string, CommentThreadDto>();
    // Erster Kommentar eines Threads kann gelöscht sein: Thread-Daten aus allen Einträgen
    const heads = await this.prisma.client.comment.findMany({
      where: { id: { in: [...new Set(comments.map((c) => c.threadId))] } },
    });
    const headById = new Map(heads.map((h) => [h.id, h]));
    for (const c of comments) {
      let t = threads.get(c.threadId);
      if (!t) {
        const head = headById.get(c.threadId) ?? c;
        t = {
          id: c.threadId,
          pageId: page.id,
          blockId: head.blockId,
          quote: head.quote,
          resolvedAt: head.resolvedAt?.toISOString() ?? null,
          resolvedBy: head.resolvedById
            ? { id: head.resolvedById, name: users.get(head.resolvedById) ?? '' }
            : null,
          comments: [],
        };
        threads.set(c.threadId, t);
      }
      t.comments.push(this.toDto(user, level === 'full', c, users));
    }
    return {
      threads: [...threads.values()],
      canComment: atLeast(level, 'comment') && !page.deletedAt,
    };
  }

  async create(user: AuthUser, pageId: string, body: unknown): Promise<CommentDto> {
    const input = parse(createCommentSchema, body);
    const { page, level } = await this.perms.requirePage(user.id, pageId, { level: 'comment' });
    let head: Comment | null = null;
    if (input.threadId) {
      head = await this.prisma.client.comment.findUnique({ where: { id: input.threadId } });
      if (!head || head.pageId !== page.id || head.threadId !== head.id) throw notFound('Thread');
    }
    const mentions = await this.validMentions(page, input.mentions);
    const created = await this.prisma.client.$transaction(async (tx) => {
      const id = crypto.randomUUID();
      const c = await tx.comment.create({
        data: {
          id,
          workspaceId: page.workspaceId,
          pageId: page.id,
          threadId: head?.id ?? id,
          blockId: head ? null : (input.blockId ?? null),
          quote: head ? null : (input.quote ?? null),
          body: input.body,
          mentions,
          authorId: user.id,
        },
      });
      // Antwort öffnet einen aufgelösten Thread wieder
      if (head?.resolvedAt)
        await tx.comment.update({
          where: { id: head.id },
          data: { resolvedAt: null, resolvedById: null },
        });
      const base = {
        workspaceId: page.workspaceId,
        pageId: page.id,
        actorId: user.id,
        commentId: c.id,
        payload: {
          excerpt: excerpt(c.body),
          blockId: head?.blockId ?? c.blockId,
          threadId: c.threadId,
        },
      };
      const mentioned = await notify(tx, mentions, { ...base, type: 'mention_comment' });
      if (head) {
        // Antworten an alle bisherigen Beteiligten (ohne die bereits Erwähnten)
        const participants = await tx.comment.findMany({
          where: { threadId: head.id, deletedAt: null },
          select: { authorId: true },
        });
        await notify(
          tx,
          participants.map((p) => p.authorId).filter((u) => !mentioned.includes(u)),
          { ...base, type: 'reply' },
        );
      }
      await this.changed(tx, page, user.id);
      return c;
    });
    const users = await this.names([user.id, ...mentions]);
    return this.toDto(user, level === 'full', created, users);
  }

  async update(user: AuthUser, commentId: string, body: unknown): Promise<CommentDto> {
    const input = parse(updateCommentSchema, body);
    const { comment, page, level } = await this.requireComment(user, commentId);
    if (comment.authorId !== user.id) throw forbidden('Nur eigene Kommentare lassen sich ändern');
    const mentions = await this.validMentions(page, input.mentions);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const u = await tx.comment.update({
        where: { id: comment.id },
        data: { body: input.body, mentions, editedAt: new Date() },
      });
      // Nur neu hinzugekommene Erwähnungen benachrichtigen
      const added = mentions.filter((m) => !comment.mentions.includes(m));
      await notify(tx, added, {
        workspaceId: page.workspaceId,
        pageId: page.id,
        type: 'mention_comment',
        actorId: user.id,
        commentId: u.id,
        payload: { excerpt: excerpt(u.body), blockId: null, threadId: u.threadId },
      });
      await this.changed(tx, page, user.id);
      return u;
    });
    return this.toDto(user, level === 'full', updated, await this.names([user.id, ...mentions]));
  }

  async remove(user: AuthUser, commentId: string): Promise<void> {
    const { comment, page, level } = await this.requireComment(user, commentId);
    if (comment.authorId !== user.id && level !== 'full')
      throw forbidden('Nur eigene Kommentare lassen sich löschen');
    await this.prisma.client.$transaction(async (tx) => {
      await tx.comment.update({ where: { id: comment.id }, data: { deletedAt: new Date() } });
      await tx.notification.deleteMany({ where: { commentId: comment.id } });
      await this.changed(tx, page, user.id);
    });
  }

  async resolve(user: AuthUser, threadId: string, body: unknown): Promise<void> {
    const input = parse(resolveThreadSchema, body);
    const { comment, page } = await this.requireComment(user, threadId);
    if (comment.threadId !== comment.id) throw notFound('Thread');
    await this.prisma.client.$transaction(async (tx) => {
      await tx.comment.update({
        where: { id: comment.id },
        data: input.resolved
          ? { resolvedAt: new Date(), resolvedById: user.id }
          : { resolvedAt: null, resolvedById: null },
      });
      await this.changed(tx, page, user.id);
    });
  }

  // ---------------------------------------------------------------- Posteingang

  async inbox(user: AuthUser, workspaceId: string): Promise<InboxDto> {
    await this.perms.requireMember(user.id, workspaceId);
    // Benachrichtigungen zu Seiten, die der Nutzer nicht mehr sieht, bleiben verborgen
    const rows = await this.prisma.client.$queryRaw<
      {
        id: string;
        type: NotificationType;
        page_id: string | null;
        title: string | null;
        actor_id: string | null;
        actor_name: string | null;
        payload: { excerpt?: string; blockId?: string | null; threadId?: string | null };
        read_at: Date | null;
        created_at: Date;
      }[]
    >`
      SELECT n.id::text, n.type, n.page_id::text, p.title, n.actor_id::text, u.name AS actor_name,
             n.payload, n.read_at, n.created_at
        FROM notifications n
        JOIN pages p ON p.id = n.page_id AND p.deleted_at IS NULL
        LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = ${user.id}::uuid AND n.workspace_id = ${workspaceId}::uuid
         AND ${PermissionService.visibleSql(user.id)}
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT 100`;
    const items: NotificationDto[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      page: r.page_id ? { id: r.page_id, title: r.title ?? '' } : null,
      actor: r.actor_id ? { id: r.actor_id, name: r.actor_name ?? '' } : null,
      blockId: r.payload.blockId ?? null,
      threadId: r.payload.threadId ?? null,
      excerpt: r.payload.excerpt ?? '',
      readAt: r.read_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
    }));
    return { items, unread: items.filter((i) => !i.readAt).length };
  }

  async markRead(user: AuthUser, workspaceId: string, body: unknown): Promise<void> {
    const input = parse(markReadSchema, body);
    await this.perms.requireMember(user.id, workspaceId);
    if (!input.all && !input.ids?.length)
      throw new AppError('validation_failed', 'ids oder all angeben');
    await this.prisma.client.notification.updateMany({
      where: {
        userId: user.id,
        workspaceId,
        readAt: null,
        ...(input.all ? {} : { id: { in: input.ids } }),
      },
      data: { readAt: new Date() },
    });
  }

  // ---------------------------------------------------------------- intern

  private async requireComment(user: AuthUser, commentId: string) {
    const comment = await this.prisma.client.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) throw notFound('Kommentar');
    const { page, level } = await this.perms
      .requirePage(user.id, comment.pageId, { level: 'comment' })
      .catch((e: unknown) => {
        if (e instanceof AppError && e.code === 'not_found') throw notFound('Kommentar');
        throw e;
      });
    return { comment, page, level };
  }

  /** Nur Mitglieder des Workspace; Erwähnte ohne Lesezugriff werden später nicht benachrichtigt. */
  private async validMentions(page: Page, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const members = await this.prisma.client.workspaceMember.findMany({
      where: { workspaceId: page.workspaceId, userId: { in: ids } },
      select: { userId: true },
    });
    return [...new Set(members.map((m) => m.userId))];
  }

  private changed(tx: Tx, page: Page, actorId: string) {
    return recordEvent(tx, {
      workspaceId: page.workspaceId,
      type: 'comments.changed',
      entityId: page.id,
      actorId,
      audienceUserId: page.scope === 'PRIVATE' ? page.ownerId : null,
    });
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private toDto(user: AuthUser, full: boolean, c: Comment, users: Map<string, string>): CommentDto {
    return {
      id: c.id,
      threadId: c.threadId,
      body: c.body,
      mentions: c.mentions.map((id) => ({ id, name: users.get(id) ?? '' })),
      author: { id: c.authorId, name: users.get(c.authorId) ?? '' },
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
      canEdit: c.authorId === user.id,
      canDelete: c.authorId === user.id || full,
    };
  }
}
