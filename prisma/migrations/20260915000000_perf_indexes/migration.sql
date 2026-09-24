-- Performance indexes for slow feed/connection/DM paths.
-- Supports real WHERE/ORDER BY patterns already in the codebase:
-- blocks by blockedUserId, thought flags by userId, thought reports by
-- reporterId, connections by receiver/requester+status+createdAt and
-- status+updatedAt, conversation members by userId.

CREATE INDEX IF NOT EXISTS "blocks_blocked_user_id_idx" ON "blocks"("blocked_user_id");

CREATE INDEX IF NOT EXISTS "thought_likes_user_id_thought_id_idx" ON "thought_likes"("user_id", "thought_id");

CREATE INDEX IF NOT EXISTS "thought_shares_user_id_thought_id_idx" ON "thought_shares"("user_id", "thought_id");

CREATE INDEX IF NOT EXISTS "thought_hides_user_id_thought_id_idx" ON "thought_hides"("user_id", "thought_id");

CREATE INDEX IF NOT EXISTS "thought_reports_reporter_id_idx" ON "thought_reports"("reporter_id");

CREATE INDEX IF NOT EXISTS "connections_receiver_id_status_created_at_idx" ON "connections"("receiver_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "connections_requester_id_status_created_at_idx" ON "connections"("requester_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "connections_status_updated_at_idx" ON "connections"("status", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "conversation_members_user_id_idx" ON "conversation_members"("user_id");
