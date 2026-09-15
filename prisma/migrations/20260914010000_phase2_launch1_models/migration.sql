-- Phase 2 (Launch 1 prep): Toli, avatar selection, Thoughts, Notifications.
-- Additive only: new tables, columns, and enums. No backfill required
-- (new columns are nullable or have defaults). Seeding of the five Tolies
-- happens in prisma/seed.ts, not here.

-- New enum types
CREATE TYPE "ProfilePictureType" AS ENUM ('provider', 'toli');
CREATE TYPE "NotificationType" AS ENUM ('connection_request', 'connection_accepted', 'new_dm', 'legal_notice');

-- Toli rooms reuse the channel architecture
ALTER TYPE "ChannelType" ADD VALUE 'toli';

-- Tolies: clan identity reference data (no user creation in Launch 1)
CREATE TABLE "tolis" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "motto" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tolis_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tolis_name_key" ON "tolis"("name");

-- Profile: optional Toli membership + active picture source
ALTER TABLE "profiles" ADD COLUMN "toli_id" UUID;
ALTER TABLE "profiles" ADD COLUMN "profile_picture_type" "ProfilePictureType" NOT NULL DEFAULT 'provider';
ALTER TABLE "profiles" ADD COLUMN "toli_avatar_key" TEXT;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_toli_id_fkey" FOREIGN KEY ("toli_id") REFERENCES "tolis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "profiles_toli_id_idx" ON "profiles"("toli_id");

-- Channels: at most one room per Toli (NULL = public room)
ALTER TABLE "channels" ADD COLUMN "toli_id" UUID;
ALTER TABLE "channels" ADD CONSTRAINT "channels_toli_id_fkey" FOREIGN KEY ("toli_id") REFERENCES "tolis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "channels_toli_id_key" ON "channels"("toli_id");

-- Thoughts: text-only feed (no media in Launch 1)
CREATE TABLE "thoughts" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "thoughts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "thoughts_author_id_idx" ON "thoughts"("author_id");
CREATE INDEX "thoughts_status_created_at_idx" ON "thoughts"("status", "created_at" DESC);
ALTER TABLE "thoughts" ADD CONSTRAINT "thoughts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "thought_likes" (
    "thought_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thought_likes_pkey" PRIMARY KEY ("thought_id", "user_id")
);
ALTER TABLE "thought_likes" ADD CONSTRAINT "thought_likes_thought_id_fkey" FOREIGN KEY ("thought_id") REFERENCES "thoughts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thought_likes" ADD CONSTRAINT "thought_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "thought_comments" (
    "id" UUID NOT NULL,
    "thought_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "thought_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "thought_comments_thought_id_created_at_idx" ON "thought_comments"("thought_id", "created_at" DESC);
CREATE INDEX "thought_comments_author_id_idx" ON "thought_comments"("author_id");
ALTER TABLE "thought_comments" ADD CONSTRAINT "thought_comments_thought_id_fkey" FOREIGN KEY ("thought_id") REFERENCES "thoughts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thought_comments" ADD CONSTRAINT "thought_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "thought_shares" (
    "thought_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thought_shares_pkey" PRIMARY KEY ("thought_id", "user_id")
);
ALTER TABLE "thought_shares" ADD CONSTRAINT "thought_shares_thought_id_fkey" FOREIGN KEY ("thought_id") REFERENCES "thoughts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thought_shares" ADD CONSTRAINT "thought_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "thought_hides" (
    "thought_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thought_hides_pkey" PRIMARY KEY ("thought_id", "user_id")
);
ALTER TABLE "thought_hides" ADD CONSTRAINT "thought_hides_thought_id_fkey" FOREIGN KEY ("thought_id") REFERENCES "thoughts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thought_hides" ADD CONSTRAINT "thought_hides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "thought_reports" (
    "id" UUID NOT NULL,
    "thought_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "thought_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "thought_reports_thought_id_idx" ON "thought_reports"("thought_id");
CREATE INDEX "thought_reports_status_idx" ON "thought_reports"("status");
ALTER TABLE "thought_reports" ADD CONSTRAINT "thought_reports_thought_id_fkey" FOREIGN KEY ("thought_id") REFERENCES "thoughts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thought_reports" ADD CONSTRAINT "thought_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ranking events. thought_id is NULL for non-thought events
-- (profile_open, connection_request).
CREATE TABLE "thought_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "thought_id" UUID,
    "type" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thought_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "thought_events_thought_id_created_at_idx" ON "thought_events"("thought_id", "created_at" DESC);
CREATE INDEX "thought_events_actor_id_created_at_idx" ON "thought_events"("actor_id", "created_at" DESC);
CREATE INDEX "thought_events_type_created_at_idx" ON "thought_events"("type", "created_at" DESC);
ALTER TABLE "thought_events" ADD CONSTRAINT "thought_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thought_events" ADD CONSTRAINT "thought_events_thought_id_fkey" FOREIGN KEY ("thought_id") REFERENCES "thoughts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Single notification store for Launch 1 (connection_request,
-- connection_accepted, new_dm, legal_notice only).
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "metadata" JSONB,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notifications_recipient_id_created_at_idx" ON "notifications"("recipient_id", "created_at" DESC);
CREATE INDEX "notifications_recipient_id_read_at_idx" ON "notifications"("recipient_id", "read_at");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
