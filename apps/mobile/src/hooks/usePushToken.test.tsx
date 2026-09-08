import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { registerPushToken, removePushToken } from '@/api/push-tokens';
import { getExpoPushToken, getPushPermissionStatus, requestPushPermission } from '@/lib/push-notifications';
import {
  useExpoPushToken,
  usePushPermissionStatus,
  useRegisterPushToken,
  useRemovePushToken,
  useRequestPushPermission,
} from './usePushToken';

jest.mock('@/api/push-tokens', () => ({ registerPushToken: jest.fn(), removePushToken: jest.fn() }));
jest.mock('@/lib/push-notifications', () => ({
  getExpoPushToken: jest.fn(),
  getPushPermissionStatus: jest.fn(),
  requestPushPermission: jest.fn(),
}));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));

const mockedRegisterPushToken = registerPushToken as jest.Mock;
const mockedRemovePushToken = removePushToken as jest.Mock;
const mockedGetExpoPushToken = getExpoPushToken as jest.Mock;
const mockedGetPushPermissionStatus = getPushPermissionStatus as jest.Mock;
const mockedRequestPushPermission = requestPushPermission as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper, queryClient };
}

describe('usePushPermissionStatus / useRequestPushPermission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('usePushPermissionStatus consulta o status real do sistema', async () => {
    const response = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' };
    mockedGetPushPermissionStatus.mockResolvedValue(response);
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => usePushPermissionStatus(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response);
  });

  it('useRequestPushPermission atualiza a cache de push-permission-status com o resultado', async () => {
    const response = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
    mockedRequestPushPermission.mockResolvedValue(response);
    const { wrapper, queryClient } = makeWrapper();

    const { result } = await renderHook(() => useRequestPushPermission(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(['push-permission-status'])).toEqual(response);
  });
});

describe('useExpoPushToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enabled=true obtém o token real', async () => {
    mockedGetExpoPushToken.mockResolvedValue('ExponentPushToken[abc]');
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useExpoPushToken(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe('ExponentPushToken[abc]');
  });

  it('enabled=false nunca chama getExpoPushToken (deslogado ou sem permissão)', async () => {
    const { wrapper } = makeWrapper();

    await renderHook(() => useExpoPushToken(false), { wrapper });

    expect(mockedGetExpoPushToken).not.toHaveBeenCalled();
  });

  it('erro (ex: MissingEasProjectIdError) expõe isError, nunca lança pro componente', async () => {
    mockedGetExpoPushToken.mockRejectedValue(new Error('sem projectId'));
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useExpoPushToken(true), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useRegisterPushToken / useRemovePushToken', () => {
  const getToken = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    getToken.mockResolvedValue('session-token');
    mockedUseAuth.mockReturnValue({ getToken });
  });

  it('useRegisterPushToken chama registerPushToken com o token de sessão e os dados corretos', async () => {
    mockedRegisterPushToken.mockResolvedValue({ ok: true });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useRegisterPushToken(), { wrapper });
    result.current.mutate({ token: 'ExponentPushToken[abc]', platform: 'ios' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRegisterPushToken).toHaveBeenCalledWith(
      'session-token',
      'ExponentPushToken[abc]',
      'ios',
    );
  });

  it('useRemovePushToken chama removePushToken com o token de sessão', async () => {
    mockedRemovePushToken.mockResolvedValue({ ok: true });
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useRemovePushToken(), { wrapper });
    result.current.mutate({ token: 'ExponentPushToken[abc]' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRemovePushToken).toHaveBeenCalledWith('session-token', 'ExponentPushToken[abc]');
  });

  it('erro ao registrar expõe isError, nunca lança sem controle', async () => {
    mockedRegisterPushToken.mockRejectedValue(new Error('500'));
    const { wrapper } = makeWrapper();

    const { result } = await renderHook(() => useRegisterPushToken(), { wrapper });
    result.current.mutate({ token: 'ExponentPushToken[abc]', platform: 'android' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
