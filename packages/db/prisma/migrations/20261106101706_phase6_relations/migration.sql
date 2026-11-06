-- Phase 6: Relationen hängen an Property und beiden Zeilen (endgültiges Löschen räumt auf)
-- AddForeignKey
ALTER TABLE "relation_links" ADD CONSTRAINT "relation_links_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "db_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relation_links" ADD CONSTRAINT "relation_links_from_row_id_fkey" FOREIGN KEY ("from_row_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relation_links" ADD CONSTRAINT "relation_links_to_row_id_fkey" FOREIGN KEY ("to_row_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
