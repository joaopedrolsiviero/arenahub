import { useQuery } from '@tanstack/react-query';
import { discoverArenaBySlug, discoverArenas } from '@/api/arenas';

// Lista pública de arenas — cache razoável (M2, item 9): a listagem não
// muda a cada segundo como disponibilidade muda, então staleTime:0 aqui só
// geraria requisições desnecessárias toda vez que a aba Explorar reabre.
// 5 minutos é conservador o bastante pra nunca esconder uma arena nova por
// muito tempo, sem refazer a consulta a cada foco de tela.
const ARENA_LIST_STALE_TIME_MS = 5 * 60_000;

export function useDiscoverArenas() {
  return useQuery({
    queryKey: ['discover-arenas'],
    queryFn: discoverArenas,
    staleTime: ARENA_LIST_STALE_TIME_MS,
  });
}

export function useDiscoverArena(slug: string | undefined) {
  return useQuery({
    queryKey: ['discover-arena', slug],
    queryFn: () => discoverArenaBySlug(slug!),
    enabled: !!slug,
    staleTime: ARENA_LIST_STALE_TIME_MS,
  });
}
