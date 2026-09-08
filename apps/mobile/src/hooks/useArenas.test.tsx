import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { discoverArenaBySlug, discoverArenas } from '@/api/arenas';
import { useDiscoverArena, useDiscoverArenas } from './useArenas';

jest.mock('@/api/arenas', () => ({
  discoverArenas: jest.fn(),
  discoverArenaBySlug: jest.fn(),
}));

const mockedDiscoverArenas = discoverArenas as jest.Mock;
const mockedDiscoverArenaBySlug = discoverArenaBySlug as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useDiscoverArenas', () => {
  beforeEach(() => {
    mockedDiscoverArenas.mockReset();
  });

  it('sucesso: devolve a lista de arenas da API', async () => {
    const arenas = [{ id: 'a1', name: 'Arena Central', slug: 'arena-central', description: null, sports: [], isReady: true }];
    mockedDiscoverArenas.mockResolvedValue(arenas);

    const { result } = await renderHook(() => useDiscoverArenas(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(arenas);
  });

  it('erro: expõe isError quando a API falha', async () => {
    mockedDiscoverArenas.mockRejectedValue(new Error('falha de rede'));

    const { result } = await renderHook(() => useDiscoverArenas(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useDiscoverArena', () => {
  beforeEach(() => {
    mockedDiscoverArenaBySlug.mockReset();
  });

  it('sucesso: chama discoverArenaBySlug com o slug correto', async () => {
    const arena = { id: 'a1', name: 'Arena Central', slug: 'arena-central', courts: [] };
    mockedDiscoverArenaBySlug.mockResolvedValue(arena);

    const { result } = await renderHook(() => useDiscoverArena('arena-central'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedDiscoverArenaBySlug).toHaveBeenCalledWith('arena-central');
    expect(result.current.data).toEqual(arena);
  });

  it('nunca chama a API quando o slug ainda não está disponível', async () => {
    await renderHook(() => useDiscoverArena(undefined), { wrapper });

    expect(mockedDiscoverArenaBySlug).not.toHaveBeenCalled();
  });
});
