import { Injectable } from '@nestjs/common';
import { Prisma } from '@jotion/db';
import type {
  ContentSearchResultDto,
  MentionCandidatesDto,
  PageIcon,
  contentSearchQuerySchema,
} from '@jotion/shared';
import type { z } from 'zod';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../infra/prisma.service';
import { PermissionService } from '../permissions/permission.service';

type Query = z.output<typeof contentSearchQuerySchema>;

interface Row {
  id: string;
  title: string;
  icon: PageIcon | null;
  path: string | null;
  last_edited_at: Date;
  archived: boolean;
  block_id: string | null;
  block_text: string | null;
  score: number;
}

const SNIPPET_RADIUS = 80;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Suchbegriffe ohne Operatoren (für Hervorhebung und Ausschnitt). */
export function searchTerms(q: string): string[] {
  return Array.from(
    new Set(
      q
        .replace(/["()]/g, ' ')
        .split(/\s+/)
        .map((t) => t.replace(/^-/, ''))
        .filter((t) => t.length > 0 && !/^(or|and)$/i.test(t))
        .map(fold),
    ),
  ).slice(0, 10);
}

/**
 * Ausschnitt um den ersten Treffer und Bereiche der Treffer im Ausschnitt.
 * Vergleich ohne Groß- und Kleinschreibung und ohne Akzente; die Länge bleibt dabei gleich
 * (NFD-Zerlegung wird pro Zeichen zurückgefaltet).
 */
export function makeSnippet(
  text: string,
  terms: string[],
): { snippet: string; highlights: [number, number][] } {
  // pro Originalzeichen genau ein gefaltetes Zeichen, damit Positionen übereinstimmen
  const folded = Array.from(text, (c) => fold(c).slice(0, 1) || c).join('');
  let first = -1;
  for (const t of terms) {
    const i = folded.indexOf(t);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  const start = first < 0 ? 0 : Math.max(0, first - SNIPPET_RADIUS);
  const end = Math.min(text.length, (first < 0 ? 0 : first) + SNIPPET_RADIUS * 2);
  const prefix = start > 0 ? '…' : '';
  const snippet = `${prefix}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`;
  const foldedSnippet = Array.from(snippet, (c) => fold(c).slice(0, 1) || c).join('');
  const highlights: [number, number][] = [];
  for (const t of terms) {
    let from = 0;
    for (;;) {
      const i = foldedSnippet.indexOf(t, from);
      if (i < 0) break;
      highlights.push([i, i + t.length]);
      from = i + t.length;
    }
  }
  highlights.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const h of highlights) {
    const last = merged[merged.length - 1];
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
    else merged.push([h[0], h[1]]);
  }
  return { snippet, highlights: merged };
}

/**
 * Volltextsuche über Titel und Blockinhalte (PostgreSQL FTS + Trigramme).
 * Rechte: nur Seiten, die der Nutzer sehen darf (Team oder eigene private), nie aus dem Papierkorb.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
  ) {}

  async search(
    user: AuthUser,
    workspaceId: string,
    query: Query,
  ): Promise<ContentSearchResultDto[]> {
    await this.perms.requireMember(user.id, workspaceId);
    const q = query.q.trim();
    const filters: Prisma.Sql[] = [
      Prisma.sql`p.workspace_id = ${workspaceId}::uuid`,
      Prisma.sql`p.deleted_at IS NULL`,
      // Zeilen-Vorlagen sind keine eigenständigen Seiten
      Prisma.sql`p.kind <> 'ROW_TEMPLATE'`,
      Prisma.sql`(p.scope = 'TEAM' OR p.owner_id = ${user.id}::uuid)`,
    ];
    if (query.scope === 'private')
      filters.push(Prisma.sql`p.scope = 'PRIVATE' AND p.owner_id = ${user.id}::uuid`);
    if (query.scope === 'team') filters.push(Prisma.sql`p.scope = 'TEAM'`);
    if (query.createdBy) filters.push(Prisma.sql`p.created_by_id = ${query.createdBy}::uuid`);
    if (query.editedAfter) filters.push(Prisma.sql`p.last_edited_at >= ${query.editedAfter}::date`);
    if (query.editedBefore)
      filters.push(Prisma.sql`p.last_edited_at < (${query.editedBefore}::date + 1)`);
    if (query.parentId)
      filters.push(
        Prisma.sql`p.path <@ (SELECT path FROM pages WHERE id = ${query.parentId}::uuid AND workspace_id = ${workspaceId}::uuid)`,
      );
    const visible = Prisma.join(filters, ' AND ');
    const limit = query.limit;

    let rows: Row[];
    if (!q) {
      rows = await this.prisma.client.$queryRaw<Row[]>`
        SELECT p.id::text, p.title, p.icon, p.last_edited_at, p.archived_at IS NOT NULL AS archived,
               NULL::text AS block_id, NULL::text AS block_text, 0::float8 AS score,
               (SELECT string_agg(NULLIF(a.title, ''), ' / ' ORDER BY nlevel(a.path))
                  FROM pages a WHERE a.path @> p.path AND a.id <> p.id) AS path
          FROM pages p WHERE ${visible}
         ORDER BY p.last_edited_at DESC LIMIT ${limit}`;
    } else {
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const blockHits = query.titleOnly
        ? Prisma.sql`SELECT NULL::uuid AS page_id, NULL::text AS block_id, NULL::text AS block_text, 0::float8 AS score WHERE false`
        : Prisma.sql`
          SELECT DISTINCT ON (b.page_id) b.page_id, b.id AS block_id, b.plain_text AS block_text,
                 (ts_rank(to_tsvector('simple'::regconfig, jotion_unaccent(b.plain_text)), tq.q)
                   + CASE WHEN jotion_unaccent(b.plain_text) ILIKE jotion_unaccent(${like}) THEN 0.3 ELSE 0 END)::float8 AS score
            FROM blocks b JOIN visible v ON v.id = b.page_id, tq
           WHERE to_tsvector('simple'::regconfig, jotion_unaccent(b.plain_text)) @@ tq.q
              OR jotion_unaccent(b.plain_text) ILIKE jotion_unaccent(${like})
           ORDER BY b.page_id, score DESC, b.position`;
      rows = await this.prisma.client.$queryRaw<Row[]>`
        WITH visible AS (SELECT p.* FROM pages p WHERE ${visible}),
             tq AS (SELECT websearch_to_tsquery('simple'::regconfig, jotion_unaccent(${q})) AS q),
             title_hits AS (
               SELECT v.id AS page_id,
                      (CASE WHEN to_tsvector('simple'::regconfig, jotion_unaccent(v.title)) @@ tq.q THEN 1.0 ELSE 0 END
                        + CASE WHEN jotion_unaccent(v.title) ILIKE jotion_unaccent(${like}) THEN 1.0 ELSE 0 END
                        + similarity(jotion_unaccent(v.title), jotion_unaccent(${q})))::float8 AS score
                 FROM visible v, tq
                WHERE to_tsvector('simple'::regconfig, jotion_unaccent(v.title)) @@ tq.q
                   OR jotion_unaccent(v.title) ILIKE jotion_unaccent(${like})
                   OR similarity(jotion_unaccent(v.title), jotion_unaccent(${q})) > 0.3
             ),
             block_hits AS (${blockHits}),
             hits AS (
               SELECT COALESCE(t.page_id, b.page_id) AS page_id,
                      COALESCE(t.score, 0) * 2 + COALESCE(b.score, 0) AS score,
                      b.block_id, b.block_text
                 FROM title_hits t FULL OUTER JOIN block_hits b ON b.page_id = t.page_id
             )
        SELECT p.id::text, p.title, p.icon, p.last_edited_at, p.archived_at IS NOT NULL AS archived,
               h.block_id, h.block_text, h.score,
               (SELECT string_agg(NULLIF(a.title, ''), ' / ' ORDER BY nlevel(a.path))
                  FROM pages a WHERE a.path @> p.path AND a.id <> p.id) AS path
          FROM hits h JOIN visible p ON p.id = h.page_id
         ORDER BY ${query.sort === 'edited' ? Prisma.sql`p.last_edited_at DESC` : Prisma.sql`h.score DESC, p.last_edited_at DESC`}
         LIMIT ${limit}`;
    }
    const terms = searchTerms(q);
    return rows.map((r) => {
      const snip = r.block_text ? makeSnippet(r.block_text, terms) : null;
      return {
        id: r.id,
        title: r.title,
        icon: r.icon,
        path: r.path ?? '',
        lastEditedAt: r.last_edited_at.toISOString(),
        archived: r.archived,
        blockId: r.block_id,
        snippet: snip?.snippet ?? null,
        highlights: snip?.highlights ?? [],
      };
    });
  }

  /** Vorschläge für @-Erwähnungen: Mitglieder des Workspace und sichtbare Seiten. */
  async mentionCandidates(
    user: AuthUser,
    workspaceId: string,
    rawQuery: string,
  ): Promise<MentionCandidatesDto> {
    await this.perms.requireMember(user.id, workspaceId);
    const q = rawQuery.trim().slice(0, 100);
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const users = await this.prisma.client.$queryRaw<{ id: string; name: string }[]>`
      SELECT u.id::text, u.name FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ${workspaceId}::uuid AND u.disabled_at IS NULL
         ${q ? Prisma.sql`AND (jotion_unaccent(u.name) ILIKE jotion_unaccent(${like}) OR u.email ILIKE ${like})` : Prisma.empty}
       ORDER BY (u.id = ${user.id}::uuid) DESC, u.name LIMIT 6`;
    const pages = await this.search(user, workspaceId, {
      q,
      scope: 'all',
      titleOnly: true,
      sort: q ? 'relevance' : 'edited',
      limit: 8,
    });
    return {
      users,
      pages: pages.map((p) => ({
        id: p.id,
        title: p.title,
        icon: p.icon,
        path: p.path,
        lastEditedAt: p.lastEditedAt,
      })),
    };
  }
}
