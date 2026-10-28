-- BE-4. Hand-written. Apply after 20261028140000_admin_spec_model.
-- Dismiss reasons match the admin spec. Alert status can be partly failed or failed.
-- Alert messages are at most 500 characters. Services can record an override when a correction is applied.

CREATE TYPE "DismissReason_new" AS ENUM ('CANT_VERIFY', 'SOURCE_CORRECT', 'DUPLICATE', 'OUT_OF_SCOPE', 'OTHER');

ALTER TABLE "corrections" ALTER COLUMN "dismiss_reason" TYPE "DismissReason_new" USING (
  CASE "dismiss_reason"::text
    WHEN 'ALREADY_CORRECT' THEN 'SOURCE_CORRECT'
    WHEN 'INSUFFICIENT_EVIDENCE' THEN 'CANT_VERIFY'
    ELSE "dismiss_reason"::text
  END
)::"DismissReason_new";

DROP TYPE "DismissReason";
ALTER TYPE "DismissReason_new" RENAME TO "DismissReason";

ALTER TYPE "AlertStatus" ADD VALUE IF NOT EXISTS 'PARTLY_FAILED';
ALTER TYPE "AlertStatus" ADD VALUE IF NOT EXISTS 'FAILED';

ALTER TABLE "alerts" ALTER COLUMN "body" TYPE VARCHAR(500) USING left("body", 500);

ALTER TABLE "services" ADD COLUMN "override_active" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "services" ADD COLUMN "override_reason" VARCHAR(500);
ALTER TABLE "services" ADD COLUMN "overridden_by" UUID;
ALTER TABLE "services" ADD COLUMN "overridden_at" TIMESTAMPTZ(3);
