/**
 * Phase 3: Verträge für erweiterte Inhalte (Uploads, Link-Vorschau, Volltextsuche,
 * Erwähnungen, Duplizieren, Druckansicht).
 */
import { z } from 'zod';
import type { FileDto, PageIcon, SearchResultDto } from './contracts';

// ---------- Uploads ----------
/** Standardgrenze für allgemeine Dateien (Video, Audio, PDF, sonstige). Per ENV änderbar. */
export const DEFAULT_MAX_FILE_UPLOAD_MB = 100;

export const UPLOAD_KINDS = ['image', 'video', 'audio', 'pdf', 'file'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export interface UploadedFileDto extends FileDto {
  kind: UploadKind;
  /** Ursprünglicher Dateiname (nur Anzeige) */
  name: string | null;
}

// ---------- Link-Vorschau (Bookmark) ----------
export const linkPreviewQuerySchema = z.object({ url: z.string().trim().min(1).max(2048) });

export interface LinkPreviewDto {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
}

// ---------- Volltextsuche ----------
export const SEARCH_SORTS = ['relevance', 'edited'] as const;
const isoDate = z.iso.date();
const boolParam = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const contentSearchQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  /** private: nur eigene private Seiten, team: nur Teamseiten */
  scope: z.enum(['all', 'private', 'team']).default('all'),
  createdBy: z.uuid().optional(),
  /** Nur Seiten unterhalb dieser Seite (einschließlich) */
  parentId: z.uuid().optional(),
  editedAfter: isoDate.optional(),
  editedBefore: isoDate.optional(),
  titleOnly: boolParam.default(false),
  sort: z.enum(SEARCH_SORTS).default('relevance'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ContentSearchQuery = z.input<typeof contentSearchQuerySchema>;

export interface ContentSearchResultDto extends SearchResultDto {
  /** Fundstelle im Inhalt (null bei reinem Titeltreffer) */
  blockId: string | null;
  /** Textausschnitt um die Fundstelle */
  snippet: string | null;
  /** Bereiche im Ausschnitt, die hervorgehoben werden [Start, Ende) */
  highlights: [number, number][];
  archived: boolean;
}

// ---------- Erwähnungen ----------
export interface MentionUserDto {
  id: string;
  name: string;
}

export interface MentionCandidatesDto {
  users: MentionUserDto[];
  pages: SearchResultDto[];
}

// ---------- Druckansicht ----------
export interface PageContentDto {
  pageId: string;
  /** ProseMirror-JSON des Inhalts */
  doc: { type: 'doc'; content?: unknown[] };
}

// ---------- Duplizieren ----------
/** Höchstzahl Seiten (inklusive Unterseiten), die in einem Schritt dupliziert werden */
export const MAX_DUPLICATE_PAGES = 500;

export interface DuplicateResultDto {
  id: string;
  title: string;
  icon: PageIcon | null;
  /** Anzahl kopierter Seiten (inklusive Unterseiten) */
  pages: number;
}
