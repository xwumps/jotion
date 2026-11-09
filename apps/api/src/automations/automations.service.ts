import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Automation, type AutomationRun } from '@jotion/db';
import { SecretBox } from '@jotion/integrations';
import {
  actionSchema,
  automationInputSchema,
  filterSchema,
  parsePropertyConfig,
  triggerSchema,
  updateAutomationSchema,
  type AutomationAction,
  type AutomationDto,
  type AutomationRunDto,
  type AutomationTrigger,
  type PermissionLevel,
} from '@jotion/shared';
import type { ServerEnv } from '@jotion/shared/env';
import { AppError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { parse } from '../common/validation';
import { SERVER_ENV } from '../config/config.module';
import { ComputeService } from '../databases/compute.service';
import { DatabaseAccessService } from '../databases/database-access';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../permissions/permission.service';
import {
  AutomationEngine,
  nextTriggerRun,
  secretContext,
  type RunResult,
} from './automation-engine';

/**
 * Phase 9: Automatisierungen verwalten. Sichtbar und bearbeitbar für alle mit Zugriff auf die
 * Datenbank (Automatisierungen ohne Datenbank: alle Mitglieder des Workspace). Ausgeführt wird
 * als Ersteller.
 */
@Injectable()
export class AutomationsService {
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly access: DatabaseAccessService,
    private readonly compute: ComputeService,
    private readonly engine: AutomationEngine,
    @Inject(SERVER_ENV) env: ServerEnv,
  ) {
    this.box = new SecretBox(env.JOTION_MASTER_KEY, env.JOTION_MASTER_KEY_PREVIOUS);
  }

  private async toDtos(list: Automation[]): Promise<AutomationDto[]> {
    if (!list.length) return [];
    const [users, last] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { id: { in: [...new Set(list.map((a) => a.createdById))] } },
        select: { id: true, name: true },
      }),
      this.prisma.client.$queryRaw<AutomationRun[]>`
        SELECT DISTINCT ON (automation_id) id, automation_id AS "automationId", event_key AS "eventKey", status,
               chain_depth AS "chainDepth", row_id AS "rowId", actor_id AS "actorId", details, error,
               started_at AS "startedAt", finished_at AS "finishedAt"
          FROM automation_runs WHERE automation_id = ANY(${list.map((a) => a.id)}::uuid[])
         ORDER BY automation_id, started_at DESC`,
    ]);
    const runs = await this.runDtos(last);
    return list.map((a) => ({
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      databaseId: a.databaseId,
      trigger: triggerSchema.parse(a.trigger),
      conditions: a.conditions ? (filterSchema.safeParse(a.conditions).data ?? null) : null,
      actions: (a.actions as unknown[]).map((x) => actionSchema.parse(x)),
      createdBy: { id: a.createdById, name: users.find((u) => u.id === a.createdById)?.name ?? '' },
      webhookSecret: a.secret ? this.box.decrypt(a.secret, secretContext(a.id)) : null,
      lastRunAt: a.lastRunAt?.toISOString() ?? null,
      nextRunAt: a.nextRunAt?.toISOString() ?? null,
      lastRun: runs.find((r) => last.find((l) => l.id === r.id)?.automationId === a.id) ?? null,
    }));
  }

  private async runDtos(runs: AutomationRun[]): Promise<AutomationRunDto[]> {
    const rowIds = runs.map((r) => r.rowId).filter((x): x is string => !!x);
    const actorIds = runs.map((r) => r.actorId).filter((x): x is string => !!x);
    const [rows, users] = await Promise.all([
      this.prisma.client.page.findMany({
        where: { id: { in: rowIds } },
        select: { id: true, title: true },
      }),
      this.prisma.client.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true },
      }),
    ]);
    return runs.map((r) => ({
      id: r.id,
      status: r.status as AutomationRunDto['status'],
      chainDepth: r.chainDepth,
      rowId: r.rowId,
      rowTitle: rows.find((x) => x.id === r.rowId)?.title ?? null,
      actorName: users.find((u) => u.id === r.actorId)?.name ?? null,
      details: (r.details as AutomationRunDto['details']) ?? [],
      error: r.error,
      startedAt: new Date(r.startedAt).toISOString(),
      finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
    }));
  }

  /** Zugriff: Datenbank (falls gesetzt) oder Mitgliedschaft im Workspace */
  private async requireAutomation(
    user: AuthUser,
    id: string,
    level: PermissionLevel = 'view',
  ): Promise<Automation> {
    const a = await this.prisma.client.automation.findUnique({ where: { id } });
    if (!a) throw notFound('Automatisierung');
    await this.perms.requireMember(user.id, a.workspaceId).catch(() => {
      throw notFound('Automatisierung');
    });
    if (a.databaseId) await this.access.requireData(user.id, a.databaseId, { level });
    return a;
  }

  async list(user: AuthUser, workspaceId: string, databaseId?: string): Promise<AutomationDto[]> {
    await this.perms.requireMember(user.id, workspaceId);
    if (databaseId) {
      const d = await this.access.requireData(user.id, databaseId);
      if (d.page.workspaceId !== workspaceId) throw notFound('Datenbank');
      const list = await this.prisma.client.automation.findMany({
        where: { databaseId: d.data.db.id },
        orderBy: { createdAt: 'asc' },
      });
      return this.toDtos(list);
    }
    // Ohne Datenbank: Automatisierungen ohne Datenbank (Button-Blöcke, Zeitpläne)
    const list = await this.prisma.client.automation.findMany({
      where: { workspaceId, databaseId: null },
      orderBy: { createdAt: 'asc' },
    });
    return this.toDtos(list);
  }

  async get(user: AuthUser, id: string): Promise<AutomationDto> {
    return (await this.toDtos([await this.requireAutomation(user, id)]))[0]!;
  }

  /** Verweise prüfen: Properties der Datenbank, Zieldatenbanken mit Zugriff */
  private async validate(
    user: AuthUser,
    workspaceId: string,
    databaseId: string | null,
    trigger: AutomationTrigger,
    actions: AutomationAction[],
  ) {
    const props = databaseId ? await this.access.properties(databaseId) : [];
    const has = (pid: string) => pid === 'title' || props.some((p) => p.id === pid);
    if (
      (trigger.type === 'property_changed' || trigger.type === 'date_reached') &&
      !has(trigger.propertyId)
    )
      throw new AppError('validation_failed', 'Property des Auslösers gehört nicht zur Datenbank');
    if (
      trigger.type === 'date_reached' &&
      props.find((p) => p.id === trigger.propertyId)?.type !== 'date'
    )
      throw new AppError('validation_failed', 'Der Auslöser braucht ein Datums-Property');
    if (
      trigger.type === 'button' &&
      trigger.propertyId &&
      props.find((p) => p.id === trigger.propertyId)?.type !== 'button'
    )
      throw new AppError('validation_failed', 'Der Auslöser braucht ein Button-Property');
    for (const a of actions) {
      if (a.type === 'set_property') {
        if (!databaseId)
          throw new AppError('validation_failed', '"Property setzen" braucht eine Datenbank');
        if (a.target.kind === 'trigger' && !has(a.propertyId))
          throw new AppError('validation_failed', 'Property der Aktion gehört nicht zur Datenbank');
        if (a.target.kind === 'related') {
          const rel = props.find(
            (p) => p.id === (a.target as { relationPropertyId: string }).relationPropertyId,
          );
          if (rel?.type !== 'relation')
            throw new AppError('validation_failed', 'Relation der Aktion nicht gefunden');
        }
      }
      if (a.type === 'telegram') {
        // Phase 11: nur eigene Bot-Verbindungen dieses Workspace
        const c = await this.prisma.client.integrationConnection.findUnique({
          where: { id: a.connectionId },
        });
        if (!c || c.type !== 'telegram' || c.ownerId !== user.id || c.workspaceId !== workspaceId)
          throw new AppError('validation_failed', 'Telegram-Verbindung nicht gefunden');
      }
      if (a.type === 'create_row') {
        const d = await this.access.requireData(user.id, a.databaseId, { level: 'edit' });
        if (d.page.workspaceId !== workspaceId) throw notFound('Datenbank');
        if (a.templateId) {
          const t = await this.prisma.client.dbTemplate.findUnique({
            where: { pageId: a.templateId },
          });
          if (t?.databaseId !== d.data.db.id)
            throw new AppError('validation_failed', 'Vorlage gehört nicht zur Zieldatenbank');
        }
      }
    }
  }

  async create(user: AuthUser, workspaceId: string, body: unknown): Promise<AutomationDto> {
    await this.perms.requireMember(user.id, workspaceId);
    const input = parse(automationInputSchema, body);
    let databaseId: string | null = null;
    if (input.databaseId) {
      const d = await this.access.requireData(user.id, input.databaseId, { level: 'edit' });
      if (d.page.workspaceId !== workspaceId) throw notFound('Datenbank');
      databaseId = d.data.db.id;
    }
    await this.validate(user, workspaceId, databaseId, input.trigger, input.actions);
    const id = randomUUID();
    const next = nextTriggerRun(input.trigger, Date.now(), this.compute.timeZone);
    const a = await this.prisma.client.automation.create({
      data: {
        id,
        workspaceId,
        databaseId,
        name: input.name,
        enabled: input.enabled,
        trigger: input.trigger as Prisma.InputJsonValue,
        conditions: input.conditions
          ? (input.conditions as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        actions: input.actions as Prisma.InputJsonValue,
        createdById: user.id,
        secret: input.actions.some((x) => x.type === 'webhook')
          ? this.box.encrypt(randomBytes(24).toString('hex'), secretContext(id))
          : null,
        nextRunAt: next ? new Date(next) : null,
      },
    });
    await this.linkButton(a);
    return (await this.toDtos([a]))[0]!;
  }

  async update(user: AuthUser, id: string, body: unknown): Promise<AutomationDto> {
    const a = await this.requireAutomation(user, id, 'edit');
    const input = parse(updateAutomationSchema, body);
    const trigger = input.trigger ?? triggerSchema.parse(a.trigger);
    const actions = input.actions ?? (a.actions as unknown[]).map((x) => actionSchema.parse(x));
    if (!a.databaseId && ['row_created', 'property_changed', 'date_reached'].includes(trigger.type))
      throw new AppError('validation_failed', 'Dieser Auslöser braucht eine Datenbank');
    await this.validate(user, a.workspaceId, a.databaseId, trigger, actions);
    const next = nextTriggerRun(trigger, Date.now(), this.compute.timeZone);
    const updated = await this.prisma.client.automation.update({
      where: { id: a.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.conditions !== undefined
          ? {
              conditions: input.conditions
                ? (input.conditions as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
            }
          : {}),
        trigger: trigger as Prisma.InputJsonValue,
        actions: actions as Prisma.InputJsonValue,
        nextRunAt: next ? new Date(next) : null,
        ...(!a.secret && actions.some((x) => x.type === 'webhook')
          ? { secret: this.box.encrypt(randomBytes(24).toString('hex'), secretContext(a.id)) }
          : {}),
      },
    });
    await this.linkButton(updated);
    return (await this.toDtos([updated]))[0]!;
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const a = await this.requireAutomation(user, id, 'edit');
    await this.prisma.client.automation.delete({ where: { id: a.id } });
  }

  async runs(user: AuthUser, id: string): Promise<AutomationRunDto[]> {
    const a = await this.requireAutomation(user, id);
    const runs = await this.prisma.client.automationRun.findMany({
      where: { automationId: a.id },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return this.runDtos(runs);
  }

  /** Button-Property zeigt auf seine Automatisierung (für den Klick in der Zeile) */
  private async linkButton(a: Automation) {
    const t = triggerSchema.parse(a.trigger);
    if (t.type !== 'button' || !t.propertyId) return;
    const prop = await this.prisma.client.dbProperty.findUnique({ where: { id: t.propertyId } });
    if (!prop || prop.type !== 'button') return;
    const cfg = parsePropertyConfig('button', prop.config) as {
      label: string;
      automationId: string | null;
    };
    if (cfg.automationId === a.id) return;
    await this.prisma.client.dbProperty.update({
      where: { id: prop.id },
      data: { config: { ...cfg, automationId: a.id } },
    });
  }

  // ---------------------------------------------------------------- Buttons

  /** Button in einer Zeile geklickt */
  async clickRowButton(
    user: AuthUser,
    databaseId: string,
    rowId: string,
    propertyId: string,
  ): Promise<{ queued: boolean; status: RunResult['status'] | null }> {
    const d = await this.access.requireData(user.id, databaseId, { level: 'edit' });
    const prop = (await this.access.properties(d.data.db.id)).find((p) => p.id === propertyId);
    if (!prop || prop.type !== 'button') throw notFound('Button');
    const automationId = (prop.config as { automationId: string | null }).automationId;
    if (!automationId)
      throw new AppError('bad_request', 'Diesem Button ist keine Automatisierung zugeordnet');
    const row = await this.prisma.client.page.findUnique({ where: { id: rowId } });
    if (!row || row.databaseId !== d.data.db.id || row.deletedAt) throw notFound('Zeile');
    return this.fire(automationId, rowId, user.id);
  }

  /** Button-Block geklickt (Automatisierung ohne Zeile) */
  async clickBlockButton(
    user: AuthUser,
    id: string,
  ): Promise<{ queued: boolean; status: RunResult['status'] | null }> {
    const a = await this.requireAutomation(user, id, 'edit');
    const t = triggerSchema.parse(a.trigger);
    if (t.type !== 'button' || t.propertyId)
      throw new AppError('bad_request', 'Diese Automatisierung ist kein Button');
    return this.fire(a.id, null, user.id);
  }

  private async fire(automationId: string, rowId: string | null, actorId: string) {
    const res = await this.engine.dispatch({
      automationId,
      eventKey: `button:${randomUUID()}`,
      rowId,
      actorId,
      depth: 0,
    });
    return { queued: res === null, status: res?.status ?? null };
  }
}
