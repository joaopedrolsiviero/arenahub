import { DateTime } from 'luxon';

// Fase de estabilização e2e (2026-09) — datas literais fixas (ex:
// '2026-09-11T10:00:00.000Z') envelhecem: assim que o calendário real
// ultrapassa a data, `BookingsService.assertNotPast` passa a rejeitar o
// fixture com 400, quebrando o teste sem nenhuma mudança de comportamento
// do sistema. Este helper sempre calcula a partir do "agora" real do
// momento em que o teste roda — nunca uma data calendário fixa — e usa
// Luxon (já usado pelo resto do projeto, nunca uma segunda biblioteca de
// data) para respeitar o timezone da arena.
//
// `daysFromNow` (sempre >= 1) garante um dia FUTURO e DISTINTO por
// chamada — a forma mais simples de nunca colidir com outra reserva de
// teste (EXCLUDE constraint da Fase 4) sem depender de horários "quase no
// limite" do expediente. O horário default (10h) fica bem dentro do
// expediente típico dos fixtures deste projeto (8h-22h), longe o
// suficiente das bordas pra nunca cair fora por causa de
// slotDurationMinutes/bufferMinutes.
export function safeBookingIso(
  daysFromNow: number,
  opts: { hour?: number; minute?: number; timezone?: string } = {},
): string {
  const { hour = 10, minute = 0, timezone = 'America/Sao_Paulo' } = opts;
  return DateTime.now()
    .setZone(timezone)
    .plus({ days: Math.max(1, daysFromNow) })
    .set({ hour, minute, second: 0, millisecond: 0 })
    .toJSDate()
    .toISOString();
}
