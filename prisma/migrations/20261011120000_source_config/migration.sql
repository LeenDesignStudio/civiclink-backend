-- Source collector settings (TIGER year, page URL, CSS selectors).
ALTER TABLE "sources" ADD COLUMN "config" JSONB NOT NULL DEFAULT '{}';
