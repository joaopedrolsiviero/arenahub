import { api, ApiError } from './api';
import type { ArenaDiscoveryDetail } from './types';

// Fase 32 — resolve o segmento :arenaSlug de uma rota pública. Server-only
// (chamado a partir de page.tsx/generateMetadata, nunca do componente
// cliente — que sempre recebe o `id` real já resolvido, exatamente como
// antes desta fase).
//
// 'ok': era o slug canônico — uma única requisição pública, igual a
// qualquer outra leitura de descoberta.
// 'legacy-id': não bateu como slug, mas bateu como o ID técnico antigo (link
// compartilhado antes da Fase 32) — nunca quebra um link já compartilhado,
// só precisa de um redirect permanente pro slug.
// 'not-found': não é nem slug nem ID válido.
export type ArenaRouteResolution =
  | { kind: 'ok'; arena: ArenaDiscoveryDetail }
  | { kind: 'legacy-id'; arena: ArenaDiscoveryDetail }
  | { kind: 'not-found' };

export async function resolveArenaBySlugOrLegacyId(
  arenaSlugParam: string,
): Promise<ArenaRouteResolution> {
  try {
    const arena = await api.discoverArenaBySlug(arenaSlugParam);
    return { kind: 'ok', arena };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }
  }

  try {
    const arena = await api.discoverArena(null, arenaSlugParam);
    return { kind: 'legacy-id', arena };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }
  }

  return { kind: 'not-found' };
}
