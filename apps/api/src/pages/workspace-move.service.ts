import { Injectable } from '@nestjs/common';
import { moveToWorkspaceSchema, type PageDto } from '@jotion/shared';
import { CollabService } from '../collab/collab.service';
import { AppError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { parse } from '../common/validation';
import { recordEvent } from '../events/outbox';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../permissions/permission.service';
import { PagesService } from './pages.service';
import { computePosition } from './positions';

/**
 * Phase 10: Seite samt Unterseiten (inklusive Datenbanken, Zeilen, Kommentaren, Versionen) in
 * einen anderen Workspace verschieben. Verlangt volle Rechte auf der Seite und Mitgliedschaft im
 * Ziel. Verbindungen über die Grenze hinweg (Relationen, verknüpfte Datenbanken, Integrationen,
 * Automatisierungen anderer Datenbanken) verhindern das Verschieben mit einer Erklärung.
 */
@Injectable()
export class WorkspaceMoveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly collab: CollabService,
    private readonly pages: PagesService,
  ) {}

  async move(user: AuthUser, pageId: string, body: unknown): Promise<PageDto> {
    const input = parse(moveToWorkspaceSchema, body);
    const { page } = await this.perms.requirePage(user.id, pageId, { level: 'full' });
    if (page.kind !== 'PAGE' && page.kind !== 'DATABASE')
      throw new AppError('bad_request', 'Nur Seiten und Datenbanken lassen sich verschieben');
    if (page.workspaceId === input.workspaceId)
      throw new AppError('bad_request', 'Die Seite liegt bereits in diesem Workspace');
    await this.perms.requireMember(user.id, input.workspaceId);
    const from = page.workspaceId;
    const to = input.workspaceId;

    const subtree = await this.prisma.client.$queryRaw<{ id: string; depth: number }[]>`
      SELECT id::text, nlevel(path) AS depth FROM pages
       WHERE path <@ (SELECT path FROM pages WHERE id = ${page.id}::uuid)`;
    const ids = subtree.map((s) => s.id);
    await this.assertMovable(ids);

    await this.prisma.client.$transaction(
      async (tx) => {
        // 1. Wurzel im alten Workspace lösen und Bereich setzen (Trigger zieht den Teilbaum nach)
        const ownerId = input.scope === 'PRIVATE' ? user.id : page.ownerId;
        await tx.page.update({
          where: { id: page.id },
          data: { parentId: null, scope: input.scope, ownerId },
        });
        await recordEvent(tx, {
          workspaceId: from,
          type: 'page.deleted',
          entityId: page.id,
          actorId: user.id,
          payload: {},
        });
        // 2. Workspace Ebene für Ebene wechseln (Elternseite muss jeweils schon im Ziel liegen)
        const position = await computePosition(
          tx,
          { workspaceId: to, parentId: null, scope: input.scope, ownerId },
          {},
        );
        await tx.page.update({ where: { id: page.id }, data: { workspaceId: to, position } });
        const depths = [...new Set(subtree.map((s) => s.depth))].sort((a, b) => a - b).slice(1);
        for (const d of depths) {
          const level = subtree.filter((s) => s.depth === d).map((s) => s.id);
          await tx.$executeRaw`UPDATE pages SET workspace_id = ${to}::uuid WHERE id = ANY(${level}::uuid[])`;
        }
        // 3. Abhängige Daten
        await tx.$executeRaw`UPDATE databases SET workspace_id = ${to}::uuid WHERE id = ANY(${ids}::uuid[])`;
        await tx.$executeRaw`UPDATE automations SET workspace_id = ${to}::uuid WHERE database_id = ANY(${ids}::uuid[])`;
        await tx.$executeRaw`UPDATE comments SET workspace_id = ${to}::uuid WHERE page_id = ANY(${ids}::uuid[])`;
        const notMember = (col: string) =>
          `${col} NOT IN (SELECT user_id FROM workspace_members WHERE workspace_id = $2::uuid)`;
        // Angaben und persönliche Listen für Personen ohne Mitgliedschaft im Ziel entfallen
        await tx.$executeRawUnsafe(
          `DELETE FROM page_permissions WHERE page_id = ANY($1::uuid[]) AND user_id IS NOT NULL AND ${notMember('user_id')}`,
          ids,
          to,
        );
        await tx.$executeRaw`UPDATE page_permissions SET workspace_id = ${to}::uuid WHERE page_id = ANY(${ids}::uuid[])`;
        await tx.$executeRawUnsafe(
          `DELETE FROM notifications WHERE page_id = ANY($1::uuid[]) AND ${notMember('user_id')}`,
          ids,
          to,
        );
        await tx.$executeRaw`UPDATE notifications SET workspace_id = ${to}::uuid WHERE page_id = ANY(${ids}::uuid[])`;
        await tx.$executeRawUnsafe(
          `DELETE FROM favorites WHERE page_id = ANY($1::uuid[]) AND ${notMember('user_id')}`,
          ids,
          to,
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM page_visits WHERE page_id = ANY($1::uuid[]) AND ${notMember('user_id')}`,
          ids,
          to,
        );
        // Dateien, die nur im Teilbaum verwendet werden, wandern mit
        await tx.$executeRaw`
          UPDATE files f SET workspace_id = ${to}::uuid
           WHERE f.workspace_id = ${from}::uuid
             AND (EXISTS (SELECT 1 FROM block_references r WHERE r.target_id = f.id AND r.page_id = ANY(${ids}::uuid[]))
                  OR EXISTS (SELECT 1 FROM pages p WHERE p.id = ANY(${ids}::uuid[])
                              AND (p.icon->>'fileId' = f.id::text OR p.cover->>'fileId' = f.id::text)))
             AND NOT EXISTS (SELECT 1 FROM block_references r WHERE r.target_id = f.id AND NOT (r.page_id = ANY(${ids}::uuid[])))
             AND NOT EXISTS (SELECT 1 FROM pages p WHERE NOT (p.id = ANY(${ids}::uuid[]))
                              AND (p.icon->>'fileId' = f.id::text OR p.cover->>'fileId' = f.id::text))`;
        await recordEvent(tx, {
          workspaceId: to,
          type: 'page.created',
          entityId: page.id,
          actorId: user.id,
          audienceUserId: input.scope === 'PRIVATE' ? ownerId : null,
          payload: { parentId: null },
        });
      },
      { timeout: 60_000 },
    );
    // Offene Editoren mit neuen Rechten verbinden
    this.collab.revalidate();
    if (page.parentId) await this.collab.removeSubpageBlock(page.parentId, page.id);
    return this.pages.get(user, page.id);
  }

  /** Verbindungen über die Grenze des Teilbaums hinweg verhindern das Verschieben. */
  private async assertMovable(ids: string[]): Promise<void> {
    const [rel] = await this.prisma.client.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM db_properties dp
       WHERE dp.type = 'relation'
         AND ((dp.database_id = ANY(${ids}::uuid[])) <> ((dp.config->>'targetDatabaseId')::uuid = ANY(${ids}::uuid[])))`;
    if (rel?.n)
      throw new AppError(
        'validation_failed',
        'Relationen verbinden Datenbanken innerhalb und außerhalb der Seite. Bitte zuerst entfernen.',
      );
    const [linked] = await this.prisma.client.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM databases d
       WHERE d.source_database_id IS NOT NULL
         AND ((d.id = ANY(${ids}::uuid[])) <> (d.source_database_id = ANY(${ids}::uuid[])))`;
    if (linked?.n)
      throw new AppError(
        'validation_failed',
        'Verknüpfte Datenbankansichten zeigen über die Seite hinaus. Bitte zuerst entfernen.',
      );
    const [sync] = await this.prisma.client.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM integration_sources WHERE target_database_id = ANY(${ids}::uuid[])`;
    if (sync?.n)
      throw new AppError(
        'validation_failed',
        'Eine Integration synchronisiert in eine Datenbank dieser Seite. Bitte zuerst trennen.',
      );
    const [auto] = await this.prisma.client.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM automations a, jsonb_array_elements(a.actions) act
       WHERE NOT (a.database_id IS NOT NULL AND a.database_id = ANY(${ids}::uuid[]))
         AND act->>'type' = 'create_row' AND (act->>'databaseId')::uuid = ANY(${ids}::uuid[])`;
    if (auto?.n)
      throw new AppError(
        'validation_failed',
        'Eine Automatisierung außerhalb legt Zeilen in einer Datenbank dieser Seite an.',
      );
    if (!ids.length) throw notFound('Seite');
  }
}
