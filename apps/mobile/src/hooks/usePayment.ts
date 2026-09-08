import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createBookingPayment, getBookingPayment, getMyPaymentStatuses } from '@/api/payments';
import { useApiToken } from './useApiToken';
import type { PaymentView } from '@/types/payment';

// GET .../payment — mesmo comportamento de polling do Web
// (apps/web/src/hooks/use-api.ts, useBookingPayment): um PIX PENDING pode
// mudar de status a qualquer momento via webhook, sem nenhuma ação do
// próprio usuário nesta tela — refaz a consulta a cada 5s enquanto
// PENDING/REFUNDING (M4, item 14: "se o Web usa 5 segundos e o contrato
// continua apropriado, pode manter esse comportamento"), para
// automaticamente ao chegar num estado terminal. TanStack Query já cuida
// de nunca haver duas consultas concorrentes (uma query, uma key) e de
// parar o timer quando o componente desmonta — nenhum setInterval manual.
export function usePayment(bookingId: string | undefined) {
  const getToken = useApiToken();
  return useQuery({
    queryKey: ['booking-payment', bookingId],
    queryFn: async () => getBookingPayment(await getToken(), bookingId!),
    enabled: !!bookingId,
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING' || query.state.data?.status === 'REFUNDING' ? 5_000 : false,
  });
}

// "Minhas reservas" (M5) — mesma query key do Web (use-api.ts,
// useMyPaymentStatuses), consultada em paralelo com useMyBookings pra
// mostrar o status do pagamento junto do status da reserva SEM N+1 (uma
// chamada só pra todas as reservas, nunca uma por item da lista). `enabled`
// segue o mesmo motivo de useMyBookings — esperar a sessão Clerk antes de
// disparar a consulta.
export function useMyPaymentStatuses(enabled = true) {
  const getToken = useApiToken();
  return useQuery({
    queryKey: ['my-payment-statuses'],
    queryFn: async () => getMyPaymentStatuses(await getToken()),
    enabled,
  });
}

interface CreatePaymentVariables {
  idempotencyKey: string;
}

export function useCreatePayment(bookingId: string) {
  const getToken = useApiToken();
  const queryClient = useQueryClient();

  return useMutation<PaymentView, unknown, CreatePaymentVariables>({
    mutationFn: async ({ idempotencyKey }) =>
      createBookingPayment(await getToken(), bookingId, idempotencyKey),
    onSuccess: async (payment) => {
      queryClient.setQueryData(['booking-payment', bookingId], payment);
      await queryClient.invalidateQueries({ queryKey: ['booking-payment', bookingId] });
    },
  });
}
