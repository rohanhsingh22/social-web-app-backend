-- Phase 1 admin console: owner role, isolated admin sessions, MFA, invites, audit.
-- Enum uses the transactional swap pattern (ALTER TYPE ... ADD VALUE cannot run
-- inside a transaction block on PostgreSQL).

-- AlterEnum
CREATE TYPE "UserRole_new" AS ENUM ('user', 'moderator', 'admin', 'owner');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user';

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "mfa_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_mfa_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'totp',
    "secret_encrypted" TEXT NOT NULL,
    "enabled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),
    "last_used_step" BIGINT,

    CONSTRAINT "admin_mfa_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_invitations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "request_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_sessions_user_id_revoked_at_expires_at_idx" ON "admin_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");
CREATE UNIQUE INDEX "admin_mfa_credentials_user_id_key" ON "admin_mfa_credentials"("user_id");
CREATE INDEX "admin_recovery_codes_user_id_idx" ON "admin_recovery_codes"("user_id");
CREATE UNIQUE INDEX "admin_invitations_token_hash_key" ON "admin_invitations"("token_hash");
CREATE INDEX "admin_invitations_user_id_idx" ON "admin_invitations"("user_id");
CREATE UNIQUE INDEX "admin_audit_events_idempotency_key_key" ON "admin_audit_events"("idempotency_key");
CREATE INDEX "admin_audit_events_created_at_idx" ON "admin_audit_events"("created_at" DESC);
CREATE INDEX "admin_audit_events_actor_id_created_at_idx" ON "admin_audit_events"("actor_id", "created_at" DESC);
CREATE INDEX "admin_audit_events_target_type_target_id_idx" ON "admin_audit_events"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mfa_credentials" ADD CONSTRAINT "admin_mfa_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_recovery_codes" ADD CONSTRAINT "admin_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
