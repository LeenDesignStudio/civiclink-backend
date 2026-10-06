-- =============================================================================
-- CivicLink — PREPEND to the very top of the first migration
-- (prisma/migrations/<timestamp>_init/migration.sql), BEFORE any CREATE TABLE.
--
-- Extensions live in a dedicated `extensions` schema, NOT `public`, so PostGIS's
-- own table (spatial_ref_sys) is invisible to Prisma and never shows up as drift.
-- Types like geometry(...) and CITEXT resolve through search_path.
--
-- PostGIS is not a trusted extension: in every environment a superuser
-- (local: docker init script; RDS: master user) must run this block once BEFORE
-- `prisma migrate deploy`. Inside the migration it is then a harmless no-op.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext  WITH SCHEMA extensions;

-- Current session (this migration) and all future sessions on this database.
SET search_path TO public, extensions;
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO public, extensions', current_database());
END
$$;
-- gen_random_uuid() is built into PostgreSQL 13+; pgcrypto is not required.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING_DELETION', 'DELETED');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'APPLE');

-- CreateEnum
CREATE TYPE "LocationLabel" AS ENUM ('HOME', 'WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "LookupMethod" AS ENUM ('ADDRESS', 'ZIP', 'CITY_STATE', 'DEVICE');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('EXACT', 'LIKELY', 'MULTIPLE', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "GovLevel" AS ENUM ('FEDERAL', 'STATE', 'COUNTY', 'MUNICIPAL', 'EDUCATION', 'SPECIAL');

-- CreateEnum
CREATE TYPE "JurisdictionType" AS ENUM ('NATION', 'STATE', 'CONGRESSIONAL_DISTRICT', 'STATE_SENATE_DISTRICT', 'STATE_HOUSE_DISTRICT', 'COUNTY', 'COUNTY_COUNCIL_DISTRICT', 'MUNICIPALITY', 'WARD', 'SCHOOL_DISTRICT', 'SCHOOL_BOARD_DISTRICT', 'COMMUNITY_COLLEGE_DISTRICT', 'SPECIAL_DISTRICT', 'ZCTA');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "FreshnessOverride" AS ENUM ('NONE', 'FORCE_CURRENT', 'FORCE_OUTDATED');

-- CreateEnum
CREATE TYPE "SelectionMethod" AS ENUM ('ELECTED', 'APPOINTED');

-- CreateEnum
CREATE TYPE "TermStatus" AS ENUM ('ELECTED', 'APPOINTED', 'ACTING');

-- CreateEnum
CREATE TYPE "SourceMethod" AS ENUM ('API', 'BULK', 'PAGE_COLLECTION', 'MANUAL');

-- CreateEnum
CREATE TYPE "SourceSchedule" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ON_DEMAND');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChangeDecision" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CivicEntityType" AS ENUM ('JURISDICTION', 'OFFICE', 'OFFICIAL', 'SERVICE');

-- CreateEnum
CREATE TYPE "CorrectionField" AS ENUM ('OFFICEHOLDER_NAME', 'TITLE', 'PARTY', 'PHONE', 'EMAIL', 'WEBSITE', 'OFFICE_ADDRESS', 'DISTRICT', 'DOES_NOT_APPLY', 'SERVICE_DETAILS', 'OTHER');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'APPLIED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DismissReason" AS ENUM ('ALREADY_CORRECT', 'INSUFFICIENT_EVIDENCE', 'OUT_OF_SCOPE', 'DUPLICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ALERT', 'RECORD_UPDATE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ALERTS', 'UPDATES');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('INCOMPLETE', 'INCOMPLETE_EXPIRED', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'PAUSED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'UNCOLLECTIBLE', 'VOID');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('VIEWER', 'EDITOR', 'COMMUNICATIONS', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('RESIDENT', 'ADMIN', 'SYSTEM', 'SOURCE');

-- CreateEnum
CREATE TYPE "ContactTopic" AS ENUM ('GENERAL', 'DATA_ACCURACY', 'BILLING', 'PARTNERSHIPS', 'PRESS', 'OTHER');

-- CreateEnum
CREATE TYPE "DeletionReason" AS ENUM ('NOT_USEFUL', 'PRIVACY', 'TOO_MANY_NOTIFICATIONS', 'OTHER');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "display_name" VARCHAR(60) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "terms_version" VARCHAR(20),
    "privacy_version" VARCHAR(20),
    "accepted_at" TIMESTAMPTZ(3),
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_subject" VARCHAR(255) NOT NULL,
    "email" CITEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "family_id" UUID NOT NULL,
    "user_agent" VARCHAR(400),
    "ip_hash" CHAR(64),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "reason" "DeletionReason",
    "reason_text" VARCHAR(500),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purge_after" TIMESTAMPTZ(3) NOT NULL,
    "restored_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "label" "LocationLabel" NOT NULL,
    "custom_name" VARCHAR(40),
    "display_address" VARCHAR(200) NOT NULL,
    "normalized_address" VARCHAR(200) NOT NULL,
    "point" geometry(Point, 4326),
    "geocode_precision" VARCHAR(32),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "jurisdiction_ids" UUID[],
    "confidence" "Confidence" NOT NULL,
    "resolved_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" VARCHAR(32) NOT NULL,
    "user_id" UUID,
    "method" "LookupMethod" NOT NULL,
    "display_label" VARCHAR(200) NOT NULL,
    "zip" VARCHAR(5),
    "geom" geometry(Geometry, 4326),
    "jurisdiction_ids" UUID[],
    "confidence" "Confidence" NOT NULL,
    "partial_levels" "GovLevel"[],
    "level_detail" JSONB NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lookups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "office_id" UUID NOT NULL,
    "official_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL,
    "publisher" VARCHAR(150) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "terms_url" VARCHAR(2048) NOT NULL,
    "method" "SourceMethod" NOT NULL,
    "schedule" "SourceSchedule" NOT NULL,
    "freshness_days" INTEGER NOT NULL DEFAULT 90,
    "levels" "GovLevel"[],
    "collector_key" VARCHAR(80),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "triggered_by" UUID,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "added" INTEGER NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "retired" INTEGER NOT NULL DEFAULT 0,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "snapshot_key" VARCHAR(512),
    "snapshot_sha" CHAR(64),
    "error" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "source_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_source_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_run_id" UUID NOT NULL,
    "entity_type" "CivicEntityType" NOT NULL,
    "entity_id" UUID,
    "field" VARCHAR(80) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB NOT NULL,
    "decision" "ChangeDecision" NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pending_source_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdictions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL,
    "level" "GovLevel" NOT NULL,
    "type" "JurisdictionType" NOT NULL,
    "subtype" VARCHAR(80),
    "parent_id" UUID,
    "district_code" VARCHAR(40),
    "geoid" VARCHAR(40),
    "state" CHAR(2),
    "boundary" geometry(MultiPolygon, 4326),
    "boundary_vintage" VARCHAR(20),
    "website" VARCHAR(2048),
    "source_id" UUID NOT NULL,
    "source_record_url" VARCHAR(2048),
    "last_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "freshness_override" "FreshnessOverride" NOT NULL DEFAULT 'NONE',
    "freshness_note" VARCHAR(500),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(160) NOT NULL,
    "jurisdiction_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "seat_label" VARCHAR(60),
    "selection_method" "SelectionMethod" NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "why_template" VARCHAR(300),
    "phone" VARCHAR(20),
    "email" CITEXT,
    "website" VARCHAR(2048),
    "contact_url" VARCHAR(2048),
    "holder_unknown" BOOLEAN NOT NULL DEFAULT false,
    "source_id" UUID NOT NULL,
    "source_record_url" VARCHAR(2048),
    "last_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "freshness_override" "FreshnessOverride" NOT NULL DEFAULT 'NONE',
    "freshness_note" VARCHAR(500),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "offices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "office_id" UUID NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "street" VARCHAR(200) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" CHAR(2) NOT NULL,
    "zip" VARCHAR(10) NOT NULL,
    "phone" VARCHAR(20),
    "hours" VARCHAR(200),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "office_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "officials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(160) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "display_name" VARCHAR(120),
    "party" VARCHAR(60),
    "photo_url" VARCHAR(2048),
    "website" VARCHAR(2048),
    "external_ids" JSONB NOT NULL DEFAULT '{}',
    "source_id" UUID NOT NULL,
    "source_record_url" VARCHAR(2048),
    "last_updated_at" TIMESTAMPTZ(3) NOT NULL,
    "freshness_override" "FreshnessOverride" NOT NULL DEFAULT 'NONE',
    "freshness_note" VARCHAR(500),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "officials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_terms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "office_id" UUID NOT NULL,
    "official_id" UUID NOT NULL,
    "status" "TermStatus" NOT NULL,
    "term_start" DATE,
    "term_end" DATE,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "office_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(60) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(120) NOT NULL,
    "category_id" UUID NOT NULL,
    "description" VARCHAR(400) NOT NULL,
    "url" VARCHAR(2048),
    "phone_contact" VARCHAR(120),
    "last_validated_at" TIMESTAMPTZ(3) NOT NULL,
    "link_broken" BOOLEAN NOT NULL DEFAULT false,
    "source_id" UUID NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service_id" UUID NOT NULL,
    "jurisdiction_id" UUID,
    "office_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "entity_type" "CivicEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "field" "CorrectionField" NOT NULL,
    "current_value_snapshot" JSONB,
    "proposed_value" VARCHAR(500),
    "details" VARCHAR(1000),
    "evidence_url" VARCHAR(2048),
    "lookup_token" VARCHAR(32),
    "status" "CorrectionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "assignee_id" UUID,
    "dismiss_reason" "DismissReason",
    "dismiss_note" VARCHAR(500),
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "correction_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correction_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "target_office_id" UUID,
    "target_official_id" UUID,
    "title" VARCHAR(80) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "link" VARCHAR(2048),
    "channels" "NotificationChannel"[],
    "status" "AlertStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "sent_by" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "recipient_count" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "link" VARCHAR(2048),
    "source_ref" VARCHAR(80) NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupe_key" VARCHAR(200) NOT NULL,
    "provider_message_id" VARCHAR(200),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(1000),
    "sent_at" TIMESTAMPTZ(3),
    "opened_at" TIMESTAMPTZ(3),
    "clicked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(2048) NOT NULL,
    "user_agent" VARCHAR(400),
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stripe_price_id" VARCHAR(100) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'usd',
    "interval" VARCHAR(10) NOT NULL,
    "features" JSONB NOT NULL DEFAULT '[]',
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "stripe_customer_id" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stripe_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "stripe_subscription_id" VARCHAR(100) NOT NULL,
    "plan_id" UUID,
    "status" "SubscriptionStatus" NOT NULL,
    "current_period_end" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "last_event_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stripe_invoice_id" VARCHAR(100) NOT NULL,
    "stripe_customer_id" VARCHAR(100) NOT NULL,
    "number" VARCHAR(60),
    "amount_due_cents" INTEGER NOT NULL,
    "amount_paid_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "hosted_url" VARCHAR(2048),
    "pdf_url" VARCHAR(2048),
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" VARCHAR(100) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "error" VARCHAR(1000),

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "name" VARCHAR(100),
    "role" "AdminRole" NOT NULL,
    "status" "AdminStatus" NOT NULL DEFAULT 'INVITED',
    "google_subject" VARCHAR(255),
    "invited_by" UUID,
    "last_login_at" TIMESTAMPTZ(3),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "user_agent" VARCHAR(400),
    "ip_hash" CHAR(64),
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "email" CITEXT NOT NULL,
    "topic" "ContactTopic" NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "ip_hash" CHAR(64) NOT NULL,
    "emailed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" VARCHAR(255) NOT NULL,
    "points" INTEGER NOT NULL,
    "expire" BIGINT,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(20) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_subject_key" ON "auth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_family_id_idx" ON "user_sessions"("family_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "deletion_requests_purge_after_idx" ON "deletion_requests"("purge_after");

-- CreateIndex
CREATE INDEX "deletion_requests_user_id_idx" ON "deletion_requests"("user_id");

-- CreateIndex
CREATE INDEX "saved_locations_user_id_idx" ON "saved_locations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lookups_token_key" ON "lookups"("token");

-- CreateIndex
CREATE INDEX "lookups_expires_at_idx" ON "lookups"("expires_at");

-- CreateIndex
CREATE INDEX "lookups_user_id_idx" ON "lookups"("user_id");

-- CreateIndex
CREATE INDEX "follows_office_id_idx" ON "follows"("office_id");

-- CreateIndex
CREATE INDEX "follows_official_id_idx" ON "follows"("official_id");

-- CreateIndex
CREATE UNIQUE INDEX "follows_user_id_office_id_key" ON "follows"("user_id", "office_id");

-- CreateIndex
CREATE UNIQUE INDEX "sources_name_key" ON "sources"("name");

-- CreateIndex
CREATE INDEX "source_runs_source_id_created_at_idx" ON "source_runs"("source_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "pending_source_changes_decision_created_at_idx" ON "pending_source_changes"("decision", "created_at");

-- CreateIndex
CREATE INDEX "jurisdictions_level_status_idx" ON "jurisdictions"("level", "status");

-- CreateIndex
CREATE INDEX "jurisdictions_parent_id_idx" ON "jurisdictions"("parent_id");

-- CreateIndex
CREATE INDEX "jurisdictions_state_idx" ON "jurisdictions"("state");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdictions_type_geoid_key" ON "jurisdictions"("type", "geoid");

-- CreateIndex
CREATE UNIQUE INDEX "offices_slug_key" ON "offices"("slug");

-- CreateIndex
CREATE INDEX "offices_jurisdiction_id_status_idx" ON "offices"("jurisdiction_id", "status");

-- CreateIndex
CREATE INDEX "office_addresses_office_id_idx" ON "office_addresses"("office_id");

-- CreateIndex
CREATE UNIQUE INDEX "officials_slug_key" ON "officials"("slug");

-- CreateIndex
CREATE INDEX "officials_status_idx" ON "officials"("status");

-- CreateIndex
CREATE INDEX "office_terms_office_id_is_current_idx" ON "office_terms"("office_id", "is_current");

-- CreateIndex
CREATE INDEX "office_terms_official_id_idx" ON "office_terms"("official_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_name_key" ON "service_categories"("name");

-- CreateIndex
CREATE INDEX "services_category_id_status_idx" ON "services"("category_id", "status");

-- CreateIndex
CREATE INDEX "service_links_jurisdiction_id_idx" ON "service_links"("jurisdiction_id");

-- CreateIndex
CREATE INDEX "service_links_office_id_idx" ON "service_links"("office_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_links_service_id_jurisdiction_id_office_id_key" ON "service_links"("service_id", "jurisdiction_id", "office_id");

-- CreateIndex
CREATE INDEX "corrections_status_created_at_idx" ON "corrections"("status", "created_at");

-- CreateIndex
CREATE INDEX "corrections_user_id_created_at_idx" ON "corrections"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "corrections_entity_type_entity_id_idx" ON "corrections"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "correction_notes_correction_id_idx" ON "correction_notes"("correction_id");

-- CreateIndex
CREATE INDEX "change_log_entity_type_entity_id_created_at_idx" ON "change_log"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "change_log_actor_type_actor_id_idx" ON "change_log"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "alerts_status_created_at_idx" ON "alerts"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_source_ref_key" ON "notifications"("user_id", "source_ref");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_dedupe_key_key" ON "notification_deliveries"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_channel_idx" ON "notification_deliveries"("status", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_category_channel_key" ON "notification_preferences"("user_id", "category", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_token_key" ON "push_subscriptions"("token");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_stripe_price_id_key" ON "plans"("stripe_price_id");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_customers_user_id_key" ON "stripe_customers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_customers_stripe_customer_id_key" ON "stripe_customers"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_stripe_invoice_id_key" ON "invoices"("stripe_invoice_id");

-- CreateIndex
CREATE INDEX "invoices_stripe_customer_id_issued_at_idx" ON "invoices"("stripe_customer_id", "issued_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_google_subject_key" ON "admin_users"("google_subject");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_idx" ON "admin_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "contact_messages_created_at_idx" ON "contact_messages"("created_at");

-- CreateIndex
CREATE INDEX "rate_limits_expire_idx" ON "rate_limits"("expire");

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_kind_version_key" ON "legal_documents"("kind", "version");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_locations" ADD CONSTRAINT "saved_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lookups" ADD CONSTRAINT "lookups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_official_id_fkey" FOREIGN KEY ("official_id") REFERENCES "officials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_runs" ADD CONSTRAINT "source_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_source_changes" ADD CONSTRAINT "pending_source_changes_source_run_id_fkey" FOREIGN KEY ("source_run_id") REFERENCES "source_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_source_changes" ADD CONSTRAINT "pending_source_changes_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offices" ADD CONSTRAINT "offices_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offices" ADD CONSTRAINT "offices_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_addresses" ADD CONSTRAINT "office_addresses_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officials" ADD CONSTRAINT "officials_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_terms" ADD CONSTRAINT "office_terms_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_terms" ADD CONSTRAINT "office_terms_official_id_fkey" FOREIGN KEY ("official_id") REFERENCES "officials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_links" ADD CONSTRAINT "service_links_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_links" ADD CONSTRAINT "service_links_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_links" ADD CONSTRAINT "service_links_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_notes" ADD CONSTRAINT "correction_notes_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "corrections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_notes" ADD CONSTRAINT "correction_notes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_target_office_id_fkey" FOREIGN KEY ("target_office_id") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_target_official_id_fkey" FOREIGN KEY ("target_official_id") REFERENCES "officials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_stripe_customer_id_fkey" FOREIGN KEY ("stripe_customer_id") REFERENCES "stripe_customers"("stripe_customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- CivicLink — APPEND to the end of the first migration (after Prisma's DDL).
-- Everything here is something Prisma's schema language cannot express:
-- spatial indexes, partial unique indexes, CHECK constraints, append-only audit.
-- Keep this file idempotent-friendly: each statement is safe to read on review.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Spatial indexes (GiST) — required for point-in-polygon at lookup time
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS jurisdictions_boundary_gist
  ON jurisdictions USING GIST (boundary)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS saved_locations_point_gist
  ON saved_locations USING GIST (point);

CREATE INDEX IF NOT EXISTS lookups_geom_gist
  ON lookups USING GIST (geom);

-- Boundaries must be valid polygons so ST_Contains/ST_Intersects are reliable.
-- The pipeline runs ST_MakeValid() before insert; this guards against bad writes.
ALTER TABLE jurisdictions
  ADD CONSTRAINT jurisdictions_boundary_valid
  CHECK (boundary IS NULL OR ST_IsValid(boundary));

-- ---------------------------------------------------------------------------
-- 2. Business invariants as partial unique indexes
-- ---------------------------------------------------------------------------

-- One current officeholder per office.
CREATE UNIQUE INDEX IF NOT EXISTS office_terms_one_current_per_office
  ON office_terms (office_id)
  WHERE is_current;

-- One default saved location per resident.
CREATE UNIQUE INDEX IF NOT EXISTS saved_locations_one_default_per_user
  ON saved_locations (user_id)
  WHERE is_default;

-- HOME and WORK labels at most once per resident (OTHER may repeat).
CREATE UNIQUE INDEX IF NOT EXISTS saved_locations_home_work_once
  ON saved_locations (user_id, label)
  WHERE label IN ('HOME', 'WORK');

-- A resident cannot open the same correction twice while one is still open.
CREATE UNIQUE INDEX IF NOT EXISTS corrections_one_open_per_user_field
  ON corrections (user_id, entity_type, entity_id, field)
  WHERE status IN ('SUBMITTED', 'IN_REVIEW') AND user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. CHECK constraints
-- ---------------------------------------------------------------------------

-- Service link targets exactly one of jurisdiction / office.
ALTER TABLE service_links
  ADD CONSTRAINT service_links_exactly_one_target
  CHECK (num_nonnulls(jurisdiction_id, office_id) = 1);

-- Alert targets exactly one of office / official.
ALTER TABLE alerts
  ADD CONSTRAINT alerts_exactly_one_target
  CHECK (num_nonnulls(target_office_id, target_official_id) = 1);

-- A sent alert has a sender, a timestamp and a recipient count.
ALTER TABLE alerts
  ADD CONSTRAINT alerts_sent_fields
  CHECK (status <> 'SENT' OR (sent_by IS NOT NULL AND sent_at IS NOT NULL AND recipient_count IS NOT NULL));

-- Dismissed corrections always carry a reason; resolved ones a timestamp.
ALTER TABLE corrections
  ADD CONSTRAINT corrections_dismiss_reason
  CHECK (status <> 'DISMISSED' OR dismiss_reason IS NOT NULL);
ALTER TABLE corrections
  ADD CONSTRAINT corrections_resolved_at
  CHECK (status NOT IN ('APPLIED', 'DISMISSED') OR resolved_at IS NOT NULL);

-- "Other" saved locations need a name.
ALTER TABLE saved_locations
  ADD CONSTRAINT saved_locations_other_named
  CHECK (label <> 'OTHER' OR custom_name IS NOT NULL);

-- Forced freshness must be explained.
ALTER TABLE jurisdictions ADD CONSTRAINT jurisdictions_freshness_note
  CHECK (freshness_override = 'NONE' OR freshness_note IS NOT NULL);
ALTER TABLE offices ADD CONSTRAINT offices_freshness_note
  CHECK (freshness_override = 'NONE' OR freshness_note IS NOT NULL);
ALTER TABLE officials ADD CONSTRAINT officials_freshness_note
  CHECK (freshness_override = 'NONE' OR freshness_note IS NOT NULL);

-- Term dates are ordered.
ALTER TABLE office_terms
  ADD CONSTRAINT office_terms_dates_ordered
  CHECK (term_start IS NULL OR term_end IS NULL OR term_start <= term_end);

-- Sane ranges.
ALTER TABLE sources ADD CONSTRAINT sources_freshness_days_range
  CHECK (freshness_days BETWEEN 1 AND 3650);
ALTER TABLE plans ADD CONSTRAINT plans_amount_non_negative
  CHECK (amount_cents >= 0);
ALTER TABLE jurisdictions ADD CONSTRAINT jurisdictions_state_format
  CHECK (state IS NULL OR state ~ '^[A-Z]{2}$');
ALTER TABLE lookups ADD CONSTRAINT lookups_zip_format
  CHECK (zip IS NULL OR zip ~ '^[0-9]{5}$');

-- ---------------------------------------------------------------------------
-- 4. Append-only change log (audit). Defence in depth on top of DB grants.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION change_log_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'change_log is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS change_log_no_update ON change_log;
CREATE TRIGGER change_log_no_update
  BEFORE UPDATE OR DELETE ON change_log
  FOR EACH ROW EXECUTE FUNCTION change_log_block_mutation();

-- Note: change_log stores admin/system/source actor ids only. Resident-originated
-- entries use actor_type RESIDENT with actor_id NULL, so account purge never needs
-- to modify this table (see docs/02-RBAC-PERMISSIONS.md, "Audit").
