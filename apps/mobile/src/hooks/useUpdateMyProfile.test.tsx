import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-expo';
import { useUpdateMyProfile } from './useUpdateMyProfile';

jest.mock('@clerk/clerk-expo', () => ({ useUser: jest.fn() }));

const mockedUseUser = useUser as jest.Mock;

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper, queryClient, invalidateQueries };
}

describe('useUpdateMyProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sucesso: chama user.update do Clerk com firstName/lastName, NUNCA um PATCH da API', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockedUseUser.mockReturnValue({ user: { update } });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useUpdateMyProfile(), { wrapper });
    result.current.mutate({ firstName: 'Cliente', lastName: 'Exemplo' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(update).toHaveBeenCalledWith({ firstName: 'Cliente', lastName: 'Exemplo' });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('loading: isPending fica true enquanto a mutation está em andamento', async () => {
    let resolvePromise!: (value: unknown) => void;
    const update = jest.fn().mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));
    mockedUseUser.mockReturnValue({ user: { update } });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useUpdateMyProfile(), { wrapper });
    result.current.mutate({ firstName: 'Cliente', lastName: 'Exemplo' });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    resolvePromise(undefined);
  });

  it('erro: expõe isError quando o Clerk rejeita a atualização', async () => {
    const update = jest.fn().mockRejectedValue(new Error('nome inválido'));
    mockedUseUser.mockReturnValue({ user: { update } });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useUpdateMyProfile(), { wrapper });
    result.current.mutate({ firstName: '', lastName: '' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('erro: sessão sem usuário carregado nunca chama update, expõe isError', async () => {
    mockedUseUser.mockReturnValue({ user: null });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useUpdateMyProfile(), { wrapper });
    result.current.mutate({ firstName: 'Cliente', lastName: 'Exemplo' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('sucesso corrige a cache de my-profile com o nome recém-salvo e invalida pra reconciliar com o backend', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockedUseUser.mockReturnValue({ user: { update } });
    const { wrapper, queryClient, invalidateQueries } = makeWrapper();
    queryClient.setQueryData(['my-profile'], {
      id: 'user-1',
      name: 'Nome Antigo',
      email: 'cliente@example.com',
      phone: null,
      avatarUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const { result } = await renderHook(() => useUpdateMyProfile(), { wrapper });
    result.current.mutate({ firstName: 'Cliente', lastName: 'Exemplo' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(['my-profile'])).toMatchObject({ name: 'Cliente Exemplo' });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['my-profile'] });
  });

  it('nome composto só de sobrenome vazio nunca vira "null" literal nem espaço sobrando', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockedUseUser.mockReturnValue({ user: { update } });
    const { wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(['my-profile'], { id: 'user-1', name: null });

    const { result } = await renderHook(() => useUpdateMyProfile(), { wrapper });
    result.current.mutate({ firstName: 'Cliente', lastName: '' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(['my-profile'])).toMatchObject({ name: 'Cliente' });
  });
});
