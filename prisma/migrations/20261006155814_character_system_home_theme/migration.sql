-- CreateTable
CREATE TABLE "characters" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "rig_id" TEXT NOT NULL,
    "default_loadout_id" TEXT NOT NULL,
    "unlock_type" TEXT NOT NULL,
    "unlock_amount" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_items" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "rig_id" TEXT NOT NULL,
    "attachment" JSONB NOT NULL,
    "compatible_character_ids" TEXT[],
    "source_type" TEXT NOT NULL,
    "event_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "character_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_characters" (
    "user_id" UUID NOT NULL,
    "character_id" TEXT NOT NULL,
    "acquired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_characters_pkey" PRIMARY KEY ("user_id","character_id")
);

-- CreateTable
CREATE TABLE "user_character_items" (
    "user_id" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "event_id" TEXT,
    "acquired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_character_items_pkey" PRIMARY KEY ("user_id","item_id")
);

-- CreateTable
CREATE TABLE "event_coin_wallets" (
    "user_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_coin_wallets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "event_coin_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_coin_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_world_theme_layers" (
    "id" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "environment" JSONB,
    "lighting" JSONB,
    "atmosphere" JSONB,
    "decorations" JSONB,
    "audio" JSONB,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "home_world_theme_layers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "character_items_category_idx" ON "character_items"("category");

-- CreateIndex
CREATE INDEX "character_items_source_type_idx" ON "character_items"("source_type");

-- CreateIndex
CREATE INDEX "user_characters_character_id_idx" ON "user_characters"("character_id");

-- CreateIndex
CREATE INDEX "user_character_items_item_id_idx" ON "user_character_items"("item_id");

-- CreateIndex
CREATE INDEX "event_coin_transactions_user_id_created_at_idx" ON "event_coin_transactions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "home_world_theme_layers_is_active_starts_at_ends_at_idx" ON "home_world_theme_layers"("is_active", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "home_world_theme_layers_priority_idx" ON "home_world_theme_layers"("priority");

-- AddForeignKey
ALTER TABLE "user_characters" ADD CONSTRAINT "user_characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_characters" ADD CONSTRAINT "user_characters_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_character_items" ADD CONSTRAINT "user_character_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_character_items" ADD CONSTRAINT "user_character_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "character_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_coin_wallets" ADD CONSTRAINT "event_coin_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_coin_transactions" ADD CONSTRAINT "event_coin_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
