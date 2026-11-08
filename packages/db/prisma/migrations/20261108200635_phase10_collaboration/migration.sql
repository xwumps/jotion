-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('full', 'edit', 'comment', 'view', 'none');

-- AlterEnum
ALTER TYPE "PageKind" ADD VALUE 'SYNCED_BLOCK';



-- CreateTable
CREATE TABLE "page_permissions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "user_id" UUID,
    "level" "PermissionLevel" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "page_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_share_links" (
    "page_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_share_links_pkey" PRIMARY KEY ("page_id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "block_id" TEXT,
    "quote" TEXT,
    "body" TEXT NOT NULL,
    "mentions" UUID[],
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "page_id" UUID,
    "comment_id" UUID,
    "actor_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_snapshots" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "state" BYTEA NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT 'auto',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_permissions_workspace_id_idx" ON "page_permissions"("workspace_id");

-- CreateIndex
CREATE INDEX "page_permissions_page_id_idx" ON "page_permissions"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_share_links_token_key" ON "page_share_links"("token");

-- CreateIndex
CREATE INDEX "comments_page_id_thread_id_created_at_idx" ON "comments"("page_id", "thread_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_workspace_id_created_at_idx" ON "notifications"("user_id", "workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "page_snapshots_page_id_created_at_idx" ON "page_snapshots"("page_id", "created_at");

-- AddForeignKey
ALTER TABLE "page_permissions" ADD CONSTRAINT "page_permissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 10: eine Angabe je Seite und Mitglied; "alle Mitglieder" (user_id NULL) ebenfalls nur einmal
CREATE UNIQUE INDEX "page_permissions_page_user_key" ON "page_permissions" ("page_id", "user_id") NULLS NOT DISTINCT;

-- Phase 10: Zugriffsstufe eines Nutzers auf eine Seite. Einzige Quelle der Regeln für SQL und Code:
--  1. Workspace-Owner: volle Rechte auf Team-Seiten
--  2. Owner einer privaten Seite: volle Rechte (kann sich nicht aussperren)
--  3. Die nächstgelegene Angabe auf der Seite oder einer Elternseite gewinnt; auf derselben Ebene
--     gilt die Angabe für den Nutzer vor der für alle Mitglieder (nur bei Team-Seiten)
--  4. Sonst: Team-Seiten volle Rechte für alle Mitglieder, private Seiten kein Zugriff
-- Mitgliedschaft im Workspace prüft der Aufrufer.
CREATE OR REPLACE FUNCTION jotion_page_level(p_path ltree, p_scope "PageScope", p_owner uuid, p_workspace uuid, p_user uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    CASE WHEN p_scope = 'TEAM' AND EXISTS (
      SELECT 1 FROM workspace_members m
       WHERE m.workspace_id = p_workspace AND m.user_id = p_user AND m.role = 'OWNER') THEN 'full' END,
    CASE WHEN p_scope = 'PRIVATE' AND p_owner = p_user THEN 'full' END,
    (SELECT pp.level::text
       FROM page_permissions pp JOIN pages a ON a.id = pp.page_id
      WHERE pp.workspace_id = p_workspace
        AND a.path @> p_path
        AND (pp.user_id = p_user OR (pp.user_id IS NULL AND p_scope = 'TEAM'))
      ORDER BY nlevel(a.path) DESC, (pp.user_id IS NULL) ASC
      LIMIT 1),
    CASE WHEN p_scope = 'TEAM' THEN 'full' ELSE 'none' END)
$$;

-- Rang einer Stufe (für Vergleiche: mindestens "view" usw.)
CREATE OR REPLACE FUNCTION jotion_level_rank(level text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE level WHEN 'full' THEN 4 WHEN 'edit' THEN 3 WHEN 'comment' THEN 2 WHEN 'view' THEN 1 ELSE 0 END
$$;
