-- CreateEnum
CREATE TYPE "GarmentType" AS ENUM ('TSHIRT', 'SHIRT', 'JACKET', 'COAT', 'SWEATER', 'HOODIE', 'PANTS', 'JEANS', 'SHORTS', 'SKIRT', 'DRESS', 'SHOES', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "FitTag" AS ENUM ('GOOD', 'TIGHT', 'LOOSE');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('CASUAL', 'GYM', 'BUSINESS', 'FORMAL', 'OUTDOOR');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wardrobe_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "GarmentType" NOT NULL,
    "dominant_color" TEXT NOT NULL,
    "fit_tag" "FitTag" NOT NULL,
    "image_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wardrobe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_outfits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event_type" "EventType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_outfits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outfit_items" (
    "outfit_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,

    CONSTRAINT "outfit_items_pkey" PRIMARY KEY ("outfit_id","item_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "wardrobe_items_user_id_idx" ON "wardrobe_items"("user_id");

-- CreateIndex
CREATE INDEX "saved_outfits_user_id_idx" ON "saved_outfits"("user_id");

-- AddForeignKey
ALTER TABLE "wardrobe_items" ADD CONSTRAINT "wardrobe_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_outfits" ADD CONSTRAINT "saved_outfits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_items" ADD CONSTRAINT "outfit_items_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "saved_outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outfit_items" ADD CONSTRAINT "outfit_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "wardrobe_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
