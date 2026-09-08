import { apiRequest } from './client';
import type { ArenaDiscoveryDetail, ArenaDiscoverySummary } from '@/types/arena';

// GET /v1/arenas/discover e GET /v1/arenas/discover/slug/:slug — públicos,
// sem guard nenhum no backend (confirmado em arenas.controller.ts antes de
// escrever este arquivo, M2 item 4/23) — `token` nunca é passado aqui.
export function discoverArenas(): Promise<ArenaDiscoverySummary[]> {
  return apiRequest('/arenas/discover');
}

export function discoverArenaBySlug(slug: string): Promise<ArenaDiscoveryDetail> {
  return apiRequest(`/arenas/discover/slug/${encodeURIComponent(slug)}`);
}
