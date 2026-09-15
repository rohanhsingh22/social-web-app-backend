-- Phase 3 (Launch 1): HiRotoli-owned interests for profile + Thought ranking.
-- Additive only; existing rows default to empty.
ALTER TABLE "profiles" ADD COLUMN "interests" TEXT[] NOT NULL DEFAULT '{}';
