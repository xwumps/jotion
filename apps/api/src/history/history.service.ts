import { Injectable } from '@nestjs/common';
import { docToJson, projectDoc, type ProjectedBlock } from '@jotion/editor/projection';
import type { BlockDiffDto, PageVersionDetailDto, PageVersionDto } from '@jotion/shared';
import * as Y from 'yjs';
import { CollabService } from '../collab/collab.service';
import { DocStore } from '../collab/doc-store';
import { notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { recordEvent } from '../events/outbox';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../permissions/permission.service';

type SnapshotRow = {
  id: string;
  pageId: string;
  title: string;
  reason: string;
  createdAt: Date;
  createdById: string | null;
};

/** Blöcke zweier Stände vergleichen (nach Block-ID); entfernte stehen hinter ihrem Vorgänger. */
export function diffBlocks(before: ProjectedBlock[], after: ProjectedBlock[]): BlockDiffDto[] {
  const old = new Map(before.map((b) => [b.id, b]));
  const now = new Set(after.map((b) => b.id));
  const out: BlockDiffDto[] = after.map((b) => {
    const o = old.get(b.id);
    if (!o) return { id: b.id, type: b.type, status: 'added', text: b.text, before: null };
    const changed = o.text !== b.text || o.type !== b.type;
    return {
      id: b.id,
      type: b.type,
      status: changed ? 'changed' : 'same',
      text: b.text,
      before: changed ? o.text : null,
    };
  });
  let anchor: string | null = null;
  for (const b of before) {
    if (now.has(b.id)) {
      anchor = b.id;
      continue;
    }
    const removed: BlockDiffDto = {
      id: b.id,
      type: b.type,
      status: 'removed',
      text: '',
      before: b.text,
    };
    // Hinter den letzten bereits eingefügten Eintrag nach dem Anker
    let i = anchor ? out.findIndex((x) => x.id === anchor) + 1 : 0;
    while (i < out.length && out[i]!.status === 'removed') i++;
    out.splice(i, 0, removed);
  }
  return out;
}

/**
 * Phase 10: Seitenhistorie. Versionen entstehen beim Kompaktieren (höchstens alle 10 Minuten)
 * und vor jeder Wiederherstellung. Lesen verlangt "ansehen", Wiederherstellen "bearbeiten".
 */
@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly store: DocStore,
    private readonly collab: CollabService,
  ) {}

  async list(user: AuthUser, pageId: string): Promise<PageVersionDto[]> {
    const { page } = await this.perms.requirePage(user.id, pageId, { includeTrashed: true });
    const rows = await this.prisma.client.pageSnapshot.findMany({
      where: { pageId: page.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        pageId: true,
        title: true,
        reason: true,
        createdAt: true,
        createdById: true,
      },
    });
    return this.toDtos(rows);
  }

  async get(user: AuthUser, pageId: string, versionId: string): Promise<PageVersionDetailDto> {
    const { page } = await this.perms.requirePage(user.id, pageId, { includeTrashed: true });
    const snap = await this.prisma.client.pageSnapshot.findUnique({ where: { id: versionId } });
    if (!snap || snap.pageId !== page.id) throw notFound('Version');
    const prev = await this.prisma.client.pageSnapshot.findFirst({
      where: { pageId: page.id, createdAt: { lt: snap.createdAt } },
      orderBy: { createdAt: 'desc' },
    });
    const doc = this.decode(snap.state);
    const before = prev ? this.decode(prev.state) : new Y.Doc();
    try {
      const [version] = await this.toDtos([snap]);
      return {
        version: version!,
        doc: docToJson(doc) as PageVersionDetailDto['doc'],
        diff: diffBlocks(projectDoc(before).blocks, projectDoc(doc).blocks),
      };
    } finally {
      doc.destroy();
      before.destroy();
    }
  }

  async restore(user: AuthUser, pageId: string, versionId: string): Promise<PageVersionDto> {
    const { page } = await this.perms.requireEditablePage(user.id, pageId);
    const snap = await this.prisma.client.pageSnapshot.findUnique({ where: { id: versionId } });
    if (!snap || snap.pageId !== page.id) throw notFound('Version');
    // Aktuellen Stand sichern, damit sich die Wiederherstellung rückgängig machen lässt
    const current = await this.store.loadDoc(page.id);
    const backup = await this.prisma.client.pageSnapshot.create({
      data: {
        pageId: page.id,
        state: Buffer.from(Y.encodeStateAsUpdate(current)),
        title: page.title,
        reason: 'restore',
        createdById: user.id,
      },
    });
    current.destroy();
    const source = this.decode(snap.state);
    try {
      await this.collab.replaceContent(page.id, source);
    } finally {
      source.destroy();
    }
    if (snap.title !== page.title) {
      await this.prisma.client.$transaction(async (tx) => {
        const u = await tx.page.update({
          where: { id: page.id },
          data: { title: snap.title, lastEditedById: user.id, lastEditedAt: new Date() },
        });
        await recordEvent(tx, {
          workspaceId: u.workspaceId,
          type: 'page.updated',
          entityId: u.id,
          actorId: user.id,
          audienceUserId: u.scope === 'PRIVATE' ? u.ownerId : null,
          payload: { title: u.title },
        });
      });
    }
    return (await this.toDtos([backup]))[0]!;
  }

  private decode(state: Uint8Array): Y.Doc {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(state));
    return doc;
  }

  private async toDtos(rows: SnapshotRow[]): Promise<PageVersionDto[]> {
    const ids = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    const users = new Map(
      (
        await this.prisma.client.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      reason: r.reason === 'restore' ? 'restore' : 'auto',
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdById ? { id: r.createdById, name: users.get(r.createdById) ?? '' } : null,
    }));
  }
}
