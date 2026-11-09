import { z } from 'zod';
import type { PageIcon } from './contracts';
import type { PageContentDto } from './contracts-content';

/** Phase 10: Zugriffsstufen, Teilen, Lese-Links. */

export const PERMISSION_LEVELS = ['full', 'edit', 'comment', 'view', 'none'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** Rang für Vergleiche ("mindestens bearbeiten") */
export const LEVEL_RANK: Record<PermissionLevel, number> = {
  none: 0,
  view: 1,
  comment: 2,
  edit: 3,
  full: 4,
};

export const atLeastLevel = (level: PermissionLevel, required: PermissionLevel) =>
  LEVEL_RANK[level] >= LEVEL_RANK[required];

export const setPermissionSchema = z
  .object({
    /** Mitglied; null = alle Mitglieder des Workspace (nur Team-Seiten) */
    userId: z.uuid().nullable(),
    /** null entfernt die Angabe (dann gilt die geerbte Stufe) */
    level: z.enum(PERMISSION_LEVELS).nullable(),
  })
  .strict();

export interface PermissionEntryDto {
  userId: string | null;
  name: string | null;
  email: string | null;
  level: PermissionLevel;
  /** Seite, auf der die Angabe steht (bei geerbten die Elternseite) */
  sourcePageId: string;
  sourceTitle: string;
  inherited: boolean;
}

export interface SharingDto {
  pageId: string;
  scope: 'PRIVATE' | 'TEAM';
  /** Stufe des aktuellen Nutzers */
  myLevel: PermissionLevel;
  canManage: boolean;
  /** Stufe für alle Mitglieder (Team-Seiten) */
  general: PermissionLevel;
  entries: PermissionEntryDto[];
  /** Effektive Stufe je Mitglied */
  members: {
    userId: string;
    name: string;
    email: string;
    level: PermissionLevel;
    /** Stufe lässt sich nicht ändern (Workspace-Owner auf Team-Seiten, Owner privater Seiten) */
    fixed: boolean;
  }[];
  shareLink: { token: string; url: string } | null;
}

/** Öffentliche Leseansicht über einen Lese-Link */
export interface PublicPageDto {
  /** Geteilte Seite (Einstieg); Unterseiten sind über ?page= erreichbar */
  rootId: string;
  page: {
    id: string;
    title: string;
    icon: PageIcon | null;
    kind: 'PAGE' | 'DATABASE';
    /** Elternseite innerhalb des geteilten Bereichs (null auf der Einstiegsseite) */
    parentId: string | null;
  };
  doc: PageContentDto['doc'];
  children: { id: string; title: string; icon: PageIcon | null }[];
}

/** Phase 10: Synced Block (Inhalt in eigener Seite unter der Ursprungsseite) */
export interface SyncedBlockInfoDto {
  pageId: string;
  originId: string;
  originTitle: string;
  canEdit: boolean;
}

/** Phase 10: Seite samt Unterseiten in einen anderen Workspace verschieben */
export const moveToWorkspaceSchema = z
  .object({
    workspaceId: z.uuid(),
    scope: z.enum(['PRIVATE', 'TEAM']).default('PRIVATE'),
  })
  .strict();

// ---------------------------------------------------------------- Phase 12: API-Tokens

export const API_TOKEN_SCOPES = ['read', 'write'] as const;

export const createApiTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    scope: z.enum(API_TOKEN_SCOPES).default('read'),
    /** Gültigkeit in Tagen; ohne Angabe unbegrenzt */
    expiresInDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

export interface ApiTokenDto {
  id: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write';
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Nur direkt nach dem Anlegen: das vollständige Token */
export interface CreatedApiTokenDto extends ApiTokenDto {
  token: string;
}

// ---------------------------------------------------------------- Phase 12: Admin-Bereich

export interface AdminBackupDto {
  name: string;
  size: number;
  createdAt: string;
  trigger: string;
}

export interface AdminStatusDto {
  version: string;
  uptimeSeconds: number;
  checks: Record<string, { status: 'ok' | 'error'; message?: string }>;
  counts: { users: number; workspaces: number; pages: number; databases: number; files: number };
  storage: { filesBytes: number; databaseBytes: number };
  backups: {
    available: boolean;
    last: { at: string; ok: boolean; file?: string; error?: string } | null;
    requested: boolean;
    list: AdminBackupDto[];
  };
}

export interface AdminUserDto {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  workspaces: number;
}

export const updateAdminUserSchema = z
  .object({ isAdmin: z.boolean().optional(), disabled: z.boolean().optional() })
  .strict();
