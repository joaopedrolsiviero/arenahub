import type { PaymentMode, Sport } from './arena';

// Espelha exatamente o Booking do backend (apps/api/src/modules/bookings) e
// o tipo já usado no Web (apps/web/src/lib/types.ts) — confirmado lendo
// bookings.controller.ts, create-customer-booking.dto.ts e o schema.prisma
// antes de escrever este arquivo (M3, item 5/27/28). Datas e `total`
// chegam como string (Decimal do Prisma / Date serializados em JSON),
// nunca number/Date direto.

export type BookingStatus = 'CONFIRMED' | 'CANCELLED';
export type BookingType = 'CUSTOMER' | 'BLOCK' | 'MAINTENANCE';

export interface Booking {
  id: string;
  courtId: string;
  userId: string | null;
  type: BookingType;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  bufferMinutesSnapshot: number;
  total: string;
  reason: string | null;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// POST .../bookings devolve um Booking único quando só `startsAt` foi
// enviado, ou um array quando `additionalStartTimes` também foi (trechos
// não consecutivos viram Bookings separados — regra do backend, nunca
// reproduzida aqui, só consumida). Ver BookingsService.createCustomerBookingBatch.
export type CreateBookingResponse = Booking | Booking[];

// Representação local da reserva em construção — nunca enviada ao backend
// como está; existe só para o mobile saber o que mostrar no resumo antes de
// montar o payload real (M3, item 8). Nunca a fonte de verdade: preço,
// disponibilidade e o resultado final da criação continuam decididos
// exclusivamente pelo POST .../bookings.
export interface BookingDraft {
  arenaSlug: string;
  arenaId: string;
  courtId: string;
  /** yyyy-MM-dd, no timezone da arena. */
  date: string;
  /** ISO 8601 — sempre ordenado, sempre não vazio quando o draft "existe". */
  startTimes: string[];
}

// "Minhas reservas" (M5) — espelha exatamente MyBooking do backend
// (bookings.service.ts) e do Web (apps/web/src/lib/types.ts), confirmado
// lendo my-bookings.controller.ts/bookings.service.ts antes de escrever
// este arquivo. Enriquecido com court/arena (nome, timezone, paymentMode)
// porque, ao contrário do resto do fluxo de reserva, esta consulta é
// cross-arena — inclusive os IDs necessários para montar a própria URL de
// cancelamento (POST .../arenas/:arenaId/courts/:courtId/bookings/:id/cancel),
// que continua sendo o endpoint já existente, nunca um novo.
export interface MyBooking {
  id: string;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  total: string;
  court: {
    id: string;
    name: string;
    sport: Sport;
    arena: {
      id: string;
      name: string;
      slug: string;
      timezone: string;
      paymentMode: PaymentMode;
    };
  };
}
