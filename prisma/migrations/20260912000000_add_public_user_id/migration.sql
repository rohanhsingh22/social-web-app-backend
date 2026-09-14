-- AlterTable: nullable first so existing rows can be backfilled safely
ALTER TABLE "users" ADD COLUMN "public_user_id" TEXT;

-- Unique index while nullable (PostgreSQL allows multiple NULLs)
CREATE UNIQUE INDEX "users_public_user_id_key" ON "users"("public_user_id");

-- Backfill existing users with unique HiRotoli public IDs (HT-XXXXXXXX)
DO $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  rec RECORD;
  candidate TEXT;
  body TEXT;
  i INT;
  attempts INT;
BEGIN
  FOR rec IN SELECT id FROM "users" WHERE "public_user_id" IS NULL LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      body := '';
      FOR i IN 1..8 LOOP
        body := body || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      END LOOP;
      candidate := 'HT-' || body;

      BEGIN
        UPDATE "users"
        SET "public_user_id" = candidate
        WHERE id = rec.id;
        EXIT;
      EXCEPTION
        WHEN unique_violation THEN
          IF attempts >= 25 THEN
            RAISE EXCEPTION 'Failed to allocate unique public_user_id for user %', rec.id;
          END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

-- Enforce required
ALTER TABLE "users" ALTER COLUMN "public_user_id" SET NOT NULL;
