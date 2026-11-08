/**
 * API-Verträge zwischen web und api (Zod-Schemas + abgeleitete Typen).
 * Eingaben werden in der API mit diesen Schemas validiert, die Oberfläche nutzt dieselben Typen.
 */
import { z } from 'zod';

export const uuid = z.uuid();

// ---------- Fehler ----------
export const ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'setup_required',
  'already_set_up',
  'invalid_credentials',
  'token_invalid',
  'cycle',
  'payload_too_large',
  'unsupported_media_type',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface ApiError {
  error: { code: ErrorCode; message: string; details?: unknown };
}

// ---------- Auth ----------
export const PASSWORD_MIN_LENGTH = 10;
// Erst normalisieren (Leerzeichen, Großschreibung), dann Format prüfen
const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Ungültige E-Mail-Adresse'));
const password = z.string().min(PASSWORD_MIN_LENGTH).max(256);
const displayName = z.string().trim().min(1).max(100);

export const setupSchema = z.object({
  name: displayName,
  email,
  password,
  workspaceName: z.string().trim().min(1).max(100),
});
export type SetupInput = z.input<typeof setupSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1).max(256) });
export type LoginInput = z.input<typeof loginSchema>;

export const registerWithInviteSchema = z.object({
  token: z.string().min(20).max(200),
  name: displayName,
  email,
  password,
});
export type RegisterWithInviteInput = z.input<typeof registerWithInviteSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: password,
});
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: password,
});
export const updateProfileSchema = z.object({
  name: displayName.optional(),
  locale: z.enum(['de', 'en']).nullable().optional(),
});

export interface UserDto {
  id: string;
  email: string;
  name: string;
  locale: string | null;
}

export interface WorkspaceSummaryDto {
  id: string;
  name: string;
  icon: PageIcon | null;
  role: WorkspaceRole;
}

export interface MeDto {
  user: UserDto;
  workspaces: WorkspaceSummaryDto[];
}

export interface SetupStatusDto {
  setupRequired: boolean;
}

// ---------- Workspaces ----------
export const WORKSPACE_ROLES = ['OWNER', 'MEMBER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const pageIconSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('emoji'), value: z.string().min(1).max(16) }),
  z.object({ type: z.literal('file'), fileId: uuid }),
]);
export type PageIcon = z.infer<typeof pageIconSchema>;

export const COVER_GRADIENTS = ['sunrise', 'ocean', 'forest', 'dusk', 'sand', 'slate'] as const;
export const pageCoverSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('gradient'), value: z.enum(COVER_GRADIENTS) }),
  z.object({
    type: z.literal('file'),
    fileId: uuid,
    positionY: z.number().min(0).max(100).default(50),
  }),
]);
export type PageCover = z.infer<typeof pageCoverSchema>;

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  icon: pageIconSchema.nullable().optional(),
});
export const updateWorkspaceSchema = createWorkspaceSchema.partial();

export const createInvitationSchema = z.object({
  role: z.enum(WORKSPACE_ROLES).default('MEMBER'),
  note: z.string().trim().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
  maxUses: z.number().int().min(1).max(50).default(1),
});

export const updateMemberSchema = z.object({ role: z.enum(WORKSPACE_ROLES) });

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface InvitationDto {
  id: string;
  role: WorkspaceRole;
  note: string | null;
  expiresAt: string;
  maxUses: number;
  uses: number;
  createdAt: string;
  /** nur direkt nach dem Erstellen enthalten */
  url?: string;
}

export interface InvitationPreviewDto {
  workspaceName: string;
  role: WorkspaceRole;
}

export interface ResetLinkDto {
  url: string;
  expiresAt: string;
}

// ---------- Pages ----------
export const PAGE_SCOPES = ['PRIVATE', 'TEAM'] as const;
export type PageScope = (typeof PAGE_SCOPES)[number];
export const PAGE_TITLE_MAX = 2000;

export const pageSettingsSchema = z
  .object({
    font: z.enum(['default', 'serif', 'mono']).optional(),
    smallText: z.boolean().optional(),
    fullWidth: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .strict();
export type PageSettings = z.infer<typeof pageSettingsSchema>;

/** Platzierung: unter parentId, zwischen afterId und beforeId (beide optional). */
const placement = {
  parentId: uuid.nullable().optional(),
  scope: z.enum(PAGE_SCOPES).optional(),
  afterId: uuid.nullable().optional(),
  beforeId: uuid.nullable().optional(),
};

export const createPageSchema = z.object({
  ...placement,
  title: z.string().max(PAGE_TITLE_MAX).optional(),
  icon: pageIconSchema.nullable().optional(),
  /** false, wenn der Editor den Unterseiten-Block selbst an der Cursorposition einfügt */
  insertBlock: z.boolean().default(true),
});
export type CreatePageInput = z.input<typeof createPageSchema>;

export const updatePageSchema = z.object({
  title: z.string().max(PAGE_TITLE_MAX).optional(),
  icon: pageIconSchema.nullable().optional(),
  cover: pageCoverSchema.nullable().optional(),
  settings: pageSettingsSchema.optional(),
});
export type UpdatePageInput = z.input<typeof updatePageSchema>;

export const movePageSchema = z.object(placement);
export type MovePageInput = z.input<typeof movePageSchema>;

export interface PageTreeNodeDto {
  id: string;
  parentId: string | null;
  position: string;
  title: string;
  icon: PageIcon | null;
  scope: PageScope;
  hasChildren: boolean;
}

export interface BreadcrumbDto {
  id: string;
  title: string;
  icon: PageIcon | null;
}

export interface PageDto extends PageTreeNodeDto {
  workspaceId: string;
  cover: PageCover | null;
  settings: PageSettings;
  ownerId: string;
  createdBy: { id: string; name: string };
  lastEditedBy: { id: string; name: string };
  createdAt: string;
  lastEditedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  isFavorite: boolean;
  breadcrumbs: BreadcrumbDto[];
  /** Rechte des aktuellen Nutzers auf dieser Seite */
  canEdit: boolean;
  /** Phase 4: Seite, Datenbank oder Datenbankzeile (databaseId bei Zeilen) */
  kind: 'PAGE' | 'DATABASE' | 'DATABASE_ROW' | 'ROW_TEMPLATE';
  /** Phase 9: eigene Vorlage (Galerie) */
  isTemplate: boolean;
  databaseId: string | null;
}

/** Kompakte Seiteninfo für Verweise im Editor (ohne Besuch zu zählen). */
export interface PageSummaryDto {
  id: string;
  title: string;
  icon: PageIcon | null;
  archived: boolean;
  deleted: boolean;
}

export interface SearchResultDto {
  id: string;
  title: string;
  icon: PageIcon | null;
  /** Titel der Vorfahren, z. B. "Projekt / Planung" */
  path: string;
  lastEditedAt: string;
}

export interface TrashItemDto {
  id: string;
  title: string;
  icon: PageIcon | null;
  deletedAt: string;
  deletedBy: string | null;
  /** Titel der Elternseite, falls vorhanden */
  parentTitle: string | null;
  canDeletePermanently: boolean;
}

export interface RecentPageDto {
  id: string;
  title: string;
  icon: PageIcon | null;
  visitedAt: string;
}

export interface FavoriteDto {
  id: string;
  title: string;
  icon: PageIcon | null;
  position: string;
  hasChildren: boolean;
}

export const reorderFavoriteSchema = z.object({
  afterId: uuid.nullable().optional(),
  beforeId: uuid.nullable().optional(),
});

// ---------- Dateien ----------
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export interface FileDto {
  id: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
}

// ---------- Realtime ----------
export const REALTIME_EVENT_TYPES = [
  'page.created',
  'page.updated',
  'page.moved',
  'page.trashed',
  'page.restored',
  'page.deleted',
  'page.archived',
  'workspace.updated',
  'members.changed',
  'database.changed',
  'database.rows.changed',
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];
export interface RealtimeEvent {
  id: string;
  type: RealtimeEventType;
  entityId: string;
  payload: Record<string, unknown>;
  actorId: string | null;
}
