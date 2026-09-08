import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { cancelBooking } from '@/api/bookings';
import { useCancelBooking } from './useCancelBooking';

jest.mock('@/api/bookings', () => ({ cancelBooking: jest.fn() }));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));

const mockedCancelBooking = cancelBooking as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper, invalidateQueries };
}

describe('useCancelBooking', () => {
  const getToken = jest.fn();

  beforeEach(() => {
    mockedCancelBooking.mockReset();
    getToken.mockReset().mockResolvedValue('session-token');
    mockedUseAuth.mockReturnValue({ getToken });
  });

  it('sucesso: chama cancelBooking com o token da sessão e os IDs corretos', async () => {
    mockedCancelBooking.mockResolvedValue({ id: 'booking-1', status: 'CANCELLED' });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useCancelBooking(), { wrapper });
    result.current.mutate({ arenaId: 'arena-1', courtId: 'court-1', bookingId: 'booking-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedCancelBooking).toHaveBeenCalledWith('session-token', 'arena-1', 'court-1', 'booking-1');
  });

  it('loading: isPending fica true enquanto a mutation está em andamento', async () => {
    let resolvePromise!: (value: unknown) => void;
    mockedCancelBooking.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useCancelBooking(), { wrapper });
    result.current.mutate({ arenaId: 'arena-1', courtId: 'court-1', bookingId: 'booking-1' });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    resolvePromise({ id: 'booking-1', status: 'CANCELLED' });
  });

  it('erro: expõe isError quando o backend rejeita o cancelamento', async () => {
    mockedCancelBooking.mockRejectedValue(new Error('403'));
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useCancelBooking(), { wrapper });
    result.current.mutate({ arenaId: 'arena-1', courtId: 'court-1', bookingId: 'booking-1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('sucesso invalida lista de minhas reservas, disponibilidade, pagamento da reserva e mapa de status de pagamento', async () => {
    mockedCancelBooking.mockResolvedValue({ id: 'booking-1', status: 'CANCELLED' });
    const { wrapper, invalidateQueries } = makeWrapper();

    const { result } = await renderHook(() => useCancelBooking(), { wrapper });
    result.current.mutate({ arenaId: 'arena-1', courtId: 'court-1', bookingId: 'booking-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateQueries.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['my-bookings']);
    expect(invalidatedKeys).toContainEqual(['availability', 'arena-1', 'court-1']);
    expect(invalidatedKeys).toContainEqual(['booking-payment', 'booking-1']);
    expect(invalidatedKeys).toContainEqual(['my-payment-statuses']);
  });

  it('não permite duas mutations concorrentes disparadas em sequência sem esperar a primeira resolver serem confundidas: cada chamada usa suas próprias variáveis', async () => {
    mockedCancelBooking.mockResolvedValueOnce({ id: 'booking-1', status: 'CANCELLED' });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useCancelBooking(), { wrapper });
    result.current.mutate({ arenaId: 'arena-1', courtId: 'court-1', bookingId: 'booking-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedCancelBooking).toHaveBeenCalledTimes(1);
  });
});
