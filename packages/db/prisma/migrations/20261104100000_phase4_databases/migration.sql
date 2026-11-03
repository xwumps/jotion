-- CreateEnum
CREATE TYPE "PageKind" AS ENUM ('PAGE', 'DATABASE', 'DATABASE_ROW');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'email', 'phone', 'files', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'unique_id', 'relation', 'rollup', 'formula');

-- CreateEnum
CREATE TYPE "DbViewType" AS ENUM ('table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'chart');



-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "database_id" UUID,
ADD COLUMN     "kind" "PageKind" NOT NULL DEFAULT 'PAGE';

-- CreateTable
CREATE TABLE "databases" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "is_inline" BOOLEAN NOT NULL DEFAULT false,
    "source_database_id" UUID,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "databases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "db_properties" (
    "id" UUID NOT NULL,
    "database_id" UUID NOT NULL,
    "type" "PropertyType" NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "db_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_values" (
    "row_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "database_id" UUID NOT NULL,
    "v_text" TEXT,
    "v_number" DOUBLE PRECISION,
    "v_bool" BOOLEAN,
    "v_date_start" TIMESTAMPTZ(3),
    "v_date_end" TIMESTAMPTZ(3),
    "v_date_has_time" BOOLEAN,
    "v_tz" TEXT,
    "v_option_ids" UUID[],
    "v_user_ids" UUID[],
    "v_json" JSONB,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_values_pkey" PRIMARY KEY ("row_id","property_id")
);

-- CreateTable
CREATE TABLE "relation_links" (
    "database_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "from_row_id" UUID NOT NULL,
    "to_row_id" UUID NOT NULL,
    "position" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relation_links_pkey" PRIMARY KEY ("property_id","from_row_id","to_row_id")
);

-- CreateTable
CREATE TABLE "db_views" (
    "id" UUID NOT NULL,
    "database_id" UUID NOT NULL,
    "type" "DbViewType" NOT NULL DEFAULT 'table',
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "db_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "db_view_row_order" (
    "view_id" UUID NOT NULL,
    "row_id" UUID NOT NULL,
    "position" TEXT NOT NULL,

    CONSTRAINT "db_view_row_order_pkey" PRIMARY KEY ("view_id","row_id")
);

-- CreateTable
CREATE TABLE "db_property_conversions" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "from_type" "PropertyType" NOT NULL,
    "from_config" JSONB NOT NULL,
    "to_type" "PropertyType" NOT NULL,
    "to_config" JSONB NOT NULL,
    "values" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "db_property_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "databases_workspace_id_idx" ON "databases"("workspace_id");

-- CreateIndex
CREATE INDEX "databases_source_database_id_idx" ON "databases"("source_database_id");

-- CreateIndex
CREATE INDEX "db_properties_database_id_position_idx" ON "db_properties"("database_id", "position");

-- CreateIndex
CREATE INDEX "property_values_property_id_row_id_idx" ON "property_values"("property_id", "row_id");

-- CreateIndex
CREATE INDEX "property_values_database_id_property_id_v_number_idx" ON "property_values"("database_id", "property_id", "v_number");

-- CreateIndex
CREATE INDEX "property_values_database_id_property_id_v_date_start_idx" ON "property_values"("database_id", "property_id", "v_date_start");

-- CreateIndex
CREATE INDEX "property_values_v_option_ids_idx" ON "property_values" USING GIN ("v_option_ids");

-- CreateIndex
CREATE INDEX "property_values_v_user_ids_idx" ON "property_values" USING GIN ("v_user_ids");

-- CreateIndex
CREATE INDEX "property_values_v_text_idx" ON "property_values" USING GIN ("v_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "relation_links_to_row_id_idx" ON "relation_links"("to_row_id");

-- CreateIndex
CREATE INDEX "db_views_database_id_position_idx" ON "db_views"("database_id", "position");

-- CreateIndex
CREATE INDEX "db_property_conversions_property_id_created_at_idx" ON "db_property_conversions"("property_id", "created_at");

-- CreateIndex
CREATE INDEX "pages_database_id_position_idx" ON "pages"("database_id", "position");

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_database_id_fkey" FOREIGN KEY ("database_id") REFERENCES "databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "databases" ADD CONSTRAINT "databases_id_fkey" FOREIGN KEY ("id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "databases" ADD CONSTRAINT "databases_source_database_id_fkey" FOREIGN KEY ("source_database_id") REFERENCES "databases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "db_properties" ADD CONSTRAINT "db_properties_database_id_fkey" FOREIGN KEY ("database_id") REFERENCES "databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_values" ADD CONSTRAINT "property_values_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_values" ADD CONSTRAINT "property_values_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "db_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_values" ADD CONSTRAINT "property_values_database_id_fkey" FOREIGN KEY ("database_id") REFERENCES "databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relation_links" ADD CONSTRAINT "relation_links_database_id_fkey" FOREIGN KEY ("database_id") REFERENCES "databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "db_views" ADD CONSTRAINT "db_views_database_id_fkey" FOREIGN KEY ("database_id") REFERENCES "databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "db_view_row_order" ADD CONSTRAINT "db_view_row_order_view_id_fkey" FOREIGN KEY ("view_id") REFERENCES "db_views"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "db_property_conversions" ADD CONSTRAINT "db_property_conversions_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "db_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Von Hand ergänzt (Prisma kennt diese Objekte nicht)
-- ---------------------------------------------------------------------------

-- Fractional-Index-Positionen bytegenau vergleichen
ALTER TABLE "db_properties" ALTER COLUMN "position" TYPE TEXT COLLATE "C";
ALTER TABLE "db_views" ALTER COLUMN "position" TYPE TEXT COLLATE "C";
ALTER TABLE "db_view_row_order" ALTER COLUMN "position" TYPE TEXT COLLATE "C";
ALTER TABLE "relation_links" ALTER COLUMN "position" TYPE TEXT COLLATE "C";

-- Zeilen hängen immer direkt unter ihrer Datenbank; nur Zeilen haben database_id
ALTER TABLE "pages" ADD CONSTRAINT "pages_database_row_check" CHECK (
  ("kind" = 'DATABASE_ROW' AND "database_id" IS NOT NULL AND "database_id" = "parent_id")
  OR ("kind" <> 'DATABASE_ROW' AND "database_id" IS NULL)
);
