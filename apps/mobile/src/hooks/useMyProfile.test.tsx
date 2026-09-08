import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { getMyProfile } from '@/api/users';
import { useMyProfile } from './useMyProfile';

jest.mock('@/api/users', () => ({ getMyProfile: jest.fn() }));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));

const mockedGetMyProfile = getMyProfile as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useMyProfile', () => {
  const getToken = jest.fn();

  beforeEach(() => {
    mockedGetMyProfile.mockReset();
    getToken.mockReset().mockResolvedValue('session-token');
    mockedUseAuth.mockReturnValue({ getToken });
  });

  it('sucesso: consulta com a query key estável e o token da sessão', async () => {
    const user = { id: 'user-1', name: 'Cliente Exemplo' };
    mockedGetMyProfile.mockResolvedValue(user);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = await renderHook(() => useMyProfile(), {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGetMyProfile).toHaveBeenCalledWith('session-token');
    expect(result.current.data).toEqual(user);
    expect(queryClient.getQueryData(['my-profile'])).toEqual(user);
  });

  it('erro: expõe isError quando a consulta falha', async () => {
    mockedGetMyProfile.mockRejectedValue(new Error('falha'));

    const { result } = await renderHook(() => useMyProfile(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('retry: refetch() refaz a chamada', async () => {
    mockedGetMyProfile.mockResolvedValue({ id: 'user-1' });

    const { result } = await renderHook(() => useMyProfile(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await result.current.refetch();

    expect(mockedGetMyProfile).toHaveBeenCalledTimes(2);
  });

  it('enabled=false nunca dispara a consulta (sessão ainda não confirmada/deslogado)', async () => {
    await renderHook(() => useMyProfile(false), { wrapper });

    expect(mockedGetMyProfile).not.toHaveBeenCalled();
  });
});
