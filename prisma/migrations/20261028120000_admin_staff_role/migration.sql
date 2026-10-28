-- BE-2: collapse Viewer, Editor, and Communications into Admin / Staff.
-- Hand-written. `prisma migrate dev` cannot run here: the owner role
-- civiclink_owner does not authenticate to the local database (P1000),
-- the same fallback used for 20261027120000_admin_password_auth.
-- Apply with the database owner. Existing SUPER_ADMIN rows stay;
-- every other admin role becomes ADMIN_STAFF.

CREATE TYPE "AdminRole_new" AS ENUM ('SUPER_ADMIN', 'ADMIN_STAFF');

ALTER TABLE "admin_users"
  ALTER COLUMN "role" TYPE "AdminRole_new"
  USING (
    CASE "role"::text
      WHEN 'SUPER_ADMIN' THEN 'SUPER_ADMIN'
      ELSE 'ADMIN_STAFF'
    END
  )::"AdminRole_new";

DROP TYPE "AdminRole";

ALTER TYPE "AdminRole_new" RENAME TO "AdminRole";
