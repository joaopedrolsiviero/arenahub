import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { createBookingPayment, getBookingPayment, getMyPaymentStatuses } from '@/api/payments';
import { usePayment, useCreatePayment, useMyPaymentStatuses } from './usePayment';

jest.mock('@/api/payments', () => ({
  createBookingPayment: jest.fn(),
  getBookingPayment: jest.fn(),
  getMyPaymentStatuses: jest.fn(),
}));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));

const mockedCreateBookingPayment = createBookingPayment as jest.Mock;
const mockedGetBookingPayment = getBookingPayment as jest.Mock;
const mockedGetMyPaymentStatuses = getMyPaymentStatuses as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePayment (consulta)', () => {
  const getToken = jest.fn();

  beforeEach(() => {
    mockedGetBookingPayment.mockReset();
    getToken.mockReset().mockResolvedValue('session-token');
    mockedUseAuth.mockReturnValue({ getToken });
  });

  it('sucesso: consulta com o token e o bookingId corretos', async () => {
    const payment = { id: 'payment-1', status: 'PENDING' };
    mockedGetBookingPayment.mockResolvedValue(payment);

    const { result } = await renderHook(() => usePayment('booking-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGetBookingPayment).toHaveBeenCalledWith('session-token', 'booking-1');
    expect(result.current.data).toEqual(payment);
  });

  it('erro: expõe isError quando a consulta falha', async () => {
    mockedGetBookingPayment.mockRejectedValue(new Error('falha'));

    const { result } = await renderHook(() => usePayment('booking-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('nunca consulta sem um bookingId', async () => {
    await renderHook(() => usePayment(undefined), { wrapper });

    expect(mockedGetBookingPayment).not.toHaveBeenCalled();
  });
});

describe('useCreatePayment (criação)', () => {
  const getToken = jest.fn();

  beforeEach(() => {
    mockedCreateBookingPayment.mockReset();
    getToken.mockReset().mockResolvedValue('session-token');
    mockedUseAuth.mockReturnValue({ getToken });
  });

  it('sucesso: chama createBookingPayment com o token da sessão e a Idempotency-Key', async () => {
    const payment = { id: 'payment-1', status: 'PENDING' };
    mockedCreateBookingPayment.mockResolvedValue(payment);

    const { result } = await renderHook(() => useCreatePayment('booking-1'), { wrapper });
    result.current.mutate({ idempotencyKey: 'key-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(mockedCreateBookingPayment).toHaveBeenCalledWith('session-token', 'booking-1', 'key-1');
    expect(result.current.data).toEqual(payment);
  });

  it('loading: isPending fica true enquanto a mutation está em andamento', async () => {
    let resolvePromise!: (value: unknown) => void;
    mockedCreateBookingPayment.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));

    const { result } = await renderHook(() => useCreatePayment('booking-1'), { wrapper });
    result.current.mutate({ idempotencyKey: 'key-1' });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    resolvePromise({ id: 'payment-1', status: 'PENDING' });
  });

  it('erro: expõe isError quando o backend rejeita a criação', async () => {
    mockedCreateBookingPayment.mockRejectedValue(new Error('conflito'));

    const { result } = await renderHook(() => useCreatePayment('booking-1'), { wrapper });
    result.current.mutate({ idempotencyKey: 'key-1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('retry seguro: chamar mutate de novo com a MESMA chave nunca é bloqueado pelo hook (o backend decide)', async () => {
    mockedCreateBookingPayment.mockRejectedValueOnce(new Error('timeout'));
    mockedCreateBookingPayment.mockResolvedValueOnce({ id: 'payment-1', status: 'PENDING' });

    const { result } = await renderHook(() => useCreatePayment('booking-1'), { wrapper });
    result.current.mutate({ idempotencyKey: 'key-1' });
    await waitFor(() => expect(result.current.isError).toBe(true));

    result.current.mutate({ idempotencyKey: 'key-1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedCreateBookingPayment).toHaveBeenNthCalledWith(1, 'session-token', 'booking-1', 'key-1');
    expect(mockedCreateBookingPayment).toHaveBeenNthCalledWith(2, 'session-token', 'booking-1', 'key-1');
  });
});

describe('useMyPaymentStatuses (mapa bookingId -> status, "minhas reservas")', () => {
  const getToken = jest.fn();

  beforeEach(() => {
    mockedGetMyPaymentStatuses.mockReset();
    getToken.mockReset().mockResolvedValue('session-token');
    mockedUseAuth.mockReturnValue({ getToken });
  });

  it('sucesso: consulta uma única vez com o token da sessão', async () => {
    const statuses = { 'booking-1': 'PAID' };
    mockedGetMyPaymentStatuses.mockResolvedValue(statuses);

    const { result } = await renderHook(() => useMyPaymentStatuses(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGetMyPaymentStatuses).toHaveBeenCalledTimes(1);
    expect(mockedGetMyPaymentStatuses).toHaveBeenCalledWith('session-token');
    expect(result.current.data).toEqual(statuses);
  });

  it('erro: expõe isError quando a consulta falha', async () => {
    mockedGetMyPaymentStatuses.mockRejectedValue(new Error('falha'));

    const { result } = await renderHook(() => useMyPaymentStatuses(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('enabled=false nunca dispara a consulta', async () => {
    await renderHook(() => useMyPaymentStatuses(false), { wrapper });

    expect(mockedGetMyPaymentStatuses).not.toHaveBeenCalled();
  });
});
