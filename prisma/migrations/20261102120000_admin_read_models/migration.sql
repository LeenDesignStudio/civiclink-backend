-- BE-5. Hand-written. `prisma migrate dev` cannot run here: the owner role
-- civiclink_owner does not authenticate to the local database (P1000),
-- the same fallback used for 20261028120000_admin_staff_role.
-- Apply with the database owner.
-- pg_trgm indexes support admin search. They are not in schema.prisma because
-- Prisma cannot express gin_trgm_ops. Do not drop them in a later migration.

CREATE TYPE "AdminActivityKind" AS ENUM (
  'CORRECTION_SUBMITTED',
  'SOURCE_REFRESH_FAILED',
  'ALERT_DELIVERY_FAILED',
  'INVITE_ACCEPTED'
);

CREATE TYPE "AdminActivityAudience" AS ENUM ('ALL', 'SUPER_ADMIN');

CREATE TABLE "admin_activity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "kind" "AdminActivityKind" NOT NULL,
  "audience" "AdminActivityAudience" NOT NULL DEFAULT 'ALL',
  "title" VARCHAR(120) NOT NULL,
  "preview" VARCHAR(200) NOT NULL,
  "entity_type" VARCHAR(40) NOT NULL,
  "entity_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_activity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_activity_created_at_idx" ON "admin_activity" ("created_at" DESC);
CREATE INDEX "admin_activity_audience_created_at_idx" ON "admin_activity" ("audience", "created_at" DESC);

CREATE TABLE "admin_activity_reads" (
  "activity_id" UUID NOT NULL,
  "admin_id" UUID NOT NULL,
  "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_activity_reads_pkey" PRIMARY KEY ("activity_id", "admin_id")
);

ALTER TABLE "admin_activity_reads"
  ADD CONSTRAINT "admin_activity_reads_activity_id_fkey"
  FOREIGN KEY ("activity_id") REFERENCES "admin_activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_activity_reads"
  ADD CONSTRAINT "admin_activity_reads_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "offices_status_last_updated_at_idx" ON "offices" ("status", "last_updated_at");
CREATE INDEX "officials_status_last_updated_at_idx" ON "officials" ("status", "last_updated_at");
CREATE INDEX "jurisdictions_is_pilot_status_idx" ON "jurisdictions" ("is_pilot", "status");
CREATE INDEX "change_log_created_at_idx" ON "change_log" ("created_at" DESC);
CREATE INDEX "alerts_status_sent_at_idx" ON "alerts" ("status", "sent_at");

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "offices_name_trgm_idx" ON "offices" USING gin ("name" gin_trgm_ops);
CREATE INDEX "offices_display_id_trgm_idx" ON "offices" USING gin ("display_id" gin_trgm_ops);
CREATE INDEX "officials_full_name_trgm_idx" ON "officials" USING gin ("full_name" gin_trgm_ops);
CREATE INDEX "officials_display_id_trgm_idx" ON "officials" USING gin ("display_id" gin_trgm_ops);
CREATE INDEX "jurisdictions_name_trgm_idx" ON "jurisdictions" USING gin ("name" gin_trgm_ops);
CREATE INDEX "jurisdictions_display_id_trgm_idx" ON "jurisdictions" USING gin ("display_id" gin_trgm_ops);
CREATE INDEX "services_title_trgm_idx" ON "services" USING gin ("title" gin_trgm_ops);
CREATE INDEX "services_display_id_trgm_idx" ON "services" USING gin ("display_id" gin_trgm_ops);
CREATE INDEX "sources_name_trgm_idx" ON "sources" USING gin ("name" gin_trgm_ops);
CREATE INDEX "sources_display_id_trgm_idx" ON "sources" USING gin ("display_id" gin_trgm_ops);
CREATE INDEX "corrections_display_id_trgm_idx" ON "corrections" USING gin ("display_id" gin_trgm_ops);
