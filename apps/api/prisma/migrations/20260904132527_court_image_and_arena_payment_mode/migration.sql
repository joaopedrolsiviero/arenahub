-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('ONLINE', 'IN_PERSON');

-- AlterTable
ALTER TABLE "Arena" ADD COLUMN     "paymentMode" "PaymentMode" NOT NULL DEFAULT 'ONLINE';

-- AlterTable
ALTER TABLE "Court" ADD COLUMN     "imageUrl" TEXT;
