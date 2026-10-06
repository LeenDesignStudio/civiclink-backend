-- =============================================================================
-- CivicLink — database roles for staging/production (run by the DBA / IaC as the
-- RDS master user, NOT inside Prisma migrations). Passwords come from Secrets Manager.
--
--   civiclink_owner     owns schema objects; used ONLY by `prisma migrate deploy`
--   civiclink_app       runtime role for API + worker: DML only, no DDL
--   civiclink_readonly  optional, for support / BI read access
--
-- PART A runs once BEFORE the first `prisma migrate deploy`.
-- PART B runs once AFTER the first `prisma migrate deploy` (tables must exist).
-- Local development does the equivalent automatically: docker/postgres-init/.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PART A — before first migration (connected to the `postgres` database, then `civiclink`)
-- ---------------------------------------------------------------------------
-- CREATE ROLE civiclink_owner    LOGIN PASSWORD '<from-secrets-manager>';
-- CREATE ROLE civiclink_app      LOGIN PASSWORD '<from-secrets-manager>';
-- CREATE ROLE civiclink_readonly LOGIN PASSWORD '<from-secrets-manager>';
-- CREATE DATABASE civiclink OWNER civiclink_owner;
-- \connect civiclink

-- PostGIS is NOT a trusted extension, so the master user creates it. Extensions go
-- in their own schema so Prisma never sees spatial_ref_sys as drift.
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION civiclink_owner;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext  WITH SCHEMA extensions;
-- Replace civiclink with the real database name if different.
ALTER DATABASE civiclink SET search_path TO public, extensions;

GRANT USAGE ON SCHEMA extensions TO civiclink_app, civiclink_readonly;
GRANT USAGE ON SCHEMA public TO civiclink_app, civiclink_readonly;

-- Future tables created by the owner automatically get these grants.
ALTER DEFAULT PRIVILEGES FOR ROLE civiclink_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO civiclink_app;
ALTER DEFAULT PRIVILEGES FOR ROLE civiclink_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO civiclink_app;
ALTER DEFAULT PRIVILEGES FOR ROLE civiclink_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO civiclink_readonly;

-- pg-boss (job queue) keeps its own schema and maintains it at startup.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION civiclink_app;

-- Safety settings for the runtime role.
ALTER ROLE civiclink_app SET statement_timeout = '15s';
ALTER ROLE civiclink_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE civiclink_app SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- PART B — after first migration
-- ---------------------------------------------------------------------------
-- Covers tables created before the default privileges existed (harmless if repeated).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO civiclink_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO civiclink_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO civiclink_readonly;

-- Audit log: insert + read only for the app (the trigger also blocks UPDATE/DELETE).
REVOKE UPDATE, DELETE, TRUNCATE ON change_log FROM civiclink_app;

-- Readonly role must not see session secrets.
REVOKE SELECT ON user_sessions, admin_sessions FROM civiclink_readonly;
