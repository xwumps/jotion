-- CreateTable
CREATE TABLE "page_docs" (
    "page_id" UUID NOT NULL,
    "state" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "page_docs_pkey" PRIMARY KEY ("page_id")
);

-- CreateTable
CREATE TABLE "page_doc_updates" (
    "id" BIGSERIAL NOT NULL,
    "page_id" UUID NOT NULL,
    "update" BYTEA NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_doc_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "page_id" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "parent_block_id" TEXT,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "plain_text" TEXT NOT NULL DEFAULT '',
    "props" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("page_id","id")
);

-- CreateTable
CREATE TABLE "block_references" (
    "page_id" UUID NOT NULL,
    "block_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,

    CONSTRAINT "block_references_pkey" PRIMARY KEY ("page_id","block_id","target_id")
);

-- CreateIndex
CREATE INDEX "page_doc_updates_page_id_id_idx" ON "page_doc_updates"("page_id", "id");

-- CreateIndex
CREATE INDEX "block_references_target_id_idx" ON "block_references"("target_id");

-- AddForeignKey
ALTER TABLE "page_docs" ADD CONSTRAINT "page_docs_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_doc_updates" ADD CONSTRAINT "page_doc_updates_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_references" ADD CONSTRAINT "block_references_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Titelsuche (Schnellsuche) über Trigramme
CREATE INDEX "pages_title_trgm_idx" ON "pages" USING GIN ("title" gin_trgm_ops);
