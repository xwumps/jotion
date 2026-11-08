import { z } from 'zod';

/** Phase 10: Kommentare, Posteingang und Benachrichtigungen. */

const id = z.uuid();

export const MAX_COMMENT_LENGTH = 5000;

export const createCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
    /** Antwort auf einen bestehenden Thread */
    threadId: id.optional(),
    /** Block, an dem ein neuer Thread hängt (ohne Angabe: Seitenkommentar) */
    blockId: z.string().min(1).max(100).optional(),
    /** Markierter Text beim Anlegen */
    quote: z.string().max(500).optional(),
    /** Erwähnte Mitglieder (im Text als @Name) */
    mentions: z.array(id).max(20).default([]),
  })
  .strict();

export const updateCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
    mentions: z.array(id).max(20).default([]),
  })
  .strict();

export const resolveThreadSchema = z.object({ resolved: z.boolean() }).strict();

export interface CommentDto {
  id: string;
  threadId: string;
  body: string;
  mentions: { id: string; name: string }[];
  author: { id: string; name: string };
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

export interface CommentThreadDto {
  id: string;
  pageId: string;
  blockId: string | null;
  quote: string | null;
  resolvedAt: string | null;
  resolvedBy: { id: string; name: string } | null;
  comments: CommentDto[];
}

export interface PageCommentsDto {
  threads: CommentThreadDto[];
  /** Darf der Nutzer kommentieren (Stufe mindestens "kommentieren") */
  canComment: boolean;
}

export const NOTIFICATION_TYPES = ['mention_page', 'mention_comment', 'reply', 'comment'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationDto {
  id: string;
  type: NotificationType;
  page: { id: string; title: string } | null;
  actor: { id: string; name: string } | null;
  /** Block (Erwähnung in der Seite) oder Thread (Kommentar) zum Anspringen */
  blockId: string | null;
  threadId: string | null;
  excerpt: string;
  readAt: string | null;
  createdAt: string;
}

export interface InboxDto {
  items: NotificationDto[];
  unread: number;
}

export const markReadSchema = z
  .object({
    ids: z.array(id).max(200).optional(),
    all: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------- Seitenhistorie

export interface PageVersionDto {
  id: string;
  title: string;
  /** auto: beim Bearbeiten, restore: Stand vor einer Wiederherstellung */
  reason: 'auto' | 'restore';
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export type BlockDiffStatus = 'added' | 'removed' | 'changed' | 'same';

export interface BlockDiffDto {
  id: string;
  type: string;
  status: BlockDiffStatus;
  /** Text in dieser Version */
  text: string;
  /** Text im Vergleichsstand (bei changed und removed) */
  before: string | null;
}

export interface PageVersionDetailDto {
  version: PageVersionDto;
  /** Inhalt der Version als ProseMirror-JSON */
  doc: { type: string; content?: unknown[] };
  /** Vergleich mit der vorherigen Version (älteste: mit leerem Dokument) */
  diff: BlockDiffDto[];
}
