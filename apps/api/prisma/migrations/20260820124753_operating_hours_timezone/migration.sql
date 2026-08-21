-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterTable
ALTER TABLE "Arena" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- CreateTable
CREATE TABLE "ArenaOperatingHours" (
    "id" TEXT NOT NULL,
    "arenaId" TEXT NOT NULL,
    "dayOfWeek" "Weekday" NOT NULL,
    "opensAt" INTEGER NOT NULL,
    "closesAt" INTEGER NOT NULL,

    CONSTRAINT "ArenaOperatingHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArenaOperatingHours_arenaId_dayOfWeek_idx" ON "ArenaOperatingHours"("arenaId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "ArenaOperatingHours" ADD CONSTRAINT "ArenaOperatingHours_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
