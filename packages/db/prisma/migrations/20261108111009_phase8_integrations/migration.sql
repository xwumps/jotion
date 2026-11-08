

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secrets" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "status_message" TEXT,
    "account_label" TEXT,
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "next_sync_at" TIMESTAMPTZ(3),
    "last_sync_at" TIMESTAMPTZ(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "sync_lock_id" UUID,
    "sync_locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sources" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "remote_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kinds" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "target_database_id" UUID,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "options" JSONB NOT NULL DEFAULT '{}',
    "deletion_policy" TEXT NOT NULL DEFAULT 'mark',
    "cursor" JSONB,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_entities" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "weak_id" BOOLEAN NOT NULL DEFAULT false,
    "remote_ref" TEXT,
    "row_id" UUID,
    "version" TEXT,
    "field_state" JSONB NOT NULL DEFAULT '{}',
    "remote_deleted_at" TIMESTAMPTZ(3),
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "external_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_conflicts" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "local_value" JSONB,
    "remote_value" JSONB,
    "base_value" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution" TEXT,

    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_connections_workspace_id_owner_id_idx" ON "integration_connections"("workspace_id", "owner_id");

-- CreateIndex
CREATE INDEX "integration_connections_status_sync_enabled_next_sync_at_idx" ON "integration_connections"("status", "sync_enabled", "next_sync_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sources_connection_id_remote_id_key" ON "integration_sources"("connection_id", "remote_id");

-- CreateIndex
CREATE INDEX "external_entities_source_id_remote_ref_idx" ON "external_entities"("source_id", "remote_ref");

-- CreateIndex
CREATE INDEX "external_entities_row_id_idx" ON "external_entities"("row_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_entities_source_id_external_id_key" ON "external_entities"("source_id", "external_id");

-- CreateIndex
CREATE INDEX "sync_runs_connection_id_started_at_idx" ON "sync_runs"("connection_id", "started_at");

-- CreateIndex
CREATE INDEX "sync_conflicts_entity_id_field_idx" ON "sync_conflicts"("entity_id", "field");

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sources" ADD CONSTRAINT "integration_sources_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_entities" ADD CONSTRAINT "external_entities_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "integration_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_entities" ADD CONSTRAINT "external_entities_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "external_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
