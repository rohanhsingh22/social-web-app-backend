-- DropForeignKey
ALTER TABLE "admin_invitations" DROP CONSTRAINT "admin_invitations_invited_by_fkey";

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "thought_reports_status_created_at_idx" ON "thought_reports"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "users_status_created_at_idx" ON "users"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "users_role_created_at_idx" ON "users"("role", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
