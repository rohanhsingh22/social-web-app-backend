CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "UserStatus" AS ENUM ('active', 'muted', 'banned', 'deleted');
CREATE TYPE "UserRole" AS ENUM ('user', 'moderator', 'admin');
CREATE TYPE "ChannelType" AS ENUM ('language', 'age', 'region', 'general');
CREATE TYPE "ChannelVisibility" AS ENUM ('public', 'private');
CREATE TYPE "MessageStatus" AS ENUM ('active', 'deleted', 'hidden', 'flagged');
CREATE TYPE "ConnectionStatus" AS ENUM ('pending', 'accepted', 'rejected', 'cancelled', 'blocked');
CREATE TYPE "ReportStatus" AS ENUM ('open', 'reviewing', 'resolved', 'rejected');
CREATE TYPE "ReportReason" AS ENUM ('spam', 'harassment', 'hate_or_abuse', 'sexual_content', 'fake_profile', 'underage_safety', 'other');
CREATE TYPE "BannedWordSeverity" AS ENUM ('low', 'medium', 'high');

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "status" "UserStatus" NOT NULL DEFAULT 'active',
  "role" "UserRole" NOT NULL DEFAULT 'user',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "last_login_at" timestamptz
);

CREATE TABLE "auth_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_user_id" text NOT NULL,
  "provider_email" text,
  "provider_display_name" text,
  "provider_avatar_url" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "auth_identities_provider_provider_user_id_key" ON "auth_identities" ("provider", "provider_user_id");
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities" ("user_id");

CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "refresh_token_hash" text NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");

CREATE TABLE "profiles" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "username" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "avatar_url" text,
  "bio" text,
  "dob" date,
  "age_group" text,
  "gender" text,
  "region" text,
  "city" text,
  "primary_language" text,
  "languages" text[] NOT NULL DEFAULT '{}',
  "is_complete" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "profiles_display_name_idx" ON "profiles" ("display_name");
CREATE INDEX "profiles_region_idx" ON "profiles" ("region");
CREATE INDEX "profiles_age_group_idx" ON "profiles" ("age_group");
CREATE INDEX "profiles_languages_idx" ON "profiles" USING GIN ("languages");

CREATE TABLE "channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "type" "ChannelType" NOT NULL,
  "visibility" "ChannelVisibility" NOT NULL DEFAULT 'public',
  "is_default" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "channel_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel_id" uuid NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "sender_id" uuid NOT NULL REFERENCES "users"("id"),
  "body" text NOT NULL,
  "status" "MessageStatus" NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);

CREATE INDEX "channel_messages_channel_id_created_at_idx" ON "channel_messages" ("channel_id", "created_at" DESC);
CREATE INDEX "channel_messages_sender_id_idx" ON "channel_messages" ("sender_id");
CREATE INDEX "channel_messages_created_at_idx" ON "channel_messages" ("created_at");

CREATE TABLE "connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "requester_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "receiver_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_low_id" uuid NOT NULL,
  "user_high_id" uuid NOT NULL,
  "status" "ConnectionStatus" NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "connections_not_self_check" CHECK ("requester_id" <> "receiver_id"),
  CONSTRAINT "connections_order_check" CHECK ("user_low_id" < "user_high_id")
);

CREATE UNIQUE INDEX "connections_user_low_id_user_high_id_key" ON "connections" ("user_low_id", "user_high_id");
CREATE INDEX "connections_requester_id_idx" ON "connections" ("requester_id");
CREATE INDEX "connections_receiver_id_idx" ON "connections" ("receiver_id");
CREATE INDEX "connections_status_idx" ON "connections" ("status");

CREATE TABLE "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" text NOT NULL DEFAULT 'direct',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "conversation_members" (
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("conversation_id", "user_id")
);

CREATE TABLE "direct_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "sender_id" uuid NOT NULL REFERENCES "users"("id"),
  "body" text NOT NULL,
  "status" "MessageStatus" NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);

CREATE INDEX "direct_messages_conversation_id_created_at_idx" ON "direct_messages" ("conversation_id", "created_at" DESC);
CREATE INDEX "direct_messages_sender_id_idx" ON "direct_messages" ("sender_id");

CREATE TABLE "reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reporter_id" uuid NOT NULL REFERENCES "users"("id"),
  "target_user_id" uuid REFERENCES "users"("id"),
  "target_channel_message_id" uuid REFERENCES "channel_messages"("id"),
  "target_direct_message_id" uuid REFERENCES "direct_messages"("id"),
  "reason" "ReportReason" NOT NULL,
  "details" text,
  "status" "ReportStatus" NOT NULL DEFAULT 'open',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "reviewed_by" uuid REFERENCES "users"("id"),
  "reviewed_at" timestamptz,
  CONSTRAINT "reports_has_target_check" CHECK (
    "target_user_id" IS NOT NULL
    OR "target_channel_message_id" IS NOT NULL
    OR "target_direct_message_id" IS NOT NULL
  )
);

CREATE INDEX "reports_status_idx" ON "reports" ("status");
CREATE INDEX "reports_reporter_id_idx" ON "reports" ("reporter_id");

CREATE TABLE "blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "blocker_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "blocked_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "blocks_not_self_check" CHECK ("blocker_id" <> "blocked_user_id")
);

CREATE UNIQUE INDEX "blocks_blocker_id_blocked_user_id_key" ON "blocks" ("blocker_id", "blocked_user_id");

CREATE TABLE "moderation_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_id" uuid NOT NULL,
  "target_user_id" uuid,
  "target_message_id" uuid,
  "action" text NOT NULL,
  "reason" text,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "moderation_actions_admin_id_idx" ON "moderation_actions" ("admin_id");
CREATE INDEX "moderation_actions_target_user_id_idx" ON "moderation_actions" ("target_user_id");

CREATE TABLE "banned_words" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "word" text NOT NULL UNIQUE,
  "severity" "BannedWordSeverity" NOT NULL DEFAULT 'medium',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "channels" ("name", "slug", "type", "is_default", "sort_order")
VALUES
  ('General', 'general', 'general', true, 0),
  ('English', 'english', 'language', false, 10),
  ('Hindi', 'hindi', 'language', false, 20),
  ('Bengali', 'bengali', 'language', false, 30),
  ('Marathi', 'marathi', 'language', false, 40),
  ('Telugu', 'telugu', 'language', false, 50),
  ('Tamil', 'tamil', 'language', false, 60),
  ('Gujarati', 'gujarati', 'language', false, 70),
  ('Urdu', 'urdu', 'language', false, 80),
  ('Kannada', 'kannada', 'language', false, 90),
  ('Odia', 'odia', 'language', false, 100),
  ('Malayalam', 'malayalam', 'language', false, 110),
  ('Assamese', 'assamese', 'language', false, 120),
  ('Nepali', 'nepali', 'language', false, 130);
