import type { Prisma } from '@jotion/db';
import type { RealtimeEventType } from '@jotion/shared';

export interface OutboxEventInput {
  workspaceId: string;
  type: RealtimeEventType;
  entityId: string;
  actorId: string | null;
  /** Nur dieser Nutzer erhält das Ereignis (private Seiten) */
  audienceUserId?: string | null;
  payload?: Prisma.InputJsonValue;
}

/** Schreibt ein Ereignis in die Outbox. Immer innerhalb der Transaktion der Änderung aufrufen. */
export async function recordEvent(
  tx: Prisma.TransactionClient,
  e: OutboxEventInput,
): Promise<void> {
  await tx.changeEvent.create({
    data: {
      workspaceId: e.workspaceId,
      type: e.type,
      entityId: e.entityId,
      actorId: e.actorId,
      audienceUserId: e.audienceUserId ?? null,
      payload: e.payload ?? {},
    },
  });
}
