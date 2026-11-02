/** Gemeinsame Konstanten für Hintergrundjobs (BullMQ) zwischen api und worker. */
export const QUEUE_PREFIX = 'jotion';

export const QUEUES = {
  system: 'system',
} as const;

export const SYSTEM_JOBS = {
  heartbeat: 'heartbeat',
  maintenance: 'maintenance',
} as const;

/** Seiten im Papierkorb werden nach so vielen Tagen endgültig gelöscht. */
export const TRASH_RETENTION_DAYS = 30;
/** Veröffentlichte Realtime-Ereignisse werden nach so vielen Tagen entfernt. */
export const EVENT_RETENTION_DAYS = 7;
export const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Redis-Schlüssel, in den der Worker regelmäßig einen Zeitstempel schreibt. */
export const WORKER_HEARTBEAT_KEY = `${QUEUE_PREFIX}:worker:heartbeat`;
export const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;
/** Ein Heartbeat älter als das gilt als ausgefallen. */
export const WORKER_HEARTBEAT_MAX_AGE_MS = 60_000;

export interface WorkerHeartbeat {
  at: number;
  pid: number;
  version: string;
}

export function isHeartbeatFresh(
  hb: WorkerHeartbeat | null,
  now = Date.now(),
  maxAgeMs = WORKER_HEARTBEAT_MAX_AGE_MS,
): boolean {
  return hb !== null && now - hb.at <= maxAgeMs;
}

export function parseHeartbeat(raw: string | null): WorkerHeartbeat | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<WorkerHeartbeat>;
    return typeof v.at === 'number'
      ? { at: v.at, pid: v.pid ?? 0, version: v.version ?? '' }
      : null;
  } catch {
    return null;
  }
}
