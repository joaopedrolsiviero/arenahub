import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getCourtAvailability } from '@/api/availability';
import { useCourtAvailability } from './useAvailability';

jest.mock('@/api/availability', () => ({ getCourtAvailability: jest.fn() }));

const mockedGetCourtAvailability = getCourtAvailability as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useCourtAvailability', () => {
  beforeEach(() => {
    mockedGetCourtAvailability.mockReset();
  });

  const from = '2026-09-07T03:00:00.000Z';
  const to = '2026-09-08T03:00:00.000Z';

  it('sucesso: consulta com arenaId, courtId, from e to corretos', async () => {
    const result = { courtId: 'court-1', timezone: 'America/Sao_Paulo', from, to, slots: [] };
    mockedGetCourtAvailability.mockResolvedValue(result);

    const { result: hookResult } = await renderHook(
      () => useCourtAvailability('arena-1', 'court-1', from, to),
      { wrapper },
    );

    await waitFor(() => expect(hookResult.current.isSuccess).toBe(true));
    expect(mockedGetCourtAvailability).toHaveBeenCalledWith('arena-1', 'court-1', from, to);
    expect(hookResult.current.data).toEqual(result);
  });

  it('erro: expõe isError quando o backend falha', async () => {
    mockedGetCourtAvailability.mockRejectedValue(new Error('backend fora do ar'));

    const { result } = await renderHook(() => useCourtAvailability('arena-1', 'court-1', from, to), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('nunca consulta enquanto algum parâmetro obrigatório está faltando', async () => {
    await renderHook(() => useCourtAvailability('arena-1', 'court-1', undefined, undefined), { wrapper });

    expect(mockedGetCourtAvailability).not.toHaveBeenCalled();
  });
});
