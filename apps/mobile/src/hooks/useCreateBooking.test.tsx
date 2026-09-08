import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { createBooking } from '@/api/bookings';
import { useCreateBooking } from './useCreateBooking';

jest.mock('@/api/bookings', () => ({ createBooking: jest.fn() }));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));

const mockedCreateBooking = createBooking as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useCreateBooking', () => {
  const getToken = jest.fn();

  beforeEach(() => {
    mockedCreateBooking.mockReset();
    getToken.mockReset().mockResolvedValue('session-token');
    mockedUseAuth.mockReturnValue({ getToken });
  });

  it('sucesso: chama createBooking com o token da sessão e os dados corretos', async () => {
    const booking = { id: 'booking-1' };
    mockedCreateBooking.mockResolvedValue(booking);

    const { result } = await renderHook(() => useCreateBooking('arena-1', 'court-1'), { wrapper });
    result.current.mutate({ startsAt: '2026-09-07T13:00:00.000Z', idempotencyKey: 'key-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(mockedCreateBooking).toHaveBeenCalledWith(
      'session-token',
      'arena-1',
      'court-1',
      '2026-09-07T13:00:00.000Z',
      'key-1',
      undefined,
    );
    expect(result.current.data).toEqual(booking);
  });

  it('loading: isPending fica true enquanto a mutation está em andamento', async () => {
    let resolvePromise!: (value: unknown) => void;
    mockedCreateBooking.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));

    const { result } = await renderHook(() => useCreateBooking('arena-1', 'court-1'), { wrapper });
    result.current.mutate({ startsAt: '2026-09-07T13:00:00.000Z', idempotencyKey: 'key-1' });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    resolvePromise({ id: 'booking-1' });
  });

  it('erro: expõe isError quando o backend rejeita a criação', async () => {
    mockedCreateBooking.mockRejectedValue(new Error('conflito'));

    const { result } = await renderHook(() => useCreateBooking('arena-1', 'court-1'), { wrapper });
    result.current.mutate({ startsAt: '2026-09-07T13:00:00.000Z', idempotencyKey: 'key-1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('encaminha additionalStartTimes quando presente (múltiplos horários)', async () => {
    mockedCreateBooking.mockResolvedValue([{ id: 'booking-1' }, { id: 'booking-2' }]);

    const { result } = await renderHook(() => useCreateBooking('arena-1', 'court-1'), { wrapper });
    result.current.mutate({
      startsAt: '2026-09-07T13:00:00.000Z',
      idempotencyKey: 'key-1',
      additionalStartTimes: ['2026-09-07T14:00:00.000Z'],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedCreateBooking).toHaveBeenCalledWith(
      'session-token',
      'arena-1',
      'court-1',
      '2026-09-07T13:00:00.000Z',
      'key-1',
      ['2026-09-07T14:00:00.000Z'],
    );
  });
});
