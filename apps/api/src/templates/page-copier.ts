import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type Page, type PageScope } from '@jotion/db';
import { projectDoc, remapDocIds, replaceTextVariables } from '@jotion/editor/projection';
import { PAGE_TITLE_MAX } from '@jotion/shared';
import * as Y from 'yjs';
import { AppError } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { DocStore } from '../collab/doc-store';
import { CollabService } from '../collab/collab.service';
import { ComputeService } from '../databases/compute.service';
import { recordEvent } from '../events/outbox';
import { PrismaService } from '../infra/prisma.service';
import { computePosition } from '../pages/positions';

/** Höchstzahl Seiten (inklusive Datenbankzeilen) je Kopie */
export const MAX_COPY_PAGES = 5000;

export interface CopyTarget {
  workspaceId: string;
  parentId: string | null;
  scope: PageScope;
  ownerId: string;
  /** Position: hinter dieser Seite, sonst am Ende */
  afterId?: string | null;
}

export interface CopyOptions {
  title?: string;
  /** Platzhalter im Text, z. B. { '@heute': '8.11.2026' } */
  vars?: Record<string, string>;
  /** Kopie ist selbst eine Vorlage */
  isTemplate?: boolean;
  /** Unterseiten-Block in der Elternseite anlegen */
  insertBlock?: boolean;
  /** Art der Wurzel-Kopie (z. B. Zeile aus einer Zeilen-Vorlage) */
  rootKind?: 'DATABASE_ROW' | 'ROW_TEMPLATE';
  /** Ereignis page.created schreiben (Zeilen melden ihr Ereignis selbst) */
  event?: boolean;
}

export interface CopyResult {
  root: Page;
  idMap: Map<string, string>;
  databases: string[];
  pages: number;
}

/** Alle bekannten IDs in einem JSON-Wert ersetzen (Property-, Ansichts- und Seiten-IDs). */
export function remapJson<T>(value: T, idMap: Map<string, string>): T {
  if (value === null || value === undefined) return value;
  const s = JSON.stringify(value).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    (m) => idMap.get(m.toLowerCase()) ?? m,
  );
  return JSON.parse(s) as T;
}

/**
 * Phase 9: Seitenbaum kopieren, auch mit Datenbanken (Schema, Ansichten, Zeilen, Werte,
 * Relationen, Zeilen-Vorlagen). Alle Verweise innerhalb der Kopie zeigen auf die Kopien;
 * Relationen zu Datenbanken außerhalb bleiben bestehen. Grundlage für Duplizieren und Vorlagen.
 */
@Injectable()
export class PageCopier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: DocStore,
    private readonly collab: CollabService,
    private readonly compute: ComputeService,
  ) {}

  async copy(
    user: AuthUser,
    rootId: string,
    target: CopyTarget,
    opts: CopyOptions = {},
  ): Promise<CopyResult> {
    const db = this.prisma.client;
    const tree = await db.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM pages
       WHERE path <@ (SELECT path FROM pages WHERE id = ${rootId}::uuid) AND deleted_at IS NULL
       ORDER BY nlevel(path), position, id
       LIMIT ${MAX_COPY_PAGES + 1}`;
    if (tree.length > MAX_COPY_PAGES)
      throw new AppError(
        'bad_request',
        `Höchstens ${MAX_COPY_PAGES} Seiten können auf einmal kopiert werden`,
      );
    const pages = await db.page.findMany({ where: { id: { in: tree.map((t) => t.id) } } });
    const byId = new Map(pages.map((p) => [p.id, p]));
    const ordered = tree.map((t) => byId.get(t.id)!).filter(Boolean);
    const pageIds = ordered.map((p) => p.id);
    const dbIds = ordered.filter((p) => p.kind === 'DATABASE').map((p) => p.id);

    const [databases, props, views, rowOrder, templates] = await Promise.all([
      db.database.findMany({ where: { id: { in: dbIds } } }),
      db.dbProperty.findMany({ where: { databaseId: { in: dbIds } } }),
      db.dbView.findMany({ where: { databaseId: { in: dbIds } } }),
      db.dbViewRowOrder.findMany({ where: { view: { databaseId: { in: dbIds } } } }),
      db.dbTemplate.findMany({ where: { pageId: { in: pageIds } } }),
    ]);
    // Inhalte (Zeilen haben meist keinen; nur vorhandene laden)
    const withDoc = new Set(
      (
        await db.pageDoc.findMany({ where: { pageId: { in: pageIds } }, select: { pageId: true } })
      ).map((d) => d.pageId),
    );
    const withUpdates = await db.$queryRaw<{ page_id: string }[]>`
      SELECT DISTINCT page_id::text FROM page_doc_updates WHERE page_id = ANY(${pageIds}::uuid[])`;
    for (const u of withUpdates) withDoc.add(u.page_id);
    const docs = new Map<string, Y.Doc>();
    for (const id of withDoc) docs.set(id, await this.store.loadDoc(id));

    // Neue IDs für Seiten, Properties, Ansichten
    const idMap = new Map<string, string>();
    for (const p of ordered) idMap.set(p.id, randomUUID());
    for (const p of props) idMap.set(p.id, randomUUID());
    for (const v of views) idMap.set(v.id, randomUUID());
    const root = ordered[0];
    if (!root || root.id !== rootId) throw new AppError('not_found', 'Seite nicht gefunden');

    const created = await db.$transaction(
      async (tx) => {
        let rootCopy: Page | null = null;
        for (const src of ordered) {
          const isRoot = src.id === rootId;
          const newId = idMap.get(src.id)!;
          const parentId = isRoot ? target.parentId : (idMap.get(src.parentId ?? '') ?? null);
          if (!isRoot && !parentId) continue;
          const position = isRoot
            ? await computePosition(
                tx,
                {
                  workspaceId: target.workspaceId,
                  parentId: target.parentId,
                  scope: target.scope,
                  ownerId: target.ownerId,
                },
                { afterId: target.afterId ?? null },
              )
            : src.position;
          const page = await tx.page.create({
            data: {
              id: newId,
              workspaceId: target.workspaceId,
              parentId,
              position,
              kind: isRoot && opts.rootKind ? opts.rootKind : src.kind,
              databaseId:
                isRoot && opts.rootKind
                  ? opts.rootKind === 'DATABASE_ROW'
                    ? target.parentId
                    : null
                  : src.databaseId
                    ? (idMap.get(src.databaseId) ?? null)
                    : null,
              title:
                isRoot && opts.title !== undefined
                  ? opts.title.slice(0, PAGE_TITLE_MAX)
                  : this.vars(src.title, opts.vars),
              icon: (src.icon as Prisma.InputJsonValue | null) ?? undefined,
              cover: (src.cover as Prisma.InputJsonValue | null) ?? undefined,
              settings: remapJson((src.settings as Prisma.InputJsonValue) ?? {}, idMap),
              // Bereich und Owner der Wurzel; Unterseiten übernehmen sie per Trigger
              scope: target.scope,
              ownerId: target.ownerId,
              isTemplate: isRoot ? Boolean(opts.isTemplate) : src.isTemplate,
              archivedAt: isRoot ? null : src.archivedAt,
              createdById: user.id,
              lastEditedById: user.id,
            },
          });
          if (isRoot) rootCopy = page;
          // Datenbank direkt nach ihrer Seite: Zeilen verweisen per Fremdschlüssel darauf
          const d = src.kind === 'DATABASE' ? databases.find((x) => x.id === src.id) : undefined;
          if (d)
            await tx.database.create({
              data: {
                id: newId,
                workspaceId: target.workspaceId,
                isInline: d.isInline,
                locked: d.locked,
                sourceDatabaseId: d.sourceDatabaseId
                  ? (idMap.get(d.sourceDatabaseId) ?? d.sourceDatabaseId)
                  : null,
              },
            });
        }

        // Datenbanken: Schema, Ansichten (IDs in Konfigurationen umgeschrieben)
        if (props.length)
          await tx.dbProperty.createMany({
            data: props.map((p) => ({
              id: idMap.get(p.id)!,
              databaseId: idMap.get(p.databaseId)!,
              type: p.type,
              name: p.name,
              position: p.position,
              config: remapJson(p.config as Prisma.InputJsonValue, idMap),
            })),
          });
        if (views.length)
          await tx.dbView.createMany({
            data: views.map((v) => ({
              id: idMap.get(v.id)!,
              databaseId: idMap.get(v.databaseId)!,
              type: v.type,
              name: v.name,
              position: v.position,
              config: remapJson(v.config as Prisma.InputJsonValue, idMap),
            })),
          });
        const orders = rowOrder.filter((o) => idMap.has(o.rowId));
        if (orders.length)
          await tx.dbViewRowOrder.createMany({
            data: orders.map((o) => ({
              viewId: idMap.get(o.viewId)!,
              rowId: idMap.get(o.rowId)!,
              position: o.position,
            })),
          });

        // Werte und Relationen per SQL (Zuordnung alt → neu als Tabelle)
        const oldIds = [...idMap.keys()];
        const newIds = oldIds.map((k) => idMap.get(k)!);
        await tx.$executeRaw`
          INSERT INTO property_values (row_id, property_id, database_id, v_text, v_number, v_bool, v_date_start, v_date_end,
                                       v_date_has_time, v_tz, v_option_ids, v_user_ids, v_json, updated_at)
          SELECT rm.n, COALESCE(pm.n, v.property_id), COALESCE(dm.n, v.database_id), v.v_text, v.v_number, v.v_bool,
                 v.v_date_start, v.v_date_end, v.v_date_has_time, v.v_tz, v.v_option_ids, v.v_user_ids, v.v_json, now()
            FROM property_values v
            JOIN unnest(${oldIds}::uuid[], ${newIds}::uuid[]) AS rm(o, n) ON rm.o = v.row_id
            LEFT JOIN unnest(${oldIds}::uuid[], ${newIds}::uuid[]) AS pm(o, n) ON pm.o = v.property_id
            LEFT JOIN unnest(${oldIds}::uuid[], ${newIds}::uuid[]) AS dm(o, n) ON dm.o = v.database_id`;
        // Verknüpfungen: Quelle in der Kopie; Ziel in der Kopie wird umgesetzt, sonst bleibt es
        await tx.$executeRaw`
          INSERT INTO relation_links (database_id, property_id, from_row_id, to_row_id, position)
          SELECT COALESCE(dm.n, l.database_id), COALESCE(pm.n, l.property_id), fm.n, COALESCE(tm.n, l.to_row_id), l.position
            FROM relation_links l
            JOIN unnest(${oldIds}::uuid[], ${newIds}::uuid[]) AS fm(o, n) ON fm.o = l.from_row_id
            LEFT JOIN unnest(${oldIds}::uuid[], ${newIds}::uuid[]) AS pm(o, n) ON pm.o = l.property_id
            LEFT JOIN unnest(${oldIds}::uuid[], ${newIds}::uuid[]) AS dm(o, n) ON dm.o = l.database_id
            LEFT JOIN unnest(${oldIds}::uuid[], ${newIds}::uuid[]) AS tm(o, n) ON tm.o = l.to_row_id
           WHERE EXISTS (SELECT 1 FROM pages t WHERE t.id = COALESCE(tm.n, l.to_row_id))
          ON CONFLICT DO NOTHING`;
        // Zeilen-Vorlagen (Standard, Wiederholung; nächster Lauf neu berechnet)
        for (const t of templates.filter((x) => idMap.has(x.databaseId)))
          await tx.dbTemplate.create({
            data: {
              pageId: idMap.get(t.pageId)!,
              databaseId: idMap.get(t.databaseId)!,
              isDefault: t.isDefault,
              recurrence: (t.recurrence as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
              nextRunAt: t.nextRunAt,
            },
          });

        // Inhalte: Verweise umschreiben, Platzhalter ersetzen
        for (const [oldId, doc] of docs) {
          const newId = idMap.get(oldId);
          if (!newId) continue;
          remapDocIds(doc, idMap);
          if (opts.vars) replaceTextVariables(doc, opts.vars);
          await tx.pageDoc.create({
            data: { pageId: newId, state: Buffer.from(Y.encodeStateAsUpdate(doc)) },
          });
          await this.store.writeProjection(tx, newId, projectDoc(doc));
        }
        if (opts.event !== false)
          await recordEvent(tx, {
            workspaceId: rootCopy!.workspaceId,
            type: 'page.created',
            entityId: rootCopy!.id,
            actorId: user.id,
            audienceUserId: rootCopy!.scope === 'PRIVATE' ? rootCopy!.ownerId : null,
            payload: { parentId: rootCopy!.parentId },
          });
        return rootCopy!;
      },
      { timeout: 120_000 },
    );
    if (
      created.parentId &&
      opts.insertBlock !== false &&
      (created.kind === 'PAGE' || created.kind === 'DATABASE')
    )
      await this.collab.addSubpageBlock(created.parentId, created.id);
    const newDbs = dbIds.map((id) => idMap.get(id)!);
    // Formeln und Rollups der Kopien (Werte sind kopiert, Verweise können sich geändert haben)
    for (const id of newDbs) await this.compute.databaseChanged(id, user.id);
    return { root: created, idMap, databases: newDbs, pages: ordered.length };
  }

  private vars(text: string, vars?: Record<string, string>): string {
    if (!vars) return text;
    let out = text;
    for (const [k, v] of Object.entries(vars)) out = out.split(k).join(v);
    return out;
  }
}
