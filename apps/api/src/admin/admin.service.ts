import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import {
  runCheck,
  updateAdminUserSchema,
  WORKER_HEARTBEAT_KEY,
  isHeartbeatFresh,
  parseHeartbeat,
  type AdminBackupDto,
  type AdminStatusDto,
  type AdminUserDto,
} from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import { AppError, forbidden, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { parse } from '../common/validation';
import { SERVER_ENV } from '../config/config.module';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { API_VERSION } from '../version';

const ARCHIVE = /^jotion-(\d{8})-(\d{6})-([a-z-]+)\.tar$/;
const started = Date.now();
const UPDATE_KEY = 'jotion:update-check';

/** Vergleicht Versionen der Form 1.2.3: positiv, wenn a neuer ist als b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * Phase 12: Admin-Bereich für Instanz-Admins: Zustand des Servers, Sicherungen (Liste, jetzt
 * sichern), Konten (sperren, Admin-Recht). Nie über API-Tokens erreichbar (Guard).
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
  ) {}

  requireAdmin(user: AuthUser): void {
    if (!user.isAdmin || user.tokenScope) throw forbidden('Nur für Admins dieser Jotion-Instanz');
  }

  async status(user: AuthUser): Promise<AdminStatusDto> {
    this.requireAdmin(user);
    const [database, redis, worker] = await Promise.all([
      runCheck(() => this.prisma.ping()),
      runCheck(() => this.redis.ping()),
      runCheck(async () => {
        const hb = parseHeartbeat(await this.redis.client.get(WORKER_HEARTBEAT_KEY));
        if (!isHeartbeatFresh(hb)) throw new Error('Kein aktueller Heartbeat');
      }),
    ]);
    const db = this.prisma.client;
    const [users, workspaces, pages, databases, files, sizes] = await Promise.all([
      db.user.count(),
      db.workspace.count(),
      db.page.count({ where: { deletedAt: null, kind: 'PAGE' } }),
      db.page.count({ where: { deletedAt: null, kind: 'DATABASE' } }),
      db.file.aggregate({ _count: true, _sum: { size: true } }),
      db.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`,
    ]);
    return {
      version: API_VERSION,
      update: await this.updateInfo(),
      uptimeSeconds: Math.round((Date.now() - started) / 1000),
      checks: { database, redis, worker },
      counts: { users, workspaces, pages, databases, files: files._count },
      storage: { filesBytes: files._sum.size ?? 0, databaseBytes: Number(sizes[0]?.bytes ?? 0) },
      backups: await this.backups(),
    };
  }

  /**
   * Phase 12.2: neuestes Release bei GitHub, höchstens einmal am Tag abgefragt (Ergebnis in Redis)
   * und nur, wenn ein Admin den Bereich öffnet. Gesendet wird nur die Anfrage selbst.
   */
  private async updateInfo(): Promise<AdminStatusDto['update']> {
    if (!this.env.JOTION_UPDATE_CHECK) return null;
    let info: { latest: string; url: string } | null = null;
    const cached = await this.redis.client.get(UPDATE_KEY);
    if (cached !== null) {
      info = JSON.parse(cached) as typeof info;
    } else {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${this.env.JOTION_UPDATE_REPO}/releases/latest`,
          {
            headers: { accept: 'application/vnd.github+json', 'user-agent': 'jotion-update-check' },
            signal: AbortSignal.timeout(5000),
          },
        );
        if (res.ok) {
          const body = (await res.json()) as { tag_name?: string; html_url?: string };
          const latest = String(body.tag_name ?? '').replace(/^v/, '');
          if (/^\d+\.\d+\.\d+$/.test(latest)) info = { latest, url: String(body.html_url ?? '') };
        }
      } catch {
        info = null;
      }
      // Fehlschläge nur 6 Stunden merken, damit ein neues Release bald auftaucht
      await this.redis.client.set(UPDATE_KEY, JSON.stringify(info), 'EX', info ? 86_400 : 21_600);
    }
    if (!info) return null;
    return { ...info, available: compareVersions(info.latest, API_VERSION) > 0 };
  }

  private async backups(): Promise<AdminStatusDto['backups']> {
    const dir = this.env.JOTION_BACKUP_DIR;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return { available: false, last: null, requested: false, list: [] };
    }
    const list: AdminBackupDto[] = [];
    for (const name of names) {
      const m = ARCHIVE.exec(name);
      if (!m) continue;
      const s = await stat(join(dir, name)).catch(() => null);
      if (!s) continue;
      const d = m[1]!;
      const t = m[2]!;
      list.push({
        name,
        size: s.size,
        createdAt: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}Z`,
        trigger: m[3]!,
      });
    }
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    let last: AdminStatusDto['backups']['last'] = null;
    try {
      const st = JSON.parse(await readFile(join(dir, 'status.json'), 'utf8')) as {
        lastRun: string;
        ok: boolean;
        file?: string;
        error?: string;
      };
      last = { at: st.lastRun, ok: st.ok, file: st.file, error: st.error };
    } catch {
      /* noch keine Sicherung */
    }
    const requested = await stat(join(dir, '.request')).then(
      () => true,
      () => false,
    );
    return { available: true, last, requested, list };
  }

  /** Sicherung anfordern: der Backup-Dienst prüft alle 10 Sekunden auf die Datei. */
  async requestBackup(user: AuthUser): Promise<{ requested: true }> {
    this.requireAdmin(user);
    try {
      await writeFile(join(this.env.JOTION_BACKUP_DIR, '.request'), new Date().toISOString());
    } catch {
      throw new AppError(
        'conflict',
        'Das Sicherungsverzeichnis ist nicht verfügbar (Backup-Dienst eingerichtet?)',
      );
    }
    return { requested: true };
  }

  async users(user: AuthUser): Promise<AdminUserDto[]> {
    this.requireAdmin(user);
    const rows = await this.prisma.client.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { memberships: true } } },
    });
    const seen = await this.prisma.client.$queryRaw<{ user_id: string; at: Date }[]>`
      SELECT user_id::text, max(last_seen_at) AS at FROM sessions GROUP BY user_id`;
    const lastSeen = new Map(seen.map((s) => [s.user_id, s.at]));
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      isAdmin: u.isAdmin,
      disabled: !!u.disabledAt,
      createdAt: u.createdAt.toISOString(),
      lastSeenAt: lastSeen.get(u.id)?.toISOString() ?? null,
      workspaces: u._count.memberships,
    }));
  }

  async updateUser(user: AuthUser, id: string, body: unknown): Promise<AdminUserDto> {
    this.requireAdmin(user);
    const input = parse(updateAdminUserSchema, body);
    const target = await this.prisma.client.user.findUnique({ where: { id } });
    if (!target) throw notFound('Konto');
    if (id === user.id && (input.isAdmin === false || input.disabled === true))
      throw new AppError(
        'validation_failed',
        'Das eigene Konto lässt sich nicht sperren oder herabstufen',
      );
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(input.isAdmin !== undefined ? { isAdmin: input.isAdmin } : {}),
          ...(input.disabled !== undefined
            ? { disabledAt: input.disabled ? new Date() : null }
            : {}),
        },
      });
      // Gesperrt: alle Sitzungen und Tokens sofort ungültig
      if (input.disabled) {
        await tx.session.deleteMany({ where: { userId: id } });
        await tx.apiToken.deleteMany({ where: { userId: id } });
      }
      if ((await tx.user.count({ where: { isAdmin: true, disabledAt: null } })) === 0)
        throw new AppError('validation_failed', 'Es muss mindestens einen aktiven Admin geben');
    });
    return (await this.users(user)).find((u) => u.id === id)!;
  }

  // ---------------------------------------------------------------- Metriken

  /** Prometheus-Textformat; nur mit JOTION_METRICS_TOKEN (sonst 404). */
  async metrics(authorization: string | undefined): Promise<string> {
    const token = this.env.JOTION_METRICS_TOKEN;
    if (!token) throw notFound('Seite');
    if (authorization !== `Bearer ${token}`) throw new AppError('unauthenticated', 'Token fehlt');
    const db = this.prisma.client;
    const [users, active, pages, rows, files, connections, failedRuns, sessions] =
      await Promise.all([
        db.user.count({ where: { disabledAt: null } }),
        db.session.count({ where: { lastSeenAt: { gt: new Date(Date.now() - 86_400_000) } } }),
        db.page.count({ where: { deletedAt: null, kind: { in: ['PAGE', 'DATABASE'] } } }),
        db.page.count({ where: { deletedAt: null, kind: 'DATABASE_ROW' } }),
        db.file.aggregate({ _sum: { size: true }, _count: true }),
        db.integrationConnection.groupBy({ by: ['status'], _count: true }),
        db.syncRun.count({
          where: { status: 'failed', startedAt: { gt: new Date(Date.now() - 86_400_000) } },
        }),
        db.session.count(),
      ]);
    const backups = await this.backups();
    const lastOk = backups.last?.ok && backups.last.at ? Date.parse(backups.last.at) / 1000 : 0;
    const lines = [
      ['jotion_info', 'Version', 'gauge', `jotion_info{version="${API_VERSION}"} 1`],
      [
        'jotion_uptime_seconds',
        'Laufzeit der API',
        'gauge',
        `jotion_uptime_seconds ${Math.round((Date.now() - started) / 1000)}`,
      ],
      ['jotion_users', 'Aktive Konten', 'gauge', `jotion_users ${users}`],
      ['jotion_sessions', 'Sitzungen', 'gauge', `jotion_sessions ${sessions}`],
      [
        'jotion_sessions_active_24h',
        'In den letzten 24 h aktive Sitzungen',
        'gauge',
        `jotion_sessions_active_24h ${active}`,
      ],
      ['jotion_pages', 'Seiten und Datenbanken', 'gauge', `jotion_pages ${pages}`],
      ['jotion_database_rows', 'Datenbankzeilen', 'gauge', `jotion_database_rows ${rows}`],
      ['jotion_files', 'Dateien', 'gauge', `jotion_files ${files._count}`],
      [
        'jotion_files_bytes',
        'Größe der Dateien',
        'gauge',
        `jotion_files_bytes ${files._sum.size ?? 0}`,
      ],
      [
        'jotion_integration_connections',
        'Verbindungen nach Status',
        'gauge',
        connections
          .map((c) => `jotion_integration_connections{status="${c.status}"} ${c._count}`)
          .join('\n') || 'jotion_integration_connections{status="active"} 0',
      ],
      [
        'jotion_sync_runs_failed_24h',
        'Fehlgeschlagene Sync-Läufe (24 h)',
        'gauge',
        `jotion_sync_runs_failed_24h ${failedRuns}`,
      ],
      [
        'jotion_backup_last_success_timestamp',
        'Letzte erfolgreiche Sicherung (Unix-Zeit)',
        'gauge',
        `jotion_backup_last_success_timestamp ${Math.round(lastOk)}`,
      ],
      [
        'jotion_backups',
        'Vorhandene Sicherungen',
        'gauge',
        `jotion_backups ${backups.list.length}`,
      ],
    ];
    return `${lines.map(([name, help, type, value]) => `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${value}`).join('\n')}\n`;
  }
}
