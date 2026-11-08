import type { Prisma } from '@jotion/db';
import type { NotificationType } from '@jotion/shared';
import { recordEvent } from '../events/outbox';

export interface NotifyInput {
  workspaceId: string;
  pageId: string;
  type: NotificationType;
  actorId: string | null;
  commentId?: string | null;
  payload: { excerpt: string; blockId?: string | null; threadId?: string | null };
}

/**
 * Legt Benachrichtigungen an, aber nur für Mitglieder, die die Seite sehen dürfen, und nie für
 * den Auslöser selbst. Liefert die tatsächlich benachrichtigten Nutzer.
 */
export async function notify(
  tx: Prisma.TransactionClient,
  userIds: Iterable<string>,
  n: NotifyInput,
): Promise<string[]> {
  const ids = [...new Set(userIds)].filter((u) => u !== n.actorId);
  if (!ids.length) return [];
  const allowed = await tx.$queryRaw<{ user_id: string }[]>`
    SELECT m.user_id::text FROM workspace_members m JOIN pages p ON p.id = ${n.pageId}::uuid
     WHERE m.workspace_id = ${n.workspaceId}::uuid AND m.user_id = ANY(${ids}::uuid[])
       AND jotion_level_rank(jotion_page_level(p.path, p.scope, p.owner_id, p.workspace_id, m.user_id)) >= 1`;
  const users = allowed.map((a) => a.user_id);
  for (const userId of users) {
    const created = await tx.notification.create({
      data: {
        workspaceId: n.workspaceId,
        userId,
        type: n.type,
        pageId: n.pageId,
        commentId: n.commentId ?? null,
        actorId: n.actorId,
        payload: n.payload as Prisma.InputJsonValue,
      },
    });
    await recordEvent(tx, {
      workspaceId: n.workspaceId,
      type: 'notification.created',
      entityId: created.id,
      actorId: n.actorId,
      audienceUserId: userId,
    });
  }
  return users;
}
