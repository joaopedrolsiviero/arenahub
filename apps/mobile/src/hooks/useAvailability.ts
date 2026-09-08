import { useQuery } from '@tanstack/react-query';
import { getCourtAvailability } from '@/api/availability';

// REGRA CRÍTICA (M2, item 10): o backend é a única autoridade sobre
// disponibilidade — este hook só transporta `from`/`to` e devolve os slots
// exatamente como a API respondeu, nunca recalcula nem filtra localmente.
// `staleTime: 0` (nunca cache), mesmo motivo já registrado no Web pra
// `useAvailability`: outra pessoa pode ocupar o horário a qualquer momento.
export function useCourtAvailability(
  arenaId: string | undefined,
  courtId: string | undefined,
  from: string | undefined,
  to: string | undefined,
) {
  return useQuery({
    queryKey: ['availability', arenaId, courtId, from, to],
    queryFn: () => getCourtAvailability(arenaId!, courtId!, from!, to!),
    enabled: !!arenaId && !!courtId && !!from && !!to,
    staleTime: 0,
  });
}
