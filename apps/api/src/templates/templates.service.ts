import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type DbTemplate, type Page } from '@jotion/db';
import {
  appendPmContent,
  projectDoc,
  replaceTextVariables,
  type PmNode,
} from '@jotion/editor/projection';
import { dayInZone, zonedTime } from '@jotion/query';
import {
  createRowTemplateSchema,
  recurrenceSchema,
  setTemplateSchema,
  updateRowTemplateSchema,
  useTemplateSchema,
  type PageIcon,
  type Recurrence,
  type RowTemplateDto,
  type TemplateDto,
} from '@jotion/shared';
import * as Y from 'yjs';
import { AppError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { parse } from '../common/validation';
import { CollabService } from '../collab/collab.service';
import { DocStore } from '../collab/doc-store';
import { ComputeService } from '../databases/compute.service';
import { DatabaseAccessService } from '../databases/database-access';
import { DatabasesService } from '../databases/databases.service';
import { RowsService } from '../databases/rows.service';
import { PrismaService } from '../infra/prisma.service';
import { PagesService } from '../pages/pages.service';
import { PermissionService } from '../permissions/permission.service';
import { BLUEPRINTS, blueprint, type Blueprint, type Lang, type RowValue } from './builtin';
import { PageCopier } from './page-copier';

const DAY_MS = 86_400_000;

/** Nächster Zeitpunkt einer Wiederholung nach `after` (Ortszeit in timeZone). */
export function nextRecurrence(r: Recurrence, after: number, timeZone: string): number {
  const [hh, mm] = r.time.split(':').map(Number) as [number, number];
  let day = dayInZone(after, timeZone);
  for (let i = 0; i < 400; i++) {
    const ms = zonedTime(day, hh, mm, timeZone);
    const date = new Date(`${day}T12:00:00Z`);
    const weekday = ((date.getUTCDay() + 6) % 7) + 1;
    const ok =
      r.every === 'day' ||
      (r.every === 'week' && weekday === r.weekday) ||
      (r.every === 'month' && date.getUTCDate() === r.monthday);
    if (ok && ms > after) return ms;
    day = new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  }
  return after + DAY_MS;
}

/**
 * Phase 9: Vorlagen. Galerie aus mitgelieferten Bauplänen und eigenen Vorlagen-Seiten,
 * Anlegen aus Vorlage (Kopie mit Platzhaltern), Zeilen-Vorlagen je Datenbank mit Standard
 * und Wiederholung.
 */
@Injectable()
export class TemplatesService {
  private readonly logger = new Logger('Templates');

  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly pages: PagesService,
    private readonly databases: DatabasesService,
    private readonly rows: RowsService,
    private readonly access: DatabaseAccessService,
    private readonly copier: PageCopier,
    private readonly store: DocStore,
    private readonly collab: CollabService,
    private readonly compute: ComputeService,
  ) {}

  private lang(user: AuthUser): Lang {
    return user.locale === 'en' ? 'en' : 'de';
  }

  /** Platzhalter: @heute/@today (Datum), @ersteller/@creator (Name) */
  vars(user: AuthUser): Record<string, string> {
    const today = dayInZone(Date.now(), this.compute.timeZone);
    const date = new Date(`${today}T12:00:00Z`).toLocaleDateString(
      user.locale === 'en' ? 'en-GB' : 'de-DE',
      {
        timeZone: 'UTC',
      },
    );
    return { '@heute': date, '@today': date, '@ersteller': user.name, '@creator': user.name };
  }

  // ---------------------------------------------------------------- Galerie

  async gallery(user: AuthUser, workspaceId: string): Promise<TemplateDto[]> {
    await this.perms.requireMember(user.id, workspaceId);
    const l = this.lang(user);
    const own = await this.prisma.client.page.findMany({
      where: {
        workspaceId,
        isTemplate: true,
        deletedAt: null,
        kind: { in: ['PAGE', 'DATABASE'] },
        OR: [{ scope: 'TEAM' }, { ownerId: user.id }],
      },
      orderBy: { title: 'asc' },
    });
    return [
      ...BLUEPRINTS.map((b) => ({
        id: `builtin:${b.key}`,
        builtin: true,
        title: b.title[l],
        description: b.description[l],
        icon: { type: 'emoji' as const, value: b.icon },
        category: b.category,
        scope: null,
      })),
      ...own.map((p) => ({
        id: p.id,
        builtin: false,
        title: p.title,
        description: '',
        icon: (p.icon as PageIcon | null) ?? null,
        category: 'custom' as const,
        scope: p.scope,
      })),
    ];
  }

  async setTemplate(
    user: AuthUser,
    pageId: string,
    body: unknown,
  ): Promise<{ isTemplate: boolean }> {
    const input = parse(setTemplateSchema, body);
    const { page } = await this.perms.requireEditablePage(user.id, pageId);
    if (page.kind !== 'PAGE' && page.kind !== 'DATABASE')
      throw new AppError('bad_request', 'Nur Seiten und Datenbanken können Vorlagen sein');
    await this.prisma.client.page.update({
      where: { id: page.id },
      data: { isTemplate: input.isTemplate },
    });
    return { isTemplate: input.isTemplate };
  }

  /** Seite aus Vorlage anlegen. Liefert die neue Seite. */
  async use(user: AuthUser, workspaceId: string, body: unknown): Promise<{ id: string }> {
    const input = parse(useTemplateSchema, body);
    await this.perms.requireMember(user.id, workspaceId);
    let parent: Page | null = null;
    if (input.parentId) {
      parent = (await this.perms.requireEditablePage(user.id, input.parentId)).page;
      if (
        parent.workspaceId !== workspaceId ||
        (parent.kind !== 'PAGE' && parent.kind !== 'DATABASE')
      )
        throw notFound('Seite');
      if (parent.kind === 'DATABASE')
        throw new AppError('bad_request', 'In einer Datenbank können keine Seiten liegen');
    }
    const scope = parent ? parent.scope : (input.scope ?? 'PRIVATE');
    if (input.templateId.startsWith('builtin:')) {
      const b = blueprint(input.templateId.slice(8));
      if (!b) throw notFound('Vorlage');
      return this.instantiate(user, workspaceId, b, parent?.id ?? null, scope);
    }
    const { page: tpl } = await this.perms.requirePage(user.id, input.templateId);
    if (!tpl.isTemplate || tpl.workspaceId !== workspaceId) throw notFound('Vorlage');
    const res = await this.copier.copy(
      user,
      tpl.id,
      {
        workspaceId,
        parentId: parent?.id ?? null,
        scope,
        ownerId: parent ? parent.ownerId : user.id,
      },
      { title: tpl.title, vars: this.vars(user), isTemplate: false },
    );
    return { id: res.root.id };
  }

  // ---------------------------------------------------------------- Mitgelieferte Vorlagen

  private async instantiate(
    user: AuthUser,
    workspaceId: string,
    b: Blueprint,
    parentId: string | null,
    scope: 'PRIVATE' | 'TEAM',
  ): Promise<{ id: string }> {
    const l = this.lang(user);
    const root = await this.pages.create(user, workspaceId, {
      parentId,
      scope,
      title: b.title[l],
      icon: { type: 'emoji', value: b.icon },
      insertBlock: true,
    });
    const dbIds = new Map<string, string>();
    const today = dayInZone(Date.now(), this.compute.timeZone);
    const day = (n: number) =>
      new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

    for (const d of b.databases) {
      const db = await this.databases.create(user, workspaceId, {
        parentId: root.id,
        title: d.title[l],
        inline: true,
        insertBlock: false,
      });
      dbIds.set(d.ref, db.id);
      const titleProp = db.properties.find((p) => p.type === 'title')!;
      if (d.titleName)
        await this.databases.updateProperty(user, db.id, titleProp.id, { name: d.titleName[l] });
      // Standard-Spalte "Tags" wird nicht gebraucht
      for (const extra of db.properties.filter((p) => p.type !== 'title'))
        await this.databases.deleteProperty(user, db.id, extra.id);
      const propIds = new Map<string, string>();
      const options = new Map<string, Map<string, string>>();
      for (const p of d.properties) {
        let config: Record<string, unknown> | undefined = p.config;
        if (p.options) {
          const ids = new Map<string, string>();
          const opts = p.options.map((o) => {
            const id = randomUUID();
            ids.set(o.name.de, id);
            ids.set(o.name.en, id);
            return { id, name: o.name[l], color: o.color, ...(o.group ? { group: o.group } : {}) };
          });
          options.set(p.ref, ids);
          config = { ...(config ?? {}), options: opts };
        }
        const created = await this.databases.createProperty(user, db.id, {
          name: p.name[l],
          type: p.type,
          ...(config ? { config } : {}),
        });
        propIds.set(p.ref, created.id);
      }
      // Ansichten: die angelegte Tabelle wird zur ersten Ansicht des Bauplans
      const first = (await this.databases.get(user, db.id)).views[0]!;
      for (const [i, v] of d.views.entries()) {
        const config: Record<string, unknown> = {};
        if (v.groupBy) config.groupBy = { propertyId: propIds.get(v.groupBy) };
        if (v.sorts)
          config.sorts = v.sorts.map((s) => ({
            propertyId: propIds.get(s.ref),
            direction: s.direction,
          }));
        if (v.type === 'calendar' && v.date)
          config.calendar = { datePropertyId: propIds.get(v.date) };
        if (v.type === 'timeline' && v.date)
          config.timeline = { startPropertyId: propIds.get(v.date) };
        if (i === 0)
          await this.databases.updateView(user, db.id, first.id, {
            name: v.name[l],
            type: v.type,
            config,
          });
        else {
          const view = await this.databases.createView(user, db.id, {
            name: v.name[l],
            type: v.type,
          });
          if (Object.keys(config).length)
            await this.databases.updateView(user, db.id, view.id, { config });
        }
      }
      const props = await this.access.properties(db.id);
      for (const r of d.rows) {
        const values: Record<string, unknown> = {};
        for (const [ref, raw] of Object.entries(r.values ?? {})) {
          const pid = propIds.get(ref);
          const prop = props.find((p) => p.id === pid);
          if (!prop) continue;
          values[prop.id] = this.rowValue(prop.type, raw, options.get(ref), day, l);
        }
        await this.rows.create(user, db.id, { title: r.title[l], values, templateId: 'none' });
      }
    }

    // Unterseiten
    const children: { id: string }[] = [];
    for (const sub of b.pages ?? []) {
      const page = await this.pages.create(user, workspaceId, {
        parentId: root.id,
        title: sub.title[l],
        icon: { type: 'emoji', value: sub.icon },
        insertBlock: false,
      });
      await this.writeDoc(page.id, sub.content(l), this.vars(user));
      children.push({ id: page.id });
    }
    const content = this.resolveDbBlocks(b.content(l), dbIds);
    for (const c of children) content.push({ type: 'subpage', attrs: { pageId: c.id } });
    await this.writeDoc(root.id, content, this.vars(user));
    return { id: root.id };
  }

  private rowValue(
    type: string,
    raw: RowValue,
    options: Map<string, string> | undefined,
    day: (n: number) => string,
    l: Lang,
  ): unknown {
    if (raw === null) return null;
    if (typeof raw === 'object' && 'days' in raw) {
      return {
        start: day(raw.days),
        end: raw.endDays !== undefined ? day(raw.endDays) : null,
        hasTime: false,
        timeZone: null,
      };
    }
    const name = typeof raw === 'object' ? raw.de : raw;
    if (type === 'select' || type === 'status') return options?.get(String(name)) ?? null;
    if (type === 'multi_select') {
      const id = options?.get(String(name));
      return id ? [id] : [];
    }
    if (typeof raw === 'object') return raw[l];
    return raw;
  }

  /** Platzhalter "db:<ref>" in Datenbank-Blöcken durch die angelegten IDs ersetzen */
  private resolveDbBlocks(nodes: PmNode[], ids: Map<string, string>): PmNode[] {
    return nodes.map((n) => {
      const id = n.type === 'database' ? String(n.attrs?.databaseId ?? '') : '';
      const resolved = id.startsWith('db:')
        ? { ...n, attrs: { ...n.attrs, databaseId: ids.get(id.slice(3)) } }
        : n;
      return resolved.content
        ? { ...resolved, content: this.resolveDbBlocks(resolved.content, ids) }
        : resolved;
    });
  }

  /** Inhalt einer neuen Seite schreiben (vor dem ersten Öffnen im Editor). */
  private async writeDoc(pageId: string, nodes: PmNode[], vars: Record<string, string>) {
    const doc = await this.store.loadDoc(pageId);
    appendPmContent(doc, nodes, () => randomUUID());
    replaceTextVariables(doc, vars);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    await this.prisma.client.$transaction(async (tx) => {
      await tx.pageDoc.upsert({
        where: { pageId },
        create: { pageId, state },
        update: { state, version: { increment: 1 } },
      });
      await tx.pageDocUpdate.deleteMany({ where: { pageId } });
      await this.store.writeProjection(tx, pageId, projectDoc(doc));
    });
    doc.destroy();
    this.collab.revalidate();
  }

  // ---------------------------------------------------------------- Zeilen-Vorlagen

  private dto(p: Page, t: DbTemplate): RowTemplateDto {
    const rec = t.recurrence ? recurrenceSchema.safeParse(t.recurrence) : null;
    return {
      id: p.id,
      title: p.title,
      icon: (p.icon as PageIcon | null) ?? null,
      isDefault: t.isDefault,
      recurrence: rec?.success ? rec.data : null,
      nextRunAt: t.nextRunAt?.toISOString() ?? null,
    };
  }

  async rowTemplates(user: AuthUser, databaseId: string): Promise<RowTemplateDto[]> {
    const a = await this.access.requireData(user.id, databaseId);
    const tpls = await this.prisma.client.dbTemplate.findMany({
      where: { databaseId: a.data.db.id },
    });
    const pages = await this.prisma.client.page.findMany({
      where: { id: { in: tpls.map((t) => t.pageId) }, deletedAt: null },
      orderBy: [{ position: 'asc' }],
    });
    return pages.map((p) =>
      this.dto(
        p,
        tpls.find((t) => t.pageId === p.id)!,
      ),
    );
  }

  async createRowTemplate(
    user: AuthUser,
    databaseId: string,
    body: unknown,
  ): Promise<RowTemplateDto> {
    const input = parse(createRowTemplateSchema, body);
    const a = await this.access.requireData(user.id, databaseId);
    const data = a.data;
    let pageId: string;
    if (input.fromRowId) {
      const row = await this.prisma.client.page.findUnique({ where: { id: input.fromRowId } });
      if (!row || row.databaseId !== data.db.id || row.deletedAt) throw notFound('Zeile');
      const copy = await this.copier.copy(
        user,
        row.id,
        {
          workspaceId: data.page.workspaceId,
          parentId: data.db.id,
          scope: data.page.scope,
          ownerId: data.page.ownerId,
        },
        {
          rootKind: 'ROW_TEMPLATE',
          insertBlock: false,
          event: false,
          ...(input.title ? { title: input.title } : {}),
        },
      );
      pageId = copy.root.id;
    } else {
      const last = await this.prisma.client.page.findFirst({
        where: { parentId: data.db.id, kind: 'ROW_TEMPLATE' },
        orderBy: { position: 'desc' },
      });
      const page = await this.prisma.client.page.create({
        data: {
          workspaceId: data.page.workspaceId,
          parentId: data.db.id,
          kind: 'ROW_TEMPLATE',
          position: `${last?.position ?? 'a0'}V`,
          title: input.title,
          ownerId: data.page.ownerId,
          scope: data.page.scope,
          createdById: user.id,
          lastEditedById: user.id,
        },
      });
      pageId = page.id;
    }
    const t = await this.prisma.client.dbTemplate.create({
      data: { pageId, databaseId: data.db.id },
    });
    await this.dbChanged(data.page, user.id);
    return this.dto((await this.prisma.client.page.findUnique({ where: { id: pageId } }))!, t);
  }

  async updateRowTemplate(
    user: AuthUser,
    databaseId: string,
    templateId: string,
    body: unknown,
  ): Promise<RowTemplateDto> {
    const input = parse(updateRowTemplateSchema, body);
    const a = await this.access.requireData(user.id, databaseId);
    const t = await this.prisma.client.dbTemplate.findUnique({ where: { pageId: templateId } });
    if (!t || t.databaseId !== a.data.db.id) throw notFound('Vorlage');
    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (input.isDefault)
        await tx.dbTemplate.updateMany({
          where: { databaseId: t.databaseId, isDefault: true },
          data: { isDefault: false },
        });
      return tx.dbTemplate.update({
        where: { pageId: t.pageId },
        data: {
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.recurrence !== undefined
            ? {
                recurrence: input.recurrence ?? Prisma.DbNull,
                nextRunAt: input.recurrence
                  ? new Date(nextRecurrence(input.recurrence, Date.now(), this.compute.timeZone))
                  : null,
              }
            : {}),
        },
      });
    });
    // Wiederholung läuft im Namen dessen, der sie eingestellt hat
    if (input.recurrence)
      await this.prisma.client.page.update({
        where: { id: t.pageId },
        data: { lastEditedById: user.id },
      });
    await this.dbChanged(a.data.page, user.id);
    return this.dto(
      (await this.prisma.client.page.findUnique({ where: { id: t.pageId } }))!,
      updated,
    );
  }

  async deleteRowTemplate(user: AuthUser, databaseId: string, templateId: string): Promise<void> {
    const a = await this.access.requireData(user.id, databaseId);
    const t = await this.prisma.client.dbTemplate.findUnique({ where: { pageId: templateId } });
    if (!t || t.databaseId !== a.data.db.id) throw notFound('Vorlage');
    await this.prisma.client.$transaction(async (tx) => {
      await tx.dbTemplate.delete({ where: { pageId: t.pageId } });
      await tx.page.update({
        where: { id: t.pageId },
        data: { deletedAt: new Date(), deletedById: user.id, trashRootId: t.pageId },
      });
    });
    await this.dbChanged(a.data.page, user.id);
  }

  private async dbChanged(page: Page, actorId: string) {
    await this.prisma.client.$transaction((tx) =>
      this.access.event(tx, page, 'database.changed', actorId, {}),
    );
  }

  /** Fällige wiederkehrende Vorlagen ausführen (Zeitplan, jede Minute). Liefert angelegte Zeilen. */
  async runDueRecurring(now = Date.now()): Promise<number> {
    const due = await this.prisma.client.dbTemplate.findMany({
      where: { nextRunAt: { lte: new Date(now) }, recurrence: { not: Prisma.DbNull } },
      take: 50,
    });
    let created = 0;
    for (const t of due) {
      const rec = recurrenceSchema.safeParse(t.recurrence);
      // Zuerst weiterschalten: ein Fehler darf keine Endlosschleife auslösen
      await this.prisma.client.dbTemplate.update({
        where: { pageId: t.pageId },
        data: {
          lastRunAt: new Date(now),
          nextRunAt: rec.success
            ? new Date(nextRecurrence(rec.data, now, this.compute.timeZone))
            : null,
        },
      });
      if (!rec.success) continue;
      try {
        const page = await this.prisma.client.page.findUnique({ where: { id: t.pageId } });
        if (!page || page.deletedAt) continue;
        const user = await this.actor(page.lastEditedById);
        if (!user) continue;
        await this.rows.create(user, t.databaseId, { templateId: t.pageId });
        created++;
      } catch (err) {
        this.logger.warn(`Wiederkehrende Vorlage ${t.pageId}: ${(err as Error).message}`);
      }
    }
    return created;
  }

  /** Nutzer als Akteur für Hintergrundaufgaben */
  async actor(userId: string): Promise<AuthUser | null> {
    const u = await this.prisma.client.user.findUnique({ where: { id: userId } });
    return u
      ? { id: u.id, email: u.email, name: u.name, locale: u.locale, sessionId: 'system' }
      : null;
  }
}
