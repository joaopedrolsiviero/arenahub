-- CreateEnum
CREATE TYPE "BookingType" AS ENUM ('CUSTOMER', 'BLOCK', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Court" ADD COLUMN     "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pricePerSlot" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "slotDurationMinutes" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "BookingType" NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "bufferMinutesSnapshot" INTEGER NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Booking_courtId_startsAt_idx" ON "Booking"("courtId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_endpoint_key_key" ON "IdempotencyKey"("userId", "endpoint", "key");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Editado manualmente (Prisma não tem sintaxe para exclusion constraints —
-- ver docs/ARCHITECTURE.md, Parte 8, e a auditoria da Fase 1). Esta é a
-- autoridade final e definitiva contra double booking: o Postgres recusa
-- fisicamente qualquer INSERT/UPDATE que viole a regra, independentemente
-- de qualquer bug na camada de aplicação.
--
-- btree_gist é necessária para permitir comparação de igualdade (=) em
-- "courtId" (texto) dentro de um índice GiST, que por padrão só suporta os
-- operadores de range/overlap (&&).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Postgres exige que expressões dentro de um índice GiST sejam IMMUTABLE.
-- O operador `timestamptz + interval` é marcado STABLE no catálogo (a
-- volatilidade é declarada para o operador inteiro, não por unidade — ainda
-- que somar só minutos seja de fato independente de timezone/DST). A
-- solução padrão é envolver a expressão numa função SQL explicitamente
-- marcada IMMUTABLE — é seguro aqui porque estamos somando apenas minutos.
CREATE OR REPLACE FUNCTION booking_occupied_range(
  starts_at timestamptz,
  ends_at timestamptz,
  buffer_minutes integer
) RETURNS tstzrange
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT tstzrange(starts_at, ends_at + (buffer_minutes * interval '1 minute'), '[)');
$$;

-- O intervalo protegido por reserva é [startsAt, endsAt + bufferMinutesSnapshot),
-- não [startsAt, endsAt) — é assim que o buffer entre reservas de CUSTOMER é
-- garantido pelo próprio banco (bufferMinutesSnapshot = 0 para BLOCK/
-- MAINTENANCE, então eles ocupam exatamente o intervalo declarado). A
-- cláusula WHERE restringe a constraint a ocupações CONFIRMED: um Booking
-- CANCELLED nunca participa da checagem de sobreposição, então cancelar e
-- criar uma nova reserva no mesmo horário é permitido.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_no_overlap_excl"
EXCLUDE USING gist (
  "courtId" WITH =,
  booking_occupied_range("startsAt", "endsAt", "bufferMinutesSnapshot") WITH &&
) WHERE (status = 'CONFIRMED');
