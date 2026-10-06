-- Local development only. Runs once when the Postgres container volume is first created.
-- Mirrors production: an owner role for migrations and a DML-only app role at runtime.
-- PostGIS is not a "trusted" extension, so the superuser creates it here BEFORE migrations run.
-- Mounting this folder replaces the image's own init script, so no extensions land in `public`.

CREATE ROLE civiclink_owner LOGIN PASSWORD 'owner_dev_password';
CREATE ROLE civiclink_app   LOGIN PASSWORD 'app_dev_password';

CREATE DATABASE civiclink        OWNER civiclink_owner;
CREATE DATABASE civiclink_shadow OWNER civiclink_owner;

\connect civiclink
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION civiclink_owner;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext  WITH SCHEMA extensions;
ALTER DATABASE civiclink SET search_path TO public, extensions;
GRANT USAGE ON SCHEMA extensions TO civiclink_app;
GRANT USAGE ON SCHEMA public TO civiclink_app;
ALTER DEFAULT PRIVILEGES FOR ROLE civiclink_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO civiclink_app;
ALTER DEFAULT PRIVILEGES FOR ROLE civiclink_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO civiclink_app;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION civiclink_app;
ALTER ROLE civiclink_app SET statement_timeout = '15s';
ALTER ROLE civiclink_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE civiclink_app SET lock_timeout = '5s';

\connect civiclink_shadow
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION civiclink_owner;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext  WITH SCHEMA extensions;
ALTER DATABASE civiclink_shadow SET search_path TO public, extensions;
