-- =============================================================================
-- CivicLink — DEVELOPMENT database on Leen's Hetzner server (no Docker needed).
-- Run once as the postgres superuser:
--   sudo -u postgres psql -v owner_pw="'<strong pw>'" -v app_pw="'<strong pw>'" -f dev-db-init.sql
-- Creates three databases with the same role + extension layout as production:
--   civiclink         day-to-day development
--   civiclink_shadow  used by `prisma migrate dev`
--   civiclink_test    used by integration tests (TEST_* env vars)
-- Dev data only. Staging and production run in QubaLink's AWS (SOW A13/A14).
-- =============================================================================

CREATE ROLE civiclink_owner LOGIN PASSWORD :owner_pw;
CREATE ROLE civiclink_app   LOGIN PASSWORD :app_pw;
ALTER ROLE civiclink_app SET statement_timeout = '15s';
ALTER ROLE civiclink_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE civiclink_app SET lock_timeout = '5s';

CREATE DATABASE civiclink        OWNER civiclink_owner;
CREATE DATABASE civiclink_shadow OWNER civiclink_owner;
CREATE DATABASE civiclink_test   OWNER civiclink_owner;

-- ---- civiclink -------------------------------------------------------------
\connect civiclink
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION civiclink_owner;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext  WITH SCHEMA extensions;
ALTER DATABASE civiclink SET search_path TO public, extensions;
GRANT USAGE ON SCHEMA extensions, public TO civiclink_app;
ALTER DEFAULT PRIVILEGES FOR ROLE civiclink_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO civiclink_app;
ALTER DEFAULT PRIVILEGES FOR ROLE civiclink_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO civiclink_app;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION civiclink_app;

-- ---- civiclink_shadow ------------------------------------------------------
\connect civiclink_shadow
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION civiclink_owner;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext  WITH SCHEMA extensions;
ALTER DATABASE civiclink_shadow SET search_path TO public, extensions;

-- ---- civiclink_test --------------------------------------------------------
\connect civiclink_test
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION civiclink_owner;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext  WITH SCHEMA extensions;
ALTER DATABASE civiclink_test SET search_path TO public, extensions;
GRANT USAGE ON SCHEMA extensions, public TO civiclink_app;
ALTER DEFAULT PRIVILEGES FOR ROLE civiclink_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO civiclink_app;
ALTER DEFAULT PRIVILEGES FOR ROLE civiclink_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO civiclink_app;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION civiclink_app;
