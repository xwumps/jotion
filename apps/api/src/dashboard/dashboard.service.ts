import { Injectable } from '@nestjs/common';
import type { Prisma } from '@jotion/db';
import {
  dashboardSchema,
  dateValueMs,
  defaultWidgets,
  parsePropertyConfig,
  type AgendaDto,
  type AgendaItemDto,
  type DashboardDto,
  type DashboardScope,
  type DateValue,
  type PageIcon,
  type StatusConfig,
} from '@jotion/shared';
import { addDays, dayInZone, safeTimeZone, valueDay } from '@jotion/query';
import { forbidden } from '../common/errors';
import { parse } from '../common/validation';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../permissions/permission.service';

const keyOf = (scope: DashboardScope, userId: string) =>
  scope === 'shared' ? 'shared' : `user:${userId}`;
/** Checkbox-Properties mit diesen Namen gelten als "erledigt" */
const DONE_NAME = /^(erledigt|fertig|abgeschlossen|done|completed?)$/i;

/**
 * Dashboard je Nutzer oder geteilt im Workspace (nur Owner bearbeiten das geteilte) und die
 * Agenda: anstehende und überfällige Einträge aus allen sichtbaren Datenbanken mit Datum.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
  ) {}

  async get(user: AuthUser, workspaceId: string, scope: DashboardScope): Promise<DashboardDto> {
    const role = await this.perms.requireMember(user.id, workspaceId);
    const row = await this.prisma.client.dashboard.findUnique({
      where: { workspaceId_key: { workspaceId, key: keyOf(scope, user.id) } },
    });
    let widgets = defaultWidgets();
    if (row) {
      const parsed = dashboardSchema.safeParse(row.config);
      widgets = parsed.success ? parsed.data.widgets : widgets;
    }
    return {
      scope,
      widgets,
      canEdit: scope === 'personal' || role === 'OWNER',
      isDefault: !row,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async save(
    user: AuthUser,
    workspaceId: string,
    scope: DashboardScope,
    input: unknown,
  ): Promise<DashboardDto> {
    const role = await this.perms.requireMember(user.id, workspaceId);
    if (scope === 'shared' && role !== 'OWNER')
      throw forbidden('Nur Owner bearbeiten das geteilte Dashboard');
    const config = parse(dashboardSchema, input);
    // Doppelte Widget-IDs vermeiden (Raster-Layout braucht eindeutige Schlüssel)
    const seen = new Set<string>();
    config.widgets = config.widgets.filter((w) => !seen.has(w.id) && seen.add(w.id));
    await this.prisma.client.dashboard.upsert({
      where: { workspaceId_key: { workspaceId, key: keyOf(scope, user.id) } },
      create: {
        workspaceId,
        key: keyOf(scope, user.id),
        config: config as Prisma.InputJsonValue,
        updatedById: user.id,
      },
      update: { config: config as Prisma.InputJsonValue, updatedById: user.id },
    });
    return this.get(user, workspaceId, scope);
  }

  /** Anstehend (heute bis heute + days) und überfällig (vor heute, nicht erledigt, letztes Jahr). */
  async agenda(
    user: AuthUser,
    workspaceId: string,
    days: number,
    tzInput?: string,
  ): Promise<AgendaDto> {
    await this.perms.requireMember(user.id, workspaceId);
    const tz = safeTimeZone(tzInput);
    const today = dayInZone(Date.now(), tz);
    const until = addDays(today, Math.min(90, Math.max(1, days)));
    // Großzügiges Zeitfenster in UTC, genaue Tage danach in der Zeitzone
    const from = new Date(Date.parse(`${addDays(today, -366)}T00:00:00Z`) - 86_400_000);
    const to = new Date(Date.parse(`${until}T00:00:00Z`) + 2 * 86_400_000);
    const rows = await this.prisma.client.$queryRaw<
      {
        row_id: string;
        title: string;
        icon: PageIcon | null;
        database_id: string;
        database_title: string;
        property_name: string;
        start: Date;
        end: Date | null;
        has_time: boolean | null;
      }[]
    >`
      SELECT p.id::text AS row_id, p.title, p.icon, d.id::text AS database_id, d.title AS database_title,
             dp.name AS property_name, v.v_date_start AS start, v.v_date_end AS "end", v.v_date_has_time AS has_time
        FROM property_values v
        JOIN db_properties dp ON dp.id = v.property_id AND dp.type = 'date'
        JOIN pages p ON p.id = v.row_id AND p.deleted_at IS NULL AND p.archived_at IS NULL
        JOIN pages d ON d.id = p.database_id AND d.deleted_at IS NULL
       WHERE p.workspace_id = ${workspaceId}::uuid AND p.kind = 'DATABASE_ROW'
         AND ${PermissionService.visibleSql(user.id)}
         AND v.v_date_start < ${to} AND COALESCE(v.v_date_end, v.v_date_start) >= ${from}
       ORDER BY v.v_date_start
       LIMIT 2000`;
    const done = await this.doneRows(rows.map((r) => r.row_id));
    const toItem = (r: (typeof rows)[number]): AgendaItemDto & { endDay: string } => {
      const hasTime = Boolean(r.has_time);
      const fmt = (d: Date) => (hasTime ? d.toISOString() : d.toISOString().slice(0, 10));
      const date: DateValue = {
        start: fmt(r.start),
        end: r.end ? fmt(r.end) : null,
        hasTime,
        timeZone: null,
      };
      const day = valueDay(dateValueMs(date.start, hasTime), hasTime, tz);
      const endDay = date.end ? valueDay(dateValueMs(date.end, hasTime), hasTime, tz) : day;
      return {
        rowId: r.row_id,
        title: r.title,
        icon: r.icon,
        databaseId: r.database_id,
        databaseTitle: r.database_title,
        propertyName: r.property_name,
        date,
        day,
        endDay,
      };
    };
    const items = rows.map(toItem);
    const strip = ({ endDay: _e, ...rest }: AgendaItemDto & { endDay: string }): AgendaItemDto =>
      rest;
    const upcoming = items
      .filter((i) => i.endDay >= today && i.day <= until)
      .sort((a, b) => a.day.localeCompare(b.day) || a.date.start.localeCompare(b.date.start))
      .slice(0, 100)
      .map(strip);
    const overdue = items
      .filter((i) => i.endDay < today && !done.has(i.rowId))
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, 100)
      .map(strip);
    return { upcoming, overdue };
  }

  /** Erledigte Zeilen: Status in der Gruppe "Erledigt" oder angehakte Checkbox "Erledigt"/"Done". */
  private async doneRows(rowIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (!rowIds.length) return out;
    const values = await this.prisma.client.$queryRaw<
      {
        row_id: string;
        type: string;
        name: string;
        config: unknown;
        option_id: string | null;
        v_bool: boolean | null;
      }[]
    >`
      SELECT v.row_id::text, dp.type::text AS type, dp.name, dp.config, (v.v_option_ids)[1]::text AS option_id, v.v_bool
        FROM property_values v JOIN db_properties dp ON dp.id = v.property_id
       WHERE v.row_id = ANY(${rowIds}::uuid[]) AND dp.type IN ('status', 'checkbox')`;
    for (const v of values) {
      if (v.type === 'checkbox' && v.v_bool && DONE_NAME.test(v.name.trim())) out.add(v.row_id);
      if (v.type === 'status' && v.option_id) {
        try {
          const cfg = parsePropertyConfig('status', v.config) as StatusConfig;
          if (cfg.options.find((o) => o.id === v.option_id)?.group === 'complete')
            out.add(v.row_id);
        } catch {
          /* ungültige Konfiguration ignorieren */
        }
      }
    }
    return out;
  }
}
