import { Injectable, Logger } from '@nestjs/common';
import { projectDoc, type Projection } from '@jotion/editor/projection';
import { Prisma } from '@jotion/db';
import * as Y from 'yjs';
import { notify } from '../comments/notify';
import { PrismaService } from '../infra/prisma.service';

/**
 * Dauerhafte Speicherung der Seiteninhalte.
 *  - append(): jedes eingehende Update wird sofort angehängt, BEVOR der Server es bestätigt.
 *  - load(): kompaktierter Zustand plus alle noch offenen Updates.
 *  - compact(): schreibt den Gesamtzustand, entfernt nur Updates, die nachweislich darin
 *    enthalten sind (Y.snapshotContainsUpdate), und aktualisiert die Block-Projektion.
 */
@Injectable()
export class DocStore {
  private readonly logger = new Logger('DocStore');

  constructor(private readonly prisma: PrismaService) {}

  async append(pageId: string, update: Uint8Array, userId: string | null): Promise<void> {
    await this.prisma.client.pageDocUpdate.create({
      data: { pageId, update: Buffer.from(update), userId },
    });
  }

  /** Wendet den gespeicherten Inhalt auf doc an. Beschädigte Einträge werden übersprungen und gemeldet. */
  async loadInto(pageId: string, doc: Y.Doc): Promise<{ updates: number; skipped: number }> {
    const [state, updates] = await Promise.all([
      this.prisma.client.pageDoc.findUnique({ where: { pageId }, select: { state: true } }),
      this.prisma.client.pageDocUpdate.findMany({
        where: { pageId },
        orderBy: { id: 'asc' },
        select: { id: true, update: true },
      }),
    ]);
    let skipped = 0;
    if (state) {
      try {
        Y.applyUpdate(doc, new Uint8Array(state.state), 'jotion-load');
      } catch (err) {
        skipped++;
        this.logger.error(`Gespeicherter Zustand von ${pageId} unlesbar: ${String(err)}`);
      }
    }
    for (const u of updates) {
      try {
        Y.applyUpdate(doc, new Uint8Array(u.update), 'jotion-load');
      } catch (err) {
        skipped++;
        this.logger.error(`Update ${u.id} von ${pageId} unlesbar, übersprungen: ${String(err)}`);
      }
    }
    return { updates: updates.length, skipped };
  }

  async compact(pageId: string, doc: Y.Doc, editorUserId: string | null): Promise<void> {
    // Zustand, Snapshot und Projektion synchron aus demselben Dokumentstand ableiten
    const state = Y.encodeStateAsUpdate(doc);
    const snapshot = Y.snapshot(doc);
    const projection = projectDoc(doc);

    const pending = await this.prisma.client.pageDocUpdate.findMany({
      where: { pageId },
      select: { id: true, update: true },
    });
    const contained = pending.filter((u) => {
      try {
        return Y.snapshotContainsUpdate(snapshot, new Uint8Array(u.update));
      } catch {
        return false;
      }
    });

    await this.prisma.client.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: pageId },
        select: { id: true, workspaceId: true, kind: true },
      });
      if (!page) return; // Seite wurde inzwischen endgültig gelöscht
      // Phase 10: bisherige Personen-Erwähnungen für den Vergleich nach dem Neuschreiben
      const before = await tx.blockReference.findMany({
        where: { pageId, targetType: 'user' },
        select: { blockId: true, targetId: true },
      });
      await tx.pageDoc.upsert({
        where: { pageId },
        create: { pageId, state: Buffer.from(state) },
        update: { state: Buffer.from(state), version: { increment: 1 } },
      });
      if (contained.length) {
        await tx.pageDocUpdate.deleteMany({ where: { id: { in: contained.map((u) => u.id) } } });
      }
      await this.writeProjection(tx, pageId, projection);
      await this.notifyMentions(tx, page, before, projection, editorUserId);
      if (editorUserId) {
        await tx.page.update({
          where: { id: pageId },
          data: { lastEditedAt: new Date(), lastEditedById: editorUserId },
        });
      }
    });
  }

  /**
   * Phase 10: Benachrichtigt neu erwähnte Personen (Erwähnung, die es in diesem Block vorher nicht
   * gab). Vorlagen werden ausgelassen, damit Kopien keine Benachrichtigungen auslösen.
   */
  private async notifyMentions(
    tx: Prisma.TransactionClient,
    page: { id: string; workspaceId: string; kind: string },
    before: { blockId: string; targetId: string }[],
    projection: Projection,
    actorId: string | null,
  ): Promise<void> {
    if (page.kind === 'ROW_TEMPLATE') return;
    const old = new Set(before.map((b) => `${b.blockId}|${b.targetId}`));
    const added = projection.references.filter(
      (r) => r.targetType === 'user' && !old.has(`${r.blockId}|${r.targetId}`),
    );
    // Nutzer, die auf der Seite schon erwähnt waren, nicht erneut benachrichtigen
    const known = new Set(before.map((b) => b.targetId));
    const texts = new Map(projection.blocks.map((b) => [b.id, b.text]));
    const byUser = new Map<string, string>();
    for (const r of added)
      if (!known.has(r.targetId) && !byUser.has(r.targetId)) byUser.set(r.targetId, r.blockId);
    for (const [userId, blockId] of byUser) {
      const text = texts.get(blockId) ?? '';
      await notify(tx, [userId], {
        workspaceId: page.workspaceId,
        pageId: page.id,
        type: 'mention_page',
        actorId,
        payload: { excerpt: text.length > 200 ? `${text.slice(0, 199)}…` : text, blockId },
      });
    }
  }

  /** Schreibt die Block-Projektion einer Seite neu (innerhalb einer Transaktion). */
  async writeProjection(
    tx: Prisma.TransactionClient,
    pageId: string,
    projection: Projection,
  ): Promise<void> {
    await tx.block.deleteMany({ where: { pageId } });
    if (projection.blocks.length) {
      await tx.block.createMany({
        data: projection.blocks.map((b) => ({
          pageId,
          id: b.id.slice(0, 100),
          parentBlockId: b.parentId?.slice(0, 100) ?? null,
          type: b.type.slice(0, 50),
          position: b.position,
          plainText: b.text.slice(0, 20_000),
          props: b.props as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
    }
    await tx.blockReference.deleteMany({ where: { pageId } });
    if (projection.references.length) {
      await tx.blockReference.createMany({
        data: projection.references.map((r) => ({
          pageId,
          blockId: r.blockId.slice(0, 100),
          targetType: r.targetType,
          targetId: r.targetId,
        })),
        skipDuplicates: true,
      });
    }
  }

  /** Lädt den vollständigen gespeicherten Inhalt einer Seite in ein neues Dokument. */
  async loadDoc(pageId: string): Promise<Y.Doc> {
    const doc = new Y.Doc();
    await this.loadInto(pageId, doc);
    return doc;
  }
}
