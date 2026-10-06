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
