-- CreateTable
CREATE TABLE "dashboards" (
    "workspace_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("workspace_id","key")
);

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
