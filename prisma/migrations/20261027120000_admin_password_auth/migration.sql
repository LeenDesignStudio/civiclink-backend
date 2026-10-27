-- Admin email and password. Google subject is no longer a login key.
DROP INDEX "admin_users_google_subject_key";

ALTER TABLE "admin_users" DROP COLUMN "google_subject";
ALTER TABLE "admin_users" ADD COLUMN "password_hash" VARCHAR(255);
ALTER TABLE "admin_users" ADD COLUMN "password_updated_at" TIMESTAMPTZ(3);
ALTER TABLE "admin_users" ADD COLUMN "invited_at" TIMESTAMPTZ(3);

CREATE TYPE "AdminAuthTokenPurpose" AS ENUM ('INVITE', 'RESET');

CREATE TABLE "admin_auth_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_user_id" UUID NOT NULL,
    "purpose" "AdminAuthTokenPurpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_auth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_auth_tokens_token_hash_key" ON "admin_auth_tokens"("token_hash");
CREATE INDEX "admin_auth_tokens_admin_user_id_purpose_idx" ON "admin_auth_tokens"("admin_user_id", "purpose");

ALTER TABLE "admin_auth_tokens" ADD CONSTRAINT "admin_auth_tokens_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
