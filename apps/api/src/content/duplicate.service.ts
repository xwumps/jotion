import { Injectable } from '@nestjs/common';
import { Prisma, type Page } from '@jotion/db';
import { projectDoc, remapSubpages } from '@jotion/editor/projection';
import {
  MAX_DUPLICATE_PAGES,
  PAGE_TITLE_MAX,
  type DuplicateResultDto,
  type PageIcon,
} from '@jotion/shared';
import * as Y from 'yjs';
import { AppError } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { CollabService } from '../collab/collab.service';
import { DocStore } from '../collab/doc-store';
import { recordEvent } from '../events/outbox';
import { PrismaService } from '../infra/prisma.service';
import { computePosition } from '../pages/positions';
import { PermissionService } from '../permissions/permission.service';

/**
 * Seite duplizieren, samt aller Unterseiten (nicht im Papierkorb) und Inhalt.
 * Die Kopie liegt direkt hinter dem Original. Unterseiten-Blöcke zeigen auf die kopierten Seiten.
 * Rechte: Das Original muss sichtbar, die Elternseite bearbeitbar sein. Unterseiten erben
 * Bereich und Owner der Wurzel, daher enthält der Teilbaum nur Seiten, die der Nutzer sieht.
 */
@Injectable()
export class DuplicateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly store: DocStore,
    private readonly collab: CollabService,
  ) {}

  async duplicate(user: AuthUser, pageId: string): Promise<DuplicateResultDto> {
    const { page } = await this.perms.requireEditablePage(user.id, pageId);
    if (page.parentId) await this.perms.requireEditablePage(user.id, page.parentId);

    const tree = await this.prisma.client.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM pages
       WHERE path <@ (SELECT path FROM pages WHERE id = ${page.id}::uuid) AND deleted_at IS NULL
       ORDER BY nlevel(path), position, id
       LIMIT ${MAX_DUPLICATE_PAGES + 1}`;
    if (tree.length > MAX_DUPLICATE_PAGES)
      throw new AppError(
        'bad_request',
        `Höchstens ${MAX_DUPLICATE_PAGES} Seiten können auf einmal dupliziert werden`,
      );
    const pages = await this.prisma.client.page.findMany({
      where: { id: { in: tree.map((t) => t.id) } },
    });
    const byId = new Map(pages.map((p) => [p.id, p]));
    const ordered = tree.map((t) => byId.get(t.id)!).filter(Boolean);
    // Inhalte vorab laden (vollständig, inkl. noch nicht kompaktierter Updates)
    const docs = new Map<string, Y.Doc>();
    for (const p of ordered) docs.set(p.id, await this.store.loadDoc(p.id));

    const suffix = user.locale === 'en' ? ' (Copy)' : ' (Kopie)';
    const idMap = new Map<string, string>();
    const root = await this.prisma.client.$transaction(
      async (tx) => {
        let created: Page | null = null;
        for (const src of ordered) {
          const isRoot = src.id === page.id;
          const parentId = isRoot ? src.parentId : idMap.get(src.parentId ?? '');
          if (!isRoot && !parentId) continue;
          const position = isRoot
            ? await computePosition(
                tx,
                {
                  workspaceId: src.workspaceId,
                  parentId: src.parentId,
                  scope: src.scope,
                  ownerId: src.ownerId,
                },
                { afterId: src.id },
              )
            : src.position;
          const copy = await tx.page.create({
            data: {
              workspaceId: src.workspaceId,
              parentId: parentId ?? null,
              position,
              title: isRoot ? `${src.title}${suffix}`.slice(0, PAGE_TITLE_MAX) : src.title,
              icon: (src.icon as Prisma.InputJsonValue | null) ?? undefined,
              cover: (src.cover as Prisma.InputJsonValue | null) ?? undefined,
              settings: (src.settings as Prisma.InputJsonValue) ?? {},
              // Wurzelseiten: Bereich wie das Original; Unterseiten übernehmen ihn per Trigger
              scope: src.scope,
              ownerId: src.scope === 'PRIVATE' ? src.ownerId : user.id,
              archivedAt: isRoot ? null : src.archivedAt,
              createdById: user.id,
              lastEditedById: user.id,
            },
          });
          idMap.set(src.id, copy.id);
          if (isRoot) created = copy;
        }
        for (const src of ordered) {
          const newId = idMap.get(src.id);
          const doc = docs.get(src.id);
          if (!newId || !doc) continue;
          remapSubpages(doc, idMap);
          const state = Y.encodeStateAsUpdate(doc);
          await tx.pageDoc.create({ data: { pageId: newId, state: Buffer.from(state) } });
          await this.store.writeProjection(tx, newId, projectDoc(doc));
        }
        await recordEvent(tx, {
          workspaceId: created!.workspaceId,
          type: 'page.created',
          entityId: created!.id,
          actorId: user.id,
          audienceUserId: created!.scope === 'PRIVATE' ? created!.ownerId : null,
          payload: { parentId: created!.parentId },
        });
        return created!;
      },
      { timeout: 60_000 },
    );
    if (root.parentId) await this.collab.addSubpageBlock(root.parentId, root.id);
    return {
      id: root.id,
      title: root.title,
      icon: (root.icon as PageIcon | null) ?? null,
      pages: idMap.size,
    };
  }
}
