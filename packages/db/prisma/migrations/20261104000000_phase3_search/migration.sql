-- Phase 3: Volltextsuche über Blockinhalte (FTS + Trigramme) und Titel.
-- Von Hand gepflegt, Prisma kennt diese Objekte nicht (siehe docs/development.md).

-- unaccent() ist nur STABLE und damit nicht in Indizes nutzbar. Diese Hülle mit festem
-- Wörterbuch ist IMMUTABLE und liefert für dieselbe Eingabe immer dasselbe Ergebnis.
CREATE OR REPLACE FUNCTION jotion_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Volltext (sprachneutral, ohne Stemming, damit Deutsch und Englisch gleich funktionieren)
CREATE INDEX "blocks_search_idx" ON "blocks"
  USING GIN (to_tsvector('simple'::regconfig, jotion_unaccent("plain_text")));

-- Teilwörter und Tippfehler
CREATE INDEX "blocks_plain_text_trgm_idx" ON "blocks"
  USING GIN (jotion_unaccent("plain_text") gin_trgm_ops);

-- Suche im Titel ohne Akzente
CREATE INDEX "pages_title_unaccent_trgm_idx" ON "pages"
  USING GIN (jotion_unaccent("title") gin_trgm_ops);
