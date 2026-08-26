-- Fase 17 (Pagamentos e Ciclo de Vida Financeiro). Ciclo financeiro
-- (Payment) deliberadamente separado do ciclo operacional (Booking.status
-- continua só CONFIRMED/CANCELLED, sem alteração). Testado em banco limpo
-- (migrate reset + deploy) e contra o dev DB existente.
-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MERCADO_PAGO');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "arenaId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentProvider" NOT NULL,
    "providerPaymentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "failureReason" TEXT,
    "paidAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),
    "resultSummary" TEXT,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- CreateIndex
CREATE INDEX "Payment_arenaId_idx" ON "Payment"("arenaId");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_idempotencyKey_key" ON "Payment"("bookingId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_providerEventId_key" ON "PaymentWebhookEvent"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Editado manualmente (Prisma não tem sintaxe para índice único parcial —
-- mesma situação já registrada para a EXCLUDE constraint de Booking, Fase 4,
-- e o único-OWNER de ArenaMember, Fase 10).
--
-- "Uma mesma Booking nunca pode ser considerada financeiramente paga duas
-- vezes" (item 5/6.8 do prompt da fase) não pode ser garantido só pela
-- aplicação — um índice único parcial (só sobre as linhas WHERE status =
-- 'PAID') é a forma correta de expressar "no máximo um Payment PAID por
-- bookingId" sem impedir múltiplas TENTATIVAS (PENDING/FAILED/EXPIRED) para
-- a mesma Booking, que continuam permitidas e esperadas (retry após falha).
--
-- Sem risco de dado existente violar a constraint: esta é a migration que
-- CRIA a tabela Payment, então ela começa vazia.
CREATE UNIQUE INDEX "Payment_bookingId_single_paid"
ON "Payment" ("bookingId")
WHERE ("status" = 'PAID');

