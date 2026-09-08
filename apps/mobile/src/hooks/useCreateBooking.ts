import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createBooking } from '@/api/bookings';
import { useApiToken } from './useApiToken';
import type { CreateBookingResponse } from '@/types/booking';

interface CreateBookingVariables {
  startsAt: string;
  idempotencyKey: string;
  additionalStartTimes?: string[];
}

// Mutation de criação de reserva (M3, item 19) — o próprio hook busca o
// token fresco do Clerk e monta o header Idempotency-Key; a tela nunca
// chama api/bookings.ts nem apiRequest diretamente. Ao concluir, invalida a
// disponibilidade da mesma quadra (mesmo padrão de useCreateBooking do
// Web) — o horário reservado precisa sumir da grade na próxima consulta.
export function useCreateBooking(arenaId: string, courtId: string) {
  const getToken = useApiToken();
  const queryClient = useQueryClient();

  return useMutation<CreateBookingResponse, unknown, CreateBookingVariables>({
    mutationFn: async ({ startsAt, idempotencyKey, additionalStartTimes }) =>
      createBooking(await getToken(), arenaId, courtId, startsAt, idempotencyKey, additionalStartTimes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['availability', arenaId, courtId] });
    },
  });
}
