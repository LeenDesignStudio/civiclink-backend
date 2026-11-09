-- Elected year and photo check. parent_id is unchanged and is not cleared.
-- Apply with the database owner. `prisma migrate dev` cannot run here.

CREATE TYPE "PhotoStatus" AS ENUM ('NONE', 'OK', 'BROKEN');

ALTER TABLE "officials"
  ADD COLUMN "first_elected_year" INTEGER,
  ADD COLUMN "photo_status" "PhotoStatus" NOT NULL DEFAULT 'NONE';

ALTER TABLE "office_terms"
  ADD COLUMN "elected_year" INTEGER;

CREATE INDEX "office_terms_term_end_idx" ON "office_terms" ("term_end");
CREATE INDEX "office_terms_elected_year_idx" ON "office_terms" ("elected_year");
