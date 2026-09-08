import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { getMyBooking, getMyBookings } from '@/api/bookings';
import { useMyBooking, useMyBookings } from './useMyBookings';

jest.mock('@/api/bookings', () => ({ getMyBooking: jest.fn(), getMyBookings: jest.fn() }));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));

const mockedGetMyBooking = getMyBooking as jest.Mock;
const mockedGetMyBookings = getMyBookings as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useMyBookings (lista)', () => {
  const getToken = jest.fn();

  beforeEach(() => {
    mockedGetMyBookings.mockReset();
    getToken.mockReset().mockResolvedValue('session-token');
    mockedUseAuth.mockReturnValue({ getToken });
  });

  it('sucesso: consulta com o token da sessão', async () => {
    const bookings = [{ id: 'booking-1', status: 'CONFIRMED' }];
    mockedGetMyBookings.mockResolvedValue(bookings);

    const { result } = await renderHook(() => useMyBookings(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGetMyBookings).toHaveBeenCalledWith('session-token');
    expect(result.current.data).toEqual(bookings);
  });

  it('empty: sucesso com lista vazia', async () => {
    mockedGetMyBookings.mockResolvedValue([]);

    const { result } = await renderHook(() => useMyBookings(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('erro: expõe isError quando a consulta falha', async () => {
    mockedGetMyBookings.mockRejectedValue(new Error('falha'));

    const { result } = await renderHook(() => useMyBookings(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('retry: refetch() refaz a chamada', async () => {
    mockedGetMyBookings.mockResolvedValue([]);

    const { result } = await renderHook(() => useMyBookings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await result.current.refetch();

    expect(mockedGetMyBookings).toHaveBeenCalledTimes(2);
  });

  it('enabled=false nunca dispara a consulta (sessão ainda não confirmada/deslogado)', async () => {
    await renderHook(() => useMyBookings(false), { wrapper });

    expect(mockedGetMyBookings).not.toHaveBeenCalled();
  });
});

describe('useMyBooking (detalhe)', () => {
  const getToken = jest.fn();

  beforeEach(() => {
    mockedGetMyBooking.mockReset();
    getToken.mockReset().mockResolvedValue('session-token');
    mockedUseAuth.mockReturnValue({ getToken });
  });

  it('sucesso: consulta com o token e o bookingId corretos', async () => {
    const booking = { id: 'booking-1', status: 'CONFIRMED' };
    mockedGetMyBooking.mockResolvedValue(booking);

    const { result } = await renderHook(() => useMyBooking('booking-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGetMyBooking).toHaveBeenCalledWith('session-token', 'booking-1');
    expect(result.current.data).toEqual(booking);
  });

  it('erro: expõe isError quando o backend devolve 404 (não encontrada/de outro usuário)', async () => {
    mockedGetMyBooking.mockRejectedValue(new Error('not found'));

    const { result } = await renderHook(() => useMyBooking('booking-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('nunca consulta sem um bookingId', async () => {
    await renderHook(() => useMyBooking(undefined), { wrapper });

    expect(mockedGetMyBooking).not.toHaveBeenCalled();
  });

  it('nunca consulta quando enabled=false, mesmo com bookingId presente', async () => {
    await renderHook(() => useMyBooking('booking-1', false), { wrapper });

    expect(mockedGetMyBooking).not.toHaveBeenCalled();
  });
});
