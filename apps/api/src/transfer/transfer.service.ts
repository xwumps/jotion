import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { Page } from '@jotion/db';
import { markdownToPm, pmToHtml, pmToMarkdown } from '@jotion/editor/markdown';
import { appendPmContent, docToJson, projectDoc, type PmNode } from '@jotion/editor/projection';
import { OPTION_COLORS, type DatabaseDto, type PropertyDto, type RowDto } from '@jotion/shared';
import { strFromU8, unzipSync, zipSync, type Zippable } from 'fflate';
import * as Y from 'yjs';
import { CollabService } from '../collab/collab.service';
import { DocStore } from '../collab/doc-store';
import { AppError } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { DatabasesService } from '../databases/databases.service';
import { RowsService } from '../databases/rows.service';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../infra/prisma.service';
import { PagesService } from '../pages/pages.service';
import { PermissionService } from '../permissions/permission.service';
import { parseCsv, toCsv } from './csv';

/** Grenzen gegen ZIP-Bomben und übergroße Importe */
const MAX_ENTRIES = 5000;
const MAX_UNZIPPED = 500 * 1024 * 1024;
const MAX_PAGES = 2000;
const MAX_CSV_ROWS = 10_000;
const MAX_EXPORT_PAGES = 1000;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
/** Notion hängt an Datei- und Ordnernamen eine 32-stellige ID an */
const NOTION_ID = /\s+[0-9a-f]{32}$/i;
const stripId = (name: string) => name.replace(NOTION_ID, '').trim();

export interface ImportResultDto {
  rootIds: string[];
  pages: number;
  databases: number;
  rows: number;
  images: number;
  warnings: string[];
}

interface ImportCtx {
  user: AuthUser;
  workspaceId: string;
  scope: 'TEAM' | 'PRIVATE';
  files: Map<string, Uint8Array>;
  result: ImportResultDto;
  /** Pfad (ohne Endung) → angelegte Seite, für Links zwischen Dateien */
  pageByPath: Map<string, string>;
  /** Bildpfad im ZIP → URL nach dem Hochladen */
  imageUrls: Map<string, string | null>;
}

type ColumnType =
  'text' | 'number' | 'checkbox' | 'date' | 'url' | 'email' | 'select' | 'multi_select';

const TRUE_WORDS = new Set(['yes', 'ja', 'true', 'wahr', 'x', '✓', '✔', '1']);
const FALSE_WORDS = new Set(['no', 'nein', 'false', 'falsch', '', '0']);
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Datum aus ISO, deutschem Format oder Notion-Export ("November 9, 2026 3:00 PM") */
export function parseDate(raw: string): { start: string; hasTime: boolean } | null {
  const v = raw
    .trim()
    .split(/\s+→\s+/)[0]!
    .replace(/\s*\(.*\)$/, '');
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v);
  if (m) {
    if (!m[4]) return { start: `${m[1]}-${m[2]}-${m[3]}`, hasTime: false };
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`);
    return Number.isNaN(d.getTime()) ? null : { start: d.toISOString(), hasTime: true };
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?$/.exec(v);
  if (m) {
    const date = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    if (!m[4]) return { start: date, hasTime: false };
    return {
      start: new Date(`${date}T${m[4].padStart(2, '0')}:${m[5]}:00Z`).toISOString(),
      hasTime: true,
    };
  }
  m = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?$/i.exec(v);
  if (m) {
    const mon = MONTHS.indexOf(m[1]!.toLowerCase());
    if (mon < 0) return null;
    const date = `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
    if (!m[4]) return { start: date, hasTime: false };
    let h = Number(m[4]) % 12;
    if (m[6]?.toUpperCase() === 'PM') h += 12;
    else if (!m[6]) h = Number(m[4]);
    return {
      start: new Date(`${date}T${String(h).padStart(2, '0')}:${m[5]}:00Z`).toISOString(),
      hasTime: true,
    };
  }
  return null;
}

/** Spaltentyp aus den Werten ableiten (leere Werte zählen nicht) */
export function inferColumn(values: string[]): ColumnType {
  const vals = values.map((v) => v.trim()).filter(Boolean);
  if (!vals.length) return 'text';
  if (vals.every((v) => /^-?\d+([.,]\d+)?$/.test(v.replace(/\s/g, '')))) return 'number';
  if (
    values.every(
      (v) => TRUE_WORDS.has(v.trim().toLowerCase()) || FALSE_WORDS.has(v.trim().toLowerCase()),
    )
  )
    return 'checkbox';
  if (vals.every((v) => parseDate(v))) return 'date';
  if (vals.every((v) => /^https?:\/\/\S+$/i.test(v))) return 'url';
  if (vals.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return 'email';
  const parts = vals.flatMap((v) => v.split(/,\s*/));
  const distinct = new Set(vals);
  const distinctParts = new Set(parts);
  if (
    vals.some((v) => v.includes(', ')) &&
    distinctParts.size <= 40 &&
    distinctParts.size < parts.length
  )
    return 'multi_select';
  if (
    distinct.size <= 30 &&
    vals.every((v) => v.length <= 60) &&
    (distinct.size <= 8 || distinct.size * 2 <= vals.length)
  )
    return 'select';
  return 'text';
}

@Injectable()
export class TransferService {
  private readonly logger = new Logger('Transfer');

  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionService,
    private readonly pages: PagesService,
    private readonly databases: DatabasesService,
    private readonly rows: RowsService,
    private readonly files: FilesService,
    private readonly store: DocStore,
    private readonly collab: CollabService,
  ) {}

  // ---------------------------------------------------------------- Import

  async import(
    user: AuthUser,
    workspaceId: string,
    fileName: string,
    data: Buffer,
    opts: { scope: 'TEAM' | 'PRIVATE'; parentId: string | null },
  ): Promise<ImportResultDto> {
    await this.perms.requireMember(user.id, workspaceId);
    if (opts.parentId) {
      const { page } = await this.perms.requireEditablePage(user.id, opts.parentId);
      if (page.workspaceId !== workspaceId) throw new AppError('not_found', 'Seite nicht gefunden');
    }
    const ctx: ImportCtx = {
      user,
      workspaceId,
      scope: opts.scope,
      files: new Map(),
      result: { rootIds: [], pages: 0, databases: 0, rows: 0, images: 0, warnings: [] },
      pageByPath: new Map(),
      imageUrls: new Map(),
    };
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.zip')) this.unzip(data, ctx);
    else if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt'))
      ctx.files.set(posix.basename(fileName).replace(/\.(markdown|txt)$/i, '.md'), data);
    else if (lower.endsWith('.csv')) ctx.files.set(posix.basename(fileName), data);
    else
      throw new AppError(
        'unsupported_media_type',
        'Unterstützt: .md, .csv und .zip (Notion-Export)',
      );

    const tree = this.buildTree(ctx.files);
    if (!tree.roots.length)
      throw new AppError('validation_failed', 'Keine Markdown- oder CSV-Dateien gefunden');
    for (const node of tree.roots) {
      const id = await this.importNode(ctx, tree, node, opts.parentId);
      if (id) ctx.result.rootIds.push(id);
    }
    // Inhalte erst nach allen Seiten schreiben, damit Links zwischen Dateien aufgelöst werden
    for (const job of this.pendingContent) await job();
    this.pendingContent = [];
    this.collab.revalidate();
    return ctx.result;
  }

  private pendingContent: (() => Promise<void>)[] = [];

  private unzip(data: Buffer, ctx: ImportCtx) {
    let entries = 0;
    let total = 0;
    let all: Record<string, Uint8Array>;
    try {
      all = unzipSync(new Uint8Array(data), {
        filter: (f) => {
          entries++;
          total += f.originalSize;
          if (entries > MAX_ENTRIES || total > MAX_UNZIPPED)
            throw new AppError('payload_too_large', 'ZIP enthält zu viele oder zu große Dateien');
          return !f.name.endsWith('/') && !/(^|\/)(__MACOSX|\.DS_Store)/.test(f.name);
        },
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('validation_failed', 'Die ZIP-Datei ist beschädigt');
    }
    // Notion verpackt den Export teils doppelt (ZIP im ZIP)
    const inner = Object.entries(all).filter(([n]) => n.toLowerCase().endsWith('.zip'));
    if (inner.length && Object.keys(all).every((n) => n.toLowerCase().endsWith('.zip'))) {
      for (const [, z] of inner) this.unzip(Buffer.from(z), ctx);
      return;
    }
    // Gemeinsamen obersten Ordner entfernen
    const names = Object.keys(all);
    const top = names[0]?.split('/')[0];
    const strip = top && names.every((n) => n.startsWith(`${top}/`)) ? top.length + 1 : 0;
    for (const [name, content] of Object.entries(all)) {
      const clean = posix.normalize(name.slice(strip));
      if (clean.startsWith('..') || posix.isAbsolute(clean)) continue;
      ctx.files.set(clean, content);
    }
  }

  /** Knoten: Markdown-Seite oder CSV-Datenbank; Kinder liegen im gleichnamigen Ordner. */
  private buildTree(files: Map<string, Uint8Array>) {
    type Node = { key: string; md?: string; csv?: string; children: Node[] };
    const nodes = new Map<string, Node>();
    for (const path of files.keys()) {
      const m = /^(.*)\.(md|csv)$/i.exec(path);
      if (!m) continue;
      let key = m[1]!;
      const isCsv = m[2]!.toLowerCase() === 'csv';
      // Notion: "Titel <id>_all.csv" enthält alle Zeilen, "Titel <id>.csv" nur die Ansicht
      if (isCsv && key.endsWith('_all')) key = key.slice(0, -4);
      const n = nodes.get(key) ?? { key, children: [] };
      if (isCsv) {
        if (!n.csv || m[1]!.endsWith('_all')) n.csv = path;
      } else n.md = path;
      nodes.set(key, n);
    }
    const roots: Node[] = [];
    for (const n of [...nodes.values()].sort((a, b) => a.key.localeCompare(b.key))) {
      const parent = nodes.get(posix.dirname(n.key));
      if (parent && posix.dirname(n.key) !== '.') parent.children.push(n);
      else roots.push(n);
    }
    return { roots, nodes };
  }

  private async importNode(
    ctx: ImportCtx,
    tree: ReturnType<TransferService['buildTree']>,
    node: ReturnType<TransferService['buildTree']>['roots'][number],
    parentId: string | null,
  ): Promise<string | null> {
    if (ctx.result.pages + ctx.result.databases >= MAX_PAGES) {
      if (!ctx.result.warnings.includes('limit'))
        ctx.result.warnings.push(`Höchstens ${MAX_PAGES} Seiten je Import, Rest übersprungen`);
      return null;
    }
    const name = stripId(posix.basename(node.key));
    if (node.csv) {
      const db = await this.importCsv(ctx, node.csv, name, parentId, node.children);
      ctx.pageByPath.set(node.key, db);
      return db;
    }
    const md = strFromU8(ctx.files.get(node.md!)!);
    const first = markdownToPm(md, { titleFromHeading: true });
    const page = await this.pages.create(ctx.user, ctx.workspaceId, {
      title: (first.title ?? name).slice(0, 2000),
      ...(parentId ? { parentId } : { scope: ctx.scope }),
      insertBlock: false,
    });
    ctx.result.pages++;
    ctx.pageByPath.set(node.key, page.id);
    const childIds: string[] = [];
    for (const child of node.children) {
      const id = await this.importNode(ctx, tree, child, page.id);
      if (id) childIds.push(id);
    }
    this.pendingContent.push(async () => {
      const content = await this.markdownContent(ctx, md, node.md!);
      // Unterseiten, auf die der Text nicht verlinkt, als Blöcke anhängen
      const linked = JSON.stringify(content);
      for (const id of childIds)
        if (!linked.includes(id)) content.push({ type: 'subpage', attrs: { pageId: id } });
      await this.writeDoc(page.id, content);
    });
    return page.id;
  }

  /** Markdown einer Datei mit aufgelösten Bildern und Links auf andere importierte Seiten */
  private async markdownContent(ctx: ImportCtx, md: string, path: string): Promise<PmNode[]> {
    const dir = posix.dirname(path);
    const resolve = (src: string) => {
      if (/^[a-z]+:/i.test(src) || src.startsWith('/')) return null;
      try {
        return posix.normalize(posix.join(dir, decodeURIComponent(src)));
      } catch {
        return null;
      }
    };
    // Bilder vorab hochladen (einmal je Datei)
    const wanted = new Set<string>();
    markdownToPm(md, {
      resolveImage: (src) => {
        const p = resolve(src);
        if (p && ctx.files.has(p) && IMAGE_EXT.test(p)) wanted.add(p);
        return null;
      },
    });
    for (const p of wanted) {
      if (ctx.imageUrls.has(p)) continue;
      try {
        const f = await this.files.uploadImage(
          ctx.user,
          ctx.workspaceId,
          Buffer.from(ctx.files.get(p)!),
          posix.basename(p),
        );
        ctx.imageUrls.set(p, f.url);
        ctx.result.images++;
      } catch (err) {
        ctx.imageUrls.set(p, null);
        ctx.result.warnings.push(
          `Bild ${posix.basename(p)} übersprungen: ${(err as Error).message}`,
        );
      }
    }
    return markdownToPm(md, {
      titleFromHeading: true,
      resolveImage: (src) => {
        const p = resolve(src);
        if (p) return ctx.imageUrls.get(p) ?? null;
        return /^https?:/i.test(src) ? src : null;
      },
      resolveLink: (href) => {
        const p = resolve(href);
        const target = p ? ctx.pageByPath.get(p.replace(/\.(md|csv)$/i, '')) : undefined;
        if (target) return `/w/${ctx.workspaceId}/p/${target}`;
        return href;
      },
    }).content;
  }

  private async importCsv(
    ctx: ImportCtx,
    path: string,
    name: string,
    parentId: string | null,
    rowNodes: ReturnType<TransferService['buildTree']>['roots'],
  ): Promise<string> {
    const table = parseCsv(strFromU8(ctx.files.get(path)!), MAX_CSV_ROWS);
    if (!table.length)
      throw new AppError('validation_failed', `${posix.basename(path)}: leere CSV-Datei`);
    if (table.length > MAX_CSV_ROWS + 1)
      ctx.result.warnings.push(`${name}: nur die ersten ${MAX_CSV_ROWS} Zeilen`);
    const header = table[0]!.map((h, i) => h.trim() || `Spalte ${i + 1}`);
    const body = table.slice(1, MAX_CSV_ROWS + 1);
    const titleIdx = Math.max(
      0,
      header.findIndex((h) => /^(name|title|titel|aufgabe)$/i.test(h)),
    );

    const db: DatabaseDto = await this.databases.create(ctx.user, ctx.workspaceId, {
      title: name,
      ...(parentId ? { parentId } : { scope: ctx.scope }),
      inline: false,
      insertBlock: false,
    });
    ctx.result.databases++;
    const titleProp = db.properties.find((p) => p.type === 'title')!;
    await this.databases.updateProperty(ctx.user, db.id, titleProp.id, {
      name: header[titleIdx]!.slice(0, 200),
    });
    // Standard-Spalte "Tags" entfernen: Spalten kommen aus der CSV
    for (const p of db.properties.filter((x) => x.type !== 'title'))
      await this.databases.deleteProperty(ctx.user, db.id, p.id);

    const columns: {
      idx: number;
      prop: PropertyDto;
      type: ColumnType;
      options: Map<string, string>;
    }[] = [];
    const used = new Set([header[titleIdx]!.toLowerCase()]);
    for (let i = 0; i < header.length; i++) {
      if (i === titleIdx) continue;
      let colName = header[i]!.slice(0, 200);
      while (used.has(colName.toLowerCase())) colName = `${colName} (2)`;
      used.add(colName.toLowerCase());
      const values = body.map((r) => r[i] ?? '');
      const type = inferColumn(values);
      const options = new Map<string, string>();
      if (type === 'select' || type === 'multi_select') {
        const names = new Set(
          values
            .flatMap((v) => (type === 'multi_select' ? v.split(/,\s*/) : [v]))
            .map((v) => v.trim())
            .filter(Boolean),
        );
        [...names].slice(0, 100).forEach((n) => options.set(n, randomUUID()));
      }
      const prop = await this.databases.createProperty(ctx.user, db.id, {
        name: colName,
        type,
        ...(options.size
          ? {
              config: {
                options: [...options].map(([n, id], k) => ({
                  id,
                  name: n.slice(0, 100),
                  color: OPTION_COLORS[(k % (OPTION_COLORS.length - 1)) + 1],
                })),
              },
            }
          : {}),
      });
      columns.push({ idx: i, prop, type, options });
    }

    // Zeilen-Seiten (Notion: Markdown je Zeile im gleichnamigen Ordner) nach Titel zuordnen
    const rowPages = new Map<string, string>();
    for (const n of rowNodes)
      if (n.md) rowPages.set(stripId(posix.basename(n.key)).toLowerCase(), n.md);

    for (const r of body) {
      const values: Record<string, unknown> = {};
      for (const c of columns) {
        const raw = (r[c.idx] ?? '').trim();
        const v = this.cellValue(c.type, raw, c.options);
        if (v !== null) values[c.prop.id] = v;
      }
      const title = (r[titleIdx] ?? '').trim().slice(0, 2000);
      const row: RowDto = await this.rows.create(ctx.user, db.id, {
        title,
        values,
        templateId: 'none',
      });
      ctx.result.rows++;
      const mdPath = rowPages.get(title.toLowerCase());
      if (mdPath) {
        const md = strFromU8(ctx.files.get(mdPath)!);
        ctx.pageByPath.set(mdPath.replace(/\.md$/i, ''), row.id);
        this.pendingContent.push(async () => {
          // Notion schreibt die Eigenschaften der Zeile an den Anfang: nur Text nach der Tabelle
          const content = await this.markdownContent(ctx, stripRowProperties(md), mdPath);
          if (content.length) await this.writeDoc(row.id, content);
        });
      }
    }
    return db.id;
  }

  private cellValue(type: ColumnType, raw: string, options: Map<string, string>): unknown {
    if (!raw) return type === 'checkbox' ? false : null;
    switch (type) {
      case 'number': {
        const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
        return Number.isFinite(n) ? n : null;
      }
      case 'checkbox':
        return TRUE_WORDS.has(raw.toLowerCase());
      case 'date': {
        const d = parseDate(raw);
        return d ? { start: d.start, end: null, hasTime: d.hasTime, timeZone: null } : null;
      }
      case 'select':
        return options.get(raw) ?? null;
      case 'multi_select':
        return raw
          .split(/,\s*/)
          .map((v) => options.get(v.trim()))
          .filter(Boolean);
      default:
        return raw.slice(0, 2000);
    }
  }

  /** Inhalt einer neuen Seite schreiben (wie bei Vorlagen) */
  private async writeDoc(pageId: string, nodes: PmNode[]) {
    if (!nodes.length) return;
    const doc = await this.store.loadDoc(pageId);
    appendPmContent(doc, nodes, () => randomUUID());
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
  }

  // ---------------------------------------------------------------- Export

  /** Seite samt Unterseiten als ZIP (Markdown oder HTML, Bilder als Dateien, Datenbanken als CSV) */
  async exportPage(user: AuthUser, pageId: string, format: 'markdown' | 'html') {
    const { page: root } = await this.perms.requirePage(user.id, pageId);
    const zip: Zippable = {};
    const ext = format === 'html' ? 'html' : 'md';
    const used = new Set<string>();
    const fileName = (dir: string, base: string, e: string) => {
      const safe = (base.replace(/[\\/:*?"<>|]|\p{Cc}/gu, '_').trim() || 'Ohne Titel').slice(
        0,
        80,
      );
      let n = `${dir}${safe}.${e}`;
      for (let i = 2; used.has(n.toLowerCase()); i++) n = `${dir}${safe} (${i}).${e}`;
      used.add(n.toLowerCase());
      return n;
    };
    // Sichtbarer Teilbaum (Rechte je Seite)
    const subtree = await this.prisma.client.$queryRaw<Pick<Page, 'id' | 'title' | 'kind'>[]>`
      SELECT p.id::text AS id, p.title, p.kind FROM pages p
       WHERE p.path <@ (SELECT path FROM pages WHERE id = ${root.id}::uuid)
         AND p.deleted_at IS NULL AND p.kind IN ('PAGE', 'DATABASE')
         AND ${PermissionService.visibleSql(user.id)}
       ORDER BY nlevel(p.path), p.position LIMIT ${MAX_EXPORT_PAGES}`;
    const byId = new Map(subtree.map((p) => [p.id, p]));
    const paths = new Map<string, string>();
    const parents = await this.prisma.client.page.findMany({
      where: { id: { in: [...byId.keys()] } },
      select: { id: true, parentId: true },
    });
    const parentOf = new Map(parents.map((p) => [p.id, p.parentId]));
    for (const p of subtree) {
      const parentPath = p.id === root.id ? '' : (paths.get(parentOf.get(p.id) ?? '') ?? '');
      const dir = parentPath ? `${parentPath.replace(/\.(md|html|csv)$/, '')}/` : '';
      paths.set(p.id, fileName(dir, p.title, p.kind === 'DATABASE' ? 'csv' : ext));
    }
    const media = new Map<string, string>();
    for (const p of subtree) {
      const path = paths.get(p.id)!;
      if (p.kind === 'DATABASE') {
        zip[path] = new TextEncoder().encode(await this.databaseCsv(user, p.id));
        continue;
      }
      const doc = await this.store.loadDoc(p.id);
      const content = (docToJson(doc).content ?? []) as PmNode[];
      doc.destroy();
      const rel = (target: string) =>
        posix.relative(posix.dirname(path), target) || posix.basename(target);
      const o = {
        pageLink: (id: string) => {
          const t = byId.get(id);
          const target = paths.get(id);
          return t && target
            ? { title: t.title || 'Ohne Titel', href: encodeURI(rel(target)) }
            : null;
        },
        mediaSrc: (src: string) => {
          const m = /^\/api\/files\/([0-9a-f-]{36})/.exec(src);
          if (!m) return src;
          if (!media.has(m[1]!)) media.set(m[1]!, `_dateien/${m[1]}`);
          return encodeURI(rel(media.get(m[1]!)!));
        },
      };
      const text =
        format === 'html' ? pmToHtml(p.title, content, o) : pmToMarkdown(p.title, content, o);
      zip[path] = new TextEncoder().encode(text);
    }
    // Eingebettete Dateien des Workspace beilegen
    if (media.size) {
      const rows = await this.prisma.client.file.findMany({
        where: { id: { in: [...media.keys()] }, workspaceId: root.workspaceId },
      });
      for (const f of rows) {
        const chunks: Buffer[] = [];
        for await (const c of await this.files.storage.get(f.storageKey)) chunks.push(c as Buffer);
        const ext2 = f.originalName?.split('.').pop() ?? f.mime.split('/')[1] ?? 'bin';
        const target = `${media.get(f.id)!}.${ext2}`;
        zip[target] = new Uint8Array(Buffer.concat(chunks));
        // Pfade im Text ohne Endung: auf die Datei mit Endung umschreiben
        for (const [k, v] of Object.entries(zip)) {
          if (!(v instanceof Uint8Array) || !/\.(md|html)$/.test(k)) continue;
          const s = new TextDecoder().decode(v);
          const relTarget = encodeURI(posix.relative(posix.dirname(k), media.get(f.id)!));
          if (s.includes(relTarget))
            zip[k] = new TextEncoder().encode(s.split(relTarget).join(`${relTarget}.${ext2}`));
        }
      }
    }
    const name = `${(root.title || 'Ohne Titel').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}.zip`;
    return { name, data: Buffer.from(zipSync(zip, { level: 6 })) };
  }

  /** Alle Zeilen einer Datenbank als CSV (Werte als Text wie in der Tabelle) */
  async databaseCsv(user: AuthUser, databaseId: string): Promise<string> {
    const db = await this.databases.get(user, databaseId);
    const props = db.properties.filter((p) => p.type !== 'button');
    const titleProp = props.find((p) => p.type === 'title');
    const others = props.filter((p) => p.type !== 'title');
    const lines: string[][] = [[titleProp?.name ?? 'Name', ...others.map((p) => p.name)]];
    let cursor: string | null = null;
    for (let page = 0; page < 500; page++) {
      const res = await this.rows.query(user, databaseId, { limit: 200, cursor });
      for (const r of res.rows)
        lines.push([r.title, ...others.map((p) => this.formatValue(p, r.values[p.id], r))]);
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    return toCsv(lines);
  }

  private formatValue(p: PropertyDto, v: unknown, row: RowDto): string {
    if (v === null || v === undefined) return '';
    const opts = (p.config as { options?: { id: string; name: string }[] }).options ?? [];
    const opt = (id: unknown) => opts.find((o) => o.id === id)?.name ?? '';
    switch (p.type) {
      case 'select':
      case 'status':
        return opt(v);
      case 'multi_select':
        return (v as string[]).map(opt).filter(Boolean).join(', ');
      case 'checkbox':
        return v ? 'Ja' : 'Nein';
      case 'date': {
        const d = v as { start: string; end: string | null };
        return d.end ? `${d.start} → ${d.end}` : d.start;
      }
      case 'relation':
        return (v as string[]).map((id) => row.refs?.[id]?.title ?? id).join(', ');
      case 'person':
      case 'files':
        return Array.isArray(v)
          ? v
              .map((x) =>
                typeof x === 'object' && x && 'name' in x
                  ? String((x as { name: unknown }).name)
                  : String(x),
              )
              .join(', ')
          : String(v);
      default:
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  }
}

/** Notion-Zeilenseite: Titel und "Eigenschaft: Wert"-Zeilen am Anfang entfernen */
function stripRowProperties(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  if (lines[i]?.startsWith('# ')) i++;
  while (i < lines.length && (lines[i]!.trim() === '' || /^[^:\n]{1,60}:\s/.test(lines[i]!))) i++;
  return lines.slice(i).join('\n');
}
