-- Fase 16 (WhatsApp): identidade do cliente é sempre o User existente
-- (User.phone, já sincronizado do Clerk desde a Fase 2) — nenhuma tabela de
-- identidade paralela. WhatsAppConversation guarda só o estado mínimo pra
-- retomar um fluxo em andamento (nunca o texto das mensagens). WhatsAppEvent
-- deduplica eventos do webhook (mesma técnica "claim-first" do
-- IdempotencyKey da Fase 4: INSERT com providerEventId único falha se o
-- evento já foi processado). Testado em banco limpo (migrate reset + deploy)
-- e contra o dev DB existente (nenhum User.phone ou Arena.
-- whatsappPhoneNumberId duplicado hoje, então as duas novas UNIQUE não
-- quebram dado existente).
-- CreateEnum
CREATE TYPE "WhatsAppConversationState" AS ENUM ('IDLE', 'SELECTING_DATE', 'SELECTING_TIME', 'SELECTING_COURT', 'CONFIRMING_BOOKING', 'PROCESSING_BOOKING', 'BOOKING_CONFIRMED', 'CANCEL_SELECTING', 'CANCEL_CONFIRMATION', 'PROCESSING_CANCELLATION');

-- AlterTable
ALTER TABLE "Arena" ADD COLUMN     "whatsappPhoneNumberId" TEXT;

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "arenaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" "WhatsAppConversationState" NOT NULL DEFAULT 'IDLE',
    "pendingOptions" JSONB,
    "pendingDate" TEXT,
    "pendingTime" TEXT,
    "pendingCourtId" TEXT,
    "pendingBookingId" TEXT,
    "pendingActionId" TEXT,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppEvent" (
    "id" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_arenaId_userId_key" ON "WhatsAppConversation"("arenaId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppEvent_providerEventId_key" ON "WhatsAppEvent"("providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Arena_whatsappPhoneNumberId_key" ON "Arena"("whatsappPhoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

