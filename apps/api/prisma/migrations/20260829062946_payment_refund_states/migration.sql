-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundId" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_refundId_key" ON "Payment"("refundId");
