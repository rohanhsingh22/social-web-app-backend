-- Enforce case-insensitive display-name uniqueness (Launch 1 identity rule).
-- Rohan / rohan / ROHAN must collide. Implemented as a normalized column so
-- Prisma remains the source of truth for the constraint (a functional index
-- would be invisible to `prisma migrate dev` and could be dropped later).

-- Nullable first so existing rows can be backfilled safely.
ALTER TABLE "profiles" ADD COLUMN "display_name_normalized" TEXT;

-- Backfill from current display names.
UPDATE "profiles"
SET "display_name_normalized" = LOWER(TRIM("display_name"))
WHERE "display_name_normalized" IS NULL;

-- Fail fast with a clear message if existing rows already collide.
DO $$
DECLARE
  dup_groups INT;
BEGIN
  SELECT COUNT(*) INTO dup_groups FROM (
    SELECT "display_name_normalized" FROM "profiles"
    GROUP BY "display_name_normalized" HAVING COUNT(*) > 1
  ) AS dups;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'Cannot enforce case-insensitive display-name uniqueness: % duplicate group(s) exist. Resolve colliding displayNames before migrating.', dup_groups;
  END IF;
END $$;

-- Enforce required + unique.
ALTER TABLE "profiles" ALTER COLUMN "display_name_normalized" SET NOT NULL;
CREATE UNIQUE INDEX "profiles_display_name_normalized_key" ON "profiles"("display_name_normalized");
