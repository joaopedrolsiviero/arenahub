import { apiRequest } from './client';
import type { Booking, CreateBookingResponse, MyBooking } from '@/types/booking';

// POST /v1/arenas/:arenaId/courts/:courtId/bookings — confirmado em
// bookings.controller.ts (M3, item 5): exige ClerkAuthGuard (`token`
// obrigatório aqui, diferente de arenas.ts/availability.ts) e o header
// Idempotency-Key (400 se ausente — a checagem em si é do backend, este
// client só garante que o header é sempre enviado). `additionalStartTimes`
// só entra no corpo quando não vazio — mesma decisão do Web
// (apps/web/src/lib/api.ts createBooking): omitir o campo inteiramente
// preserva o contrato antigo de "um único Booking" pra quem não usa
// múltiplos horários.
export function createBooking(
  token: string | null,
  arenaId: string,
  courtId: string,
  startsAt: string,
  idempotencyKey: string,
  additionalStartTimes?: string[],
): Promise<CreateBookingResponse> {
  return apiRequest(`/arenas/${arenaId}/courts/${courtId}/bookings`, {
    token,
    method: 'POST',
    body:
      additionalStartTimes && additionalStartTimes.length > 0
        ? { startsAt, additionalStartTimes }
        : { startsAt },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// GET /v1/users/me/bookings — confirmado em my-bookings.controller.ts (M5):
// exige ClerkAuthGuard, filtra por userId+type:CUSTOMER NO BACKEND (nunca
// filtrado aqui), já vem ordenado por startsAt desc — essa ordenação nunca é
// substituída, só reorganizada visualmente na tela (mais recente primeiro
// dentro de cada grupo; "próximas" reordena por proximidade, ver
// app/(tabs)/reservas.tsx).
export function getMyBookings(token: string | null): Promise<MyBooking[]> {
  return apiRequest('/users/me/bookings', { token });
}

// GET /v1/users/me/bookings/:bookingId — 404 (nunca 403) quando a reserva
// não existe OU não é do usuário autenticado (my-bookings.controller.ts +
// BookingsService.findMyBookingDetail): mesmo "não vazar existência" já
// usado no resto do backend — o cliente nunca consegue distinguir "não
// existe" de "é de outra pessoa", o que já resolve IDOR sem nenhuma checagem
// extra aqui.
export function getMyBooking(token: string | null, bookingId: string): Promise<MyBooking> {
  return apiRequest(`/users/me/bookings/${bookingId}`, { token });
}

// POST .../bookings/:bookingId/cancel — confirmado em bookings.controller.ts
// (M5): SEM Idempotency-Key (o cancelamento é idempotente pela própria
// máquina de estados — CONFIRMED->CANCELLED é uma transição terminal, ver
// BookingsService.cancel — nunca pelo mecanismo formal de idempotência, que
// existe só para proteger CRIAÇÃO). `arenaId`/`courtId` vêm sempre de
// `booking.court`/`booking.court.arena` (nunca inventados/guardados à parte
// no cliente) — a mesma URL que o resto de BookingsController já usa, nenhum
// endpoint novo.
export function cancelBooking(
  token: string | null,
  arenaId: string,
  courtId: string,
  bookingId: string,
): Promise<Booking> {
  return apiRequest(`/arenas/${arenaId}/courts/${courtId}/bookings/${bookingId}/cancel`, {
    token,
    method: 'POST',
  });
}
