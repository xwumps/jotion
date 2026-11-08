-- AlterEnum
ALTER TYPE "PageKind" ADD VALUE 'ROW_TEMPLATE';

-- AlterEnum
ALTER TYPE "PropertyType" ADD VALUE 'button';



-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "is_template" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "db_templates" (
    "page_id" UUID NOT NULL,
    "database_id" UUID NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "recurrence" JSONB,
    "next_run_at" TIMESTAMPTZ(3),
    "last_run_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "db_templates_pkey" PRIMARY KEY ("page_id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "database_id" UUID,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" JSONB NOT NULL,
    "conditions" JSONB,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID NOT NULL,
    "secret" TEXT,
    "next_run_at" TIMESTAMPTZ(3),
    "last_run_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "chain_depth" INTEGER NOT NULL DEFAULT 0,
    "row_id" UUID,
    "actor_id" UUID,
    "details" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "db_templates_database_id_idx" ON "db_templates"("database_id");

-- CreateIndex
CREATE INDEX "db_templates_next_run_at_idx" ON "db_templates"("next_run_at");

-- CreateIndex
CREATE INDEX "automations_database_id_enabled_idx" ON "automations"("database_id", "enabled");

-- CreateIndex
CREATE INDEX "automations_workspace_id_idx" ON "automations"("workspace_id");

-- CreateIndex
CREATE INDEX "automations_enabled_next_run_at_idx" ON "automations"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "automation_runs_automation_id_started_at_idx" ON "automation_runs"("automation_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_automation_id_event_key_key" ON "automation_runs"("automation_id", "event_key");

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
