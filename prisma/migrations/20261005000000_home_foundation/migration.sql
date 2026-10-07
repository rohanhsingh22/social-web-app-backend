-- Phase 1 (Home domain foundation): Home, membership, invitations, join requests.
-- Additive only: new enum types + four tables. PostgreSQL remains the
-- authoritative source for membership; presence (Redis) and voice (SFU)
-- are never stored here.

-- New enum types
CREATE TYPE "HomeMemberRole" AS ENUM ('OWNER', 'PARTICIPANT');
CREATE TYPE "HomeInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "HomeJoinRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- Homes: one row per active Home. owner_id is unique so a user can own
-- at most one Home; membership's UNIQUE(user_id) enforces one Home per
-- user overall (owner always holds an OWNER membership).
CREATE TABLE "homes" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "homes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "homes_owner_id_key" ON "homes"("owner_id");
ALTER TABLE "homes" ADD CONSTRAINT "homes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Membership: who is actually in the Home. UNIQUE(user_id) guarantees
-- one active Home membership per user; UNIQUE(home_id, user_id) prevents
-- duplicate rows. Invitations never reserve capacity.
CREATE TABLE "home_memberships" (
    "id" UUID NOT NULL,
    "home_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "HomeMemberRole" NOT NULL DEFAULT 'PARTICIPANT',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "home_memberships_user_id_key" ON "home_memberships"("user_id");
CREATE UNIQUE INDEX "home_memberships_home_id_user_id_key" ON "home_memberships"("home_id", "user_id");
ALTER TABLE "home_memberships" ADD CONSTRAINT "home_memberships_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_memberships" ADD CONSTRAINT "home_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invitations: who has been invited (separate from membership).
-- Capacity is checked at acceptance time, not creation time.
CREATE TABLE "home_invitations" (
    "id" UUID NOT NULL,
    "home_id" UUID NOT NULL,
    "inviter_id" UUID NOT NULL,
    "invitee_id" UUID NOT NULL,
    "status" "HomeInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "home_invitations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "home_invitations_invitee_id_status_idx" ON "home_invitations"("invitee_id", "status");
CREATE INDEX "home_invitations_home_id_status_idx" ON "home_invitations"("home_id", "status");
CREATE INDEX "home_invitations_expires_at_idx" ON "home_invitations"("expires_at");
ALTER TABLE "home_invitations" ADD CONSTRAINT "home_invitations_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_invitations" ADD CONSTRAINT "home_invitations_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_invitations" ADD CONSTRAINT "home_invitations_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Join requests: requester asks to join via a target member they are
-- connected through (not directly via the owner). Same capacity rule.
CREATE TABLE "home_join_requests" (
    "id" UUID NOT NULL,
    "home_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "target_member_id" UUID NOT NULL,
    "status" "HomeJoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "home_join_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "home_join_requests_target_member_id_status_idx" ON "home_join_requests"("target_member_id", "status");
CREATE INDEX "home_join_requests_home_id_status_idx" ON "home_join_requests"("home_id", "status");
CREATE INDEX "home_join_requests_expires_at_idx" ON "home_join_requests"("expires_at");
ALTER TABLE "home_join_requests" ADD CONSTRAINT "home_join_requests_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_join_requests" ADD CONSTRAINT "home_join_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_join_requests" ADD CONSTRAINT "home_join_requests_target_member_id_fkey" FOREIGN KEY ("target_member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
