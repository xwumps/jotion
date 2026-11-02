-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "PageScope" AS ENUM ('PRIVATE', 'TEAM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "locale" TEXT,
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_by_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id","user_id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "parent_id" UUID,
    "path" ltree NOT NULL DEFAULT ''::ltree,
    "position" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "icon" JSONB,
    "cover" JSONB,
    "scope" "PageScope" NOT NULL DEFAULT 'TEAM',
    "owner_id" UUID NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID NOT NULL,
    "last_edited_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_edited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,
    "trash_root_id" UUID,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "user_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "position" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id","page_id")
);

-- CreateTable
CREATE TABLE "page_visits" (
    "user_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "visited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_visits_pkey" PRIMARY KEY ("user_id","page_id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "original_name" TEXT,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_events" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "audience_user_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "change_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_workspace_id_idx" ON "invitations"("workspace_id");

-- CreateIndex
CREATE INDEX "pages_workspace_id_parent_id_position_idx" ON "pages"("workspace_id", "parent_id", "position");

-- CreateIndex
CREATE INDEX "pages_workspace_id_deleted_at_idx" ON "pages"("workspace_id", "deleted_at");

-- CreateIndex
CREATE INDEX "pages_trash_root_id_idx" ON "pages"("trash_root_id");

-- CreateIndex
CREATE INDEX "page_visits_user_id_visited_at_idx" ON "page_visits"("user_id", "visited_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_workspace_id_idx" ON "files"("workspace_id");

-- CreateIndex
CREATE INDEX "change_events_published_at_id_idx" ON "change_events"("published_at", "id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_visits" ADD CONSTRAINT "page_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_visits" ADD CONSTRAINT "page_visits_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Seitenbaum: path (ltree) und scope werden ausschließlich hier gepflegt.
-- Label je Ebene = UUID ohne Bindestriche (ltree erlaubt nur [A-Za-z0-9_]).
-- ---------------------------------------------------------------------------

CREATE INDEX "pages_path_gist_idx" ON "pages" USING GIST ("path");

CREATE FUNCTION jotion_page_label(id uuid) RETURNS ltree
  LANGUAGE sql IMMUTABLE AS $$ SELECT text2ltree(replace(id::text, '-', '')) $$;

-- Vor INSERT/UPDATE: Pfad aus Elternteil ableiten, Zyklen und Workspace-Wechsel verhindern,
-- Scope und Owner von der Elternseite übernehmen.
CREATE FUNCTION jotion_pages_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_row pages%ROWTYPE;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := jotion_page_label(NEW.id);
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'page cannot be its own parent' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'pages_no_cycle';
  END IF;

  SELECT * INTO parent_row FROM pages WHERE id = NEW.parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent page % not found', NEW.parent_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF parent_row.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'parent page belongs to another workspace' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'pages_same_workspace';
  END IF;

  -- Elternteil darf nicht im eigenen Teilbaum liegen
  IF TG_OP = 'UPDATE' AND parent_row.path <@ OLD.path THEN
    RAISE EXCEPTION 'cannot move a page into its own subtree' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'pages_no_cycle';
  END IF;

  NEW.path := parent_row.path || jotion_page_label(NEW.id);
  NEW.scope := parent_row.scope;
  NEW.owner_id := parent_row.owner_id;
  RETURN NEW;
END $$;

CREATE TRIGGER pages_before_write
  BEFORE INSERT OR UPDATE OF parent_id, scope, owner_id, workspace_id ON pages
  FOR EACH ROW EXECUTE FUNCTION jotion_pages_before_write();

-- Nach UPDATE: Teilbaum nachziehen, wenn sich Pfad, Scope oder Owner geändert haben.
CREATE FUNCTION jotion_pages_after_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.path IS DISTINCT FROM OLD.path
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    -- Direkt die Kinder aktualisieren; deren Trigger kaskadieren weiter nach unten.
    UPDATE pages
       SET path = NEW.path || jotion_page_label(id),
           scope = NEW.scope,
           owner_id = NEW.owner_id
     WHERE parent_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;

-- Ohne Spaltenliste: "UPDATE OF" würde Änderungen durch den BEFORE-Trigger nicht sehen.
CREATE TRIGGER pages_after_update
  AFTER UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION jotion_pages_after_update();

-- Fractional-Index-Schlüssel müssen bytegenau sortiert werden ("B" < "a"),
-- nicht nach Sprachregeln der Datenbank-Collation.
ALTER TABLE "pages" ALTER COLUMN "position" TYPE TEXT COLLATE "C";
ALTER TABLE "favorites" ALTER COLUMN "position" TYPE TEXT COLLATE "C";
