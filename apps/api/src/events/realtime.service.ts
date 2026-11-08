import { chartVersionKey } from '../databases/charts.service';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { RealtimeEvent, RealtimeEventType } from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import { Redis } from 'ioredis';
import { SERVER_ENV } from '../config/config.module';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

const CHANNEL_PREFIX = 'jotion:events:';
const RELAY_LOCK = 7_301_002;
const RELAY_INTERVAL_MS = 150;

interface Envelope extends RealtimeEvent {
  audienceUserId: string | null;
  /** Phase 10: eingeschränkte Seiten gehen nur an diese Mitglieder */
  audienceUserIds?: string[];
}

/** Ereignisse ohne Seiteninhalt, die unabhängig von Rechten an alle (bzw. audienceUserId) gehen */
const UNFILTERED = new Set<RealtimeEventType>([
  'page.access.changed',
  'notification.created',
  'workspace.updated',
  'members.changed',
]);

export interface Subscriber {
  userId: string;
  send: (event: RealtimeEvent) => void;
}

/**
 * Transactional-Outbox-Relay und Fan-out an verbundene Clients.
 * 1. Relay liest unveröffentlichte change_events (nur eine Instanz gleichzeitig, Advisory Lock),
 *    publiziert sie in Redis und markiert sie als veröffentlicht.
 * 2. Ein Redis-Subscriber verteilt Ereignisse an die SSE-Verbindungen dieses Prozesses.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Realtime');
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private subscriber: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;
  private relaying = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.NODE_ENV === 'test' && process.env.JOTION_DISABLE_RELAY === '1') return;
    this.subscriber = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.subscriber.on('error', () => undefined);
    await this.subscriber.psubscribe(`${CHANNEL_PREFIX}*`);
    this.subscriber.on('pmessage', (_p, channel, message) =>
      this.dispatch(channel.slice(CHANNEL_PREFIX.length), message),
    );
    this.timer = setInterval(() => void this.relayOnce(), RELAY_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.subscriber?.disconnect();
  }

  subscribe(workspaceId: string, sub: Subscriber): () => void {
    let set = this.subscribers.get(workspaceId);
    if (!set) this.subscribers.set(workspaceId, (set = new Set()));
    set.add(sub);
    return () => {
      set.delete(sub);
      if (set.size === 0) this.subscribers.delete(workspaceId);
    };
  }

  /** Veröffentlicht ausstehende Ereignisse. Öffentlich für Tests. */
  async relayOnce(): Promise<number> {
    if (this.relaying) return 0;
    this.relaying = true;
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const [lock] = await tx.$queryRaw<
          { ok: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(${RELAY_LOCK}) AS ok`;
        if (!lock?.ok) return 0;
        const rows = await tx.$queryRaw<
          {
            id: bigint;
            workspace_id: string;
            type: RealtimeEventType;
            entity_id: string;
            audience_user_id: string | null;
            payload: Record<string, unknown>;
            actor_id: string | null;
          }[]
        >`SELECT id, workspace_id::text, type, entity_id::text, audience_user_id::text, payload, actor_id::text
            FROM change_events WHERE published_at IS NULL ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return 0;
        const audiences = await this.audiences(
          tx,
          rows.filter((r) => !UNFILTERED.has(r.type)).map((r) => r.entity_id),
        );
        const pipeline = this.redis.client.multi();
        for (const r of rows) {
          const env: Envelope = {
            id: r.id.toString(),
            type: r.type,
            entityId: r.entity_id,
            payload: r.payload,
            actorId: r.actor_id,
            audienceUserId: r.audience_user_id,
          };
          const restricted = UNFILTERED.has(r.type) ? undefined : audiences.get(r.entity_id);
          if (restricted) env.audienceUserIds = restricted;
          pipeline.publish(`${CHANNEL_PREFIX}${r.workspace_id}`, JSON.stringify(env));
          // Diagramm-Cache dieser Datenbank ungültig machen (Phase 7)
          if (r.type === 'database.rows.changed' || r.type === 'database.changed')
            pipeline.incr(chartVersionKey(r.entity_id));
        }
        await pipeline.exec();
        const ids = rows.map((r) => r.id);
        await tx.$executeRaw`UPDATE change_events SET published_at = now() WHERE id = ANY(${ids}::bigint[])`;
        return rows.length;
      });
    } catch (err) {
      this.logger.warn(`Relay fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    } finally {
      this.relaying = false;
    }
  }

  /**
   * Phase 10: Empfänger je Seite, falls die Seite nicht für alle Mitglieder sichtbar ist (privat
   * oder mit Freigabe-Angaben auf dem Pfad). Seiten ohne Einschränkung fehlen in der Map.
   */
  private async audiences(
    tx: Pick<PrismaService['client'], '$queryRaw'>,
    entityIds: string[],
  ): Promise<Map<string, string[]>> {
    const ids = [...new Set(entityIds)];
    if (!ids.length) return new Map();
    const rows = await tx.$queryRaw<{ id: string; users: string[] }[]>`
      SELECT p.id::text,
             ARRAY(SELECT m.user_id::text FROM workspace_members m
                    WHERE m.workspace_id = p.workspace_id
                      AND jotion_level_rank(jotion_page_level(p.path, p.scope, p.owner_id, p.workspace_id, m.user_id)) >= 1) AS users
        FROM pages p
       WHERE p.id = ANY(${ids}::uuid[])
         AND (p.scope = 'PRIVATE' OR EXISTS (
               SELECT 1 FROM page_permissions pp JOIN pages a ON a.id = pp.page_id
                WHERE pp.workspace_id = p.workspace_id AND a.path @> p.path))`;
    return new Map(rows.map((r) => [r.id, r.users]));
  }

  private dispatch(workspaceId: string, message: string): void {
    const set = this.subscribers.get(workspaceId);
    if (!set) return;
    let env: Envelope;
    try {
      env = JSON.parse(message) as Envelope;
    } catch {
      return;
    }
    const { audienceUserId, audienceUserIds, ...event } = env;
    for (const sub of set) {
      if (audienceUserIds && !audienceUserIds.includes(sub.userId)) continue;
      if (!audienceUserIds && audienceUserId && audienceUserId !== sub.userId) continue;
      sub.send(event);
    }
  }
}
