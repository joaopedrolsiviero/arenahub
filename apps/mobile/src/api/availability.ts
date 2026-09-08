import { apiRequest } from './client';
import type { AvailabilityResult } from '@/types/arena';

// GET /v1/arenas/:arenaId/courts/:courtId/availability?from&to — público,
// sem guard (confirmado em availability.controller.ts, M2 item 4). `from`/
// `to` precisam chegar aqui já como ISO 8601 válido (instantes absolutos,
// nunca "data local solta") — quem chama (o hook) é responsável por
// resolver isso a partir da data escolhida + timezone da arena, nunca este
// arquivo, que só transporta.
export function getCourtAvailability(
  arenaId: string,
  courtId: string,
  from: string,
  to: string,
): Promise<AvailabilityResult> {
  const query = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return apiRequest(`/arenas/${arenaId}/courts/${courtId}/availability${query}`);
}
