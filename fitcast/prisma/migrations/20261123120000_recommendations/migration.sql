-- CreateEnum
CREATE TYPE "FeedbackVerdict" AS ENUM ('LIKE', 'DISLIKE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'DATE';
ALTER TYPE "EventType" ADD VALUE 'WEDDING_GUEST';
ALTER TYPE "EventType" ADD VALUE 'INTERVIEW';
ALTER TYPE "EventType" ADD VALUE 'PARTY';
ALTER TYPE "EventType" ADD VALUE 'THEATER';
ALTER TYPE "EventType" ADD VALUE 'TRAVEL';
ALTER TYPE "EventType" ADD VALUE 'STUDY';
ALTER TYPE "EventType" ADD VALUE 'FAMILY_WALK';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GarmentType" ADD VALUE 'CARDIGAN';
ALTER TYPE "GarmentType" ADD VALUE 'BLAZER';

-- AlterTable
ALTER TABLE "saved_outfits" ADD COLUMN     "event_id" TEXT,
ADD COLUMN     "explanation" VARCHAR(400);

-- CreateTable
CREATE TABLE "outfit_feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "outfit_key" TEXT NOT NULL,
    "item_ids" TEXT[],
    "context" TEXT NOT NULL,
    "event_id" TEXT,
    "event_type" "EventType" NOT NULL,
    "temperature_c" DOUBLE PRECISION NOT NULL,
    "precipitation" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "verdict" "FeedbackVerdict" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outfit_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outfit_feedback_user_id_idx" ON "outfit_feedback"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "outfit_feedback_user_id_outfit_key_context_key" ON "outfit_feedback"("user_id", "outfit_key", "context");

-- AddForeignKey
ALTER TABLE "outfit_feedback" ADD CONSTRAINT "outfit_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_outfits" ADD CONSTRAINT "saved_outfits_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "user_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

