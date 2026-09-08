import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cancelBooking } from '@/api/bookings';
import { useApiToken } from './useApiToken';
import type { Booking } from '@/types/booking';

interface CancelBookingVariables {
  arenaId: string;
  courtId: string;
  bookingId: string;
}

// Cancelamento (M5) — mesmo endpoint/mutação do Web (use-api.ts,
// useCancelBooking). Nunca atualiza o status localmente a partir do
// `Booking` bruto devolvido pelo POST (ele nem inclui court/arena) — a tela
// sempre relê o estado real via invalidação das queries afetadas, exatamente
// como o Web já faz:
// - ['my-bookings'] — lista e detalhe (mesma key-prefix de useMyBookings/useMyBooking)
// - ['availability', arenaId, courtId] — o horário cancelado volta a ficar livre
// - ['booking-payment', bookingId] — cancelar pode ter disparado refund
//   (BookingsController.cancel chama PaymentsService.refundIfPaid de forma
//   best-effort); refaz a consulta pra refletir REFUNDING/REFUNDED sem
//   esperar o próximo poll.
// - ['my-payment-statuses'] — mesma razão acima, mas para o mapa usado pela
//   lista (Escopo 7 desta fase pede explicitamente invalidar "informações de
//   pagamento, se afetadas"; o Web não invalida esta key hoje — divergência
//   inofensiva registrada no relatório final, não uma regra de negócio nova).
export function useCancelBooking() {
  const getToken = useApiToken();
  const queryClient = useQueryClient();

  return useMutation<Booking, unknown, CancelBookingVariables>({
    mutationFn: async ({ arenaId, courtId, bookingId }) =>
      cancelBooking(await getToken(), arenaId, courtId, bookingId),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      await queryClient.invalidateQueries({
        queryKey: ['availability', variables.arenaId, variables.courtId],
      });
      await queryClient.invalidateQueries({ queryKey: ['booking-payment', variables.bookingId] });
      await queryClient.invalidateQueries({ queryKey: ['my-payment-statuses'] });
    },
  });
}
