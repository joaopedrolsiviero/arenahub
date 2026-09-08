import { useQuery } from '@tanstack/react-query';
import { getMyBooking, getMyBookings } from '@/api/bookings';
import { useApiToken } from './useApiToken';

// "Minhas reservas" (M5) — mesma query key do Web (apps/web/src/hooks/use-api.ts,
// useMyBookings/useMyBooking), reaproveitada aqui pra que a invalidação feita
// por useCancelBooking alcance as duas (lista e detalhe) sem precisar
// conhecer qual delas está montada no momento.
//
// `enabled` (default true) existe pra a tela poder esperar a sessão do
// Clerk carregar/logar antes de disparar a consulta — nunca chamado sem
// sessão só pra deixar o 401 acontecer (mesmo padrão de useDiscoverArena
// para `slug`/`enabled: !!slug`).
export function useMyBookings(enabled = true) {
  const getToken = useApiToken();
  return useQuery({
    queryKey: ['my-bookings'],
    queryFn: async () => getMyBookings(await getToken()),
    enabled,
  });
}

export function useMyBooking(bookingId: string | undefined, enabled = true) {
  const getToken = useApiToken();
  return useQuery({
    queryKey: ['my-bookings', bookingId],
    queryFn: async () => getMyBooking(await getToken(), bookingId!),
    enabled: !!bookingId && enabled,
  });
}
