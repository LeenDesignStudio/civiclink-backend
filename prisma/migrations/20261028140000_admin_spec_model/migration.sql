-- BE-3: short display ids, admin-spec fields, service status, source status.
-- Hand-written. prisma migrate dev cannot authenticate as civiclink_owner (P1000).
-- Apply with the database owner after 20261028120000_admin_staff_role.

CREATE SEQUENCE "display_id_jur";
CREATE SEQUENCE "display_id_off";
CREATE SEQUENCE "display_id_per";
CREATE SEQUENCE "display_id_svc";
CREATE SEQUENCE "display_id_cor";
CREATE SEQUENCE "display_id_src";
CREATE SEQUENCE "display_id_alt";

CREATE TYPE "OfficeType" AS ENUM ('ELECTED', 'APPOINTED', 'DEPARTMENT', 'COMMISSION');
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "SourceKind" AS ENUM ('API', 'BULK_EXPORT', 'SCHEDULED_PAGE', 'MANUAL');
CREATE TYPE "SourceRecordStatus" AS ENUM ('ACTIVE', 'PAUSED', 'RETIRED');

ALTER TABLE "jurisdictions"
  ADD COLUMN "display_id" VARCHAR(16),
  ADD COLUMN "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "description" VARCHAR(300),
  ADD COLUMN "is_pilot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "parent_retired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "override_active" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "override_reason" VARCHAR(500),
  ADD COLUMN "overridden_by" UUID,
  ADD COLUMN "overridden_at" TIMESTAMPTZ(3),
  ADD COLUMN "source_changed_since_override" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "offices"
  ADD COLUMN "display_id" VARCHAR(16),
  ADD COLUMN "office_type" "OfficeType" NOT NULL DEFAULT 'ELECTED',
  ADD COLUMN "parent_retired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "override_active" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "override_reason" VARCHAR(500),
  ADD COLUMN "overridden_by" UUID,
  ADD COLUMN "overridden_at" TIMESTAMPTZ(3),
  ADD COLUMN "source_changed_since_override" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "officials"
  ADD COLUMN "display_id" VARCHAR(16),
  ADD COLUMN "use_office_address" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "override_active" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "override_reason" VARCHAR(500),
  ADD COLUMN "overridden_by" UUID,
  ADD COLUMN "overridden_at" TIMESTAMPTZ(3),
  ADD COLUMN "source_changed_since_override" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "services"
  ADD COLUMN "display_id" VARCHAR(16),
  ADD COLUMN "email" CITEXT,
  ADD COLUMN "status_new" "ServiceStatus";

ALTER TABLE "corrections" ADD COLUMN "display_id" VARCHAR(16);
ALTER TABLE "alerts" ADD COLUMN "display_id" VARCHAR(16);

ALTER TABLE "sources"
  ADD COLUMN "display_id" VARCHAR(16),
  ADD COLUMN "kind" "SourceKind" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "notes" VARCHAR(500),
  ADD COLUMN "record_status" "SourceRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "last_success_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(3);

UPDATE "sources"
SET "kind" = CASE "method"::text
  WHEN 'API' THEN 'API'
  WHEN 'BULK' THEN 'BULK_EXPORT'
  WHEN 'PAGE_COLLECTION' THEN 'SCHEDULED_PAGE'
  ELSE 'MANUAL'
END::"SourceKind",
"record_status" = CASE WHEN "active" THEN 'ACTIVE' ELSE 'PAUSED' END::"SourceRecordStatus";

UPDATE "services"
SET "description" = left("description", 300),
    "status_new" = CASE WHEN "status"::text = 'RETIRED' THEN 'INACTIVE' ELSE 'ACTIVE' END::"ServiceStatus";

ALTER TABLE "services" DROP COLUMN "status";
ALTER TABLE "services" RENAME COLUMN "status_new" TO "status";
ALTER TABLE "services" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "services" ALTER COLUMN "status" SET NOT NULL;

UPDATE "jurisdictions" SET "display_id" = 'JUR-' || lpad(nextval('display_id_jur')::text, 8, '0') WHERE "display_id" IS NULL;
UPDATE "offices" SET "display_id" = 'OFF-' || lpad(nextval('display_id_off')::text, 8, '0') WHERE "display_id" IS NULL;
UPDATE "officials" SET "display_id" = 'PER-' || lpad(nextval('display_id_per')::text, 8, '0') WHERE "display_id" IS NULL;
UPDATE "services" SET "display_id" = 'SVC-' || lpad(nextval('display_id_svc')::text, 8, '0') WHERE "display_id" IS NULL;
UPDATE "corrections" SET "display_id" = 'COR-' || lpad(nextval('display_id_cor')::text, 8, '0') WHERE "display_id" IS NULL;
UPDATE "sources" SET "display_id" = 'SRC-' || lpad(nextval('display_id_src')::text, 8, '0') WHERE "display_id" IS NULL;
UPDATE "alerts" SET "display_id" = 'ALT-' || lpad(nextval('display_id_alt')::text, 8, '0') WHERE "display_id" IS NULL;

ALTER TABLE "jurisdictions" ALTER COLUMN "display_id" SET NOT NULL;
ALTER TABLE "offices" ALTER COLUMN "display_id" SET NOT NULL;
ALTER TABLE "officials" ALTER COLUMN "display_id" SET NOT NULL;
ALTER TABLE "services" ALTER COLUMN "display_id" SET NOT NULL;
ALTER TABLE "corrections" ALTER COLUMN "display_id" SET NOT NULL;
ALTER TABLE "sources" ALTER COLUMN "display_id" SET NOT NULL;
ALTER TABLE "alerts" ALTER COLUMN "display_id" SET NOT NULL;

ALTER TABLE "jurisdictions" ALTER COLUMN "display_id" SET DEFAULT ('JUR-' || lpad(nextval('display_id_jur')::text, 8, '0'));
ALTER TABLE "offices" ALTER COLUMN "display_id" SET DEFAULT ('OFF-' || lpad(nextval('display_id_off')::text, 8, '0'));
ALTER TABLE "officials" ALTER COLUMN "display_id" SET DEFAULT ('PER-' || lpad(nextval('display_id_per')::text, 8, '0'));
ALTER TABLE "services" ALTER COLUMN "display_id" SET DEFAULT ('SVC-' || lpad(nextval('display_id_svc')::text, 8, '0'));
ALTER TABLE "corrections" ALTER COLUMN "display_id" SET DEFAULT ('COR-' || lpad(nextval('display_id_cor')::text, 8, '0'));
ALTER TABLE "sources" ALTER COLUMN "display_id" SET DEFAULT ('SRC-' || lpad(nextval('display_id_src')::text, 8, '0'));
ALTER TABLE "alerts" ALTER COLUMN "display_id" SET DEFAULT ('ALT-' || lpad(nextval('display_id_alt')::text, 8, '0'));

CREATE UNIQUE INDEX "jurisdictions_display_id_key" ON "jurisdictions" ("display_id");
CREATE UNIQUE INDEX "offices_display_id_key" ON "offices" ("display_id");
CREATE UNIQUE INDEX "officials_display_id_key" ON "officials" ("display_id");
CREATE UNIQUE INDEX "services_display_id_key" ON "services" ("display_id");
CREATE UNIQUE INDEX "corrections_display_id_key" ON "corrections" ("display_id");
CREATE UNIQUE INDEX "sources_display_id_key" ON "sources" ("display_id");
CREATE UNIQUE INDEX "alerts_display_id_key" ON "alerts" ("display_id");

CREATE UNIQUE INDEX "jurisdictions_parent_name_key" ON "jurisdictions" ("parent_id", "name") WHERE "parent_id" IS NOT NULL;
CREATE UNIQUE INDEX "jurisdictions_root_name_key" ON "jurisdictions" ("name") WHERE "parent_id" IS NULL;
CREATE UNIQUE INDEX "offices_jurisdiction_name_key" ON "offices" ("jurisdiction_id", "name");

ALTER TABLE "services" ALTER COLUMN "description" TYPE VARCHAR(300);
