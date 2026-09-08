import { apiRequest } from './client';
import type { PaymentStatus, PaymentView } from '@/types/payment';

// POST /v1/users/me/bookings/:bookingId/payments — confirmado em
// payments.controller.ts (M4, item 5): exige ClerkAuthGuard (`token`
// obrigatório) e o header Idempotency-Key (400 se ausente, mesma checagem
// de bookings.ts). Sem corpo — o backend não aceita nenhum campo do
// cliente (valor/status vêm exclusivamente da própria Booking).
export function createBookingPayment(
  token: string | null,
  bookingId: string,
  idempotencyKey: string,
): Promise<PaymentView> {
  return apiRequest(`/users/me/bookings/${bookingId}/payments`, {
    token,
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// GET /v1/users/me/bookings/:bookingId/payment — `null` quando a reserva
// nunca teve nenhuma tentativa de pagamento (nunca 404 nesse caso — a
// Booking existe, só não há Payment ainda). O backend devolve corpo vazio
// (não `"null"` literal) nesse caso — `apiRequest` já trata isso como
// `null` (mesmo achado da Fase 23 do Web, reaproveitado no api/client.ts).
export function getBookingPayment(
  token: string | null,
  bookingId: string,
): Promise<PaymentView | null> {
  return apiRequest(`/users/me/bookings/${bookingId}/payment`, { token });
}

// GET /v1/users/me/payments — confirmado em my-payments.controller.ts (M5):
// um mapa bookingId -> status da tentativa mais recente PARA TODAS as
// reservas do usuário numa única chamada, exatamente pra "Minhas reservas"
// mostrar o status do pagamento junto do status da reserva sem N+1 (uma
// consulta por reserva). Reservas sem nenhuma tentativa de pagamento
// simplesmente não aparecem como chave no mapa (nunca null/undefined
// explícito) — mesmo contrato já consumido pelo Web (getMyPaymentStatuses).
export function getMyPaymentStatuses(token: string | null): Promise<Record<string, PaymentStatus>> {
  return apiRequest('/users/me/payments', { token });
}
