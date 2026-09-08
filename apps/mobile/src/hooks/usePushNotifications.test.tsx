import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@clerk/clerk-expo';
import { ensureAndroidNotificationChannel, MissingEasProjectIdError } from '@/lib/push-notifications';
import { usePushPermissionStatus, useExpoPushToken, useRegisterPushToken } from './usePushToken';
import { usePushNotificationsSetup } from './usePushNotifications';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/push-notifications', () => {
  class MissingEasProjectIdErrorMock extends Error {}
  return {
    ensureAndroidNotificationChannel: jest.fn().mockResolvedValue(undefined),
    MissingEasProjectIdError: MissingEasProjectIdErrorMock,
  };
});
jest.mock('./usePushToken', () => ({
  usePushPermissionStatus: jest.fn(),
  useExpoPushToken: jest.fn(),
  useRegisterPushToken: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const mockedUseAuth = useAuth as jest.Mock;
const mockedUsePushPermissionStatus = usePushPermissionStatus as jest.Mock;
const mockedUseExpoPushToken = useExpoPushToken as jest.Mock;
const mockedUseRegisterPushToken = useRegisterPushToken as jest.Mock;
const mockedGetLastNotificationResponseAsync = Notifications.getLastNotificationResponseAsync as jest.Mock;
const mockedAddNotificationResponseReceivedListener =
  Notifications.addNotificationResponseReceivedListener as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePushNotificationsSetup', () => {
  let registerMutate: jest.Mock;
  let consoleWarnSpy: jest.SpyInstance;
  let appStateRemove: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true });
    mockedUsePushPermissionStatus.mockReturnValue({ data: { status: 'granted', canAskAgain: true } });
    mockedUseExpoPushToken.mockReturnValue({ data: undefined, error: null });
    registerMutate = jest.fn();
    mockedUseRegisterPushToken.mockReturnValue({ mutate: registerMutate });
    mockedGetLastNotificationResponseAsync.mockResolvedValue(null);
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    appStateRemove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: appStateRemove } as never);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('reconsulta a permissão quando o app volta ao foreground (mudança de permissão feita fora do app)', async () => {
    const { wrapper: freshWrapper, queryClient } = (() => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
        queryClient: client,
      };
    })();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');

    await renderHook(() => usePushNotificationsSetup(), { wrapper: freshWrapper });
    const [, handler] = (AppState.addEventListener as jest.Mock).mock.calls[0] as [
      string,
      (state: string) => void,
    ];

    handler('active');

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['push-permission-status'] });
  });

  it('remove o listener de AppState ao desmontar', async () => {
    const { unmount } = await renderHook(() => usePushNotificationsSetup(), { wrapper });

    await unmount();

    expect(appStateRemove).toHaveBeenCalledTimes(1);
  });

  it('configura o canal Android uma vez, ao montar', async () => {
    await renderHook(() => usePushNotificationsSetup(), { wrapper });

    expect(ensureAndroidNotificationChannel).toHaveBeenCalledTimes(1);
  });

  it('registra o token quando logado, permissão concedida e um token está disponível', async () => {
    mockedUseExpoPushToken.mockReturnValue({ data: 'ExponentPushToken[abc]', error: null });

    await renderHook(() => usePushNotificationsSetup(), { wrapper });

    await waitFor(() =>
      expect(registerMutate).toHaveBeenCalledWith({ token: 'ExponentPushToken[abc]', platform: expect.any(String) }),
    );
  });

  it('nunca reenvia o MESMO token já registrado nesta sessão do app (remontagem/re-render)', async () => {
    mockedUseExpoPushToken.mockReturnValue({ data: 'ExponentPushToken[abc]', error: null });

    const { rerender } = await renderHook(() => usePushNotificationsSetup(), { wrapper });
    await waitFor(() => expect(registerMutate).toHaveBeenCalledTimes(1));

    await rerender({});
    await rerender({});

    expect(registerMutate).toHaveBeenCalledTimes(1);
  });

  it('registra de novo quando o token muda (dispositivo emitiu um token novo)', async () => {
    mockedUseExpoPushToken.mockReturnValue({ data: 'ExponentPushToken[a]', error: null });
    const { rerender } = await renderHook(() => usePushNotificationsSetup(), { wrapper });
    await waitFor(() => expect(registerMutate).toHaveBeenCalledTimes(1));

    mockedUseExpoPushToken.mockReturnValue({ data: 'ExponentPushToken[b]', error: null });
    await rerender({});

    await waitFor(() => expect(registerMutate).toHaveBeenCalledTimes(2));
    expect(registerMutate).toHaveBeenLastCalledWith({
      token: 'ExponentPushToken[b]',
      platform: expect.any(String),
    });
  });

  it('nunca registra sem permissão concedida, mesmo que um token exista', async () => {
    mockedUsePushPermissionStatus.mockReturnValue({ data: { status: 'denied', canAskAgain: true } });
    mockedUseExpoPushToken.mockReturnValue({ data: 'ExponentPushToken[abc]', error: null });

    await renderHook(() => usePushNotificationsSetup(), { wrapper });

    expect(registerMutate).not.toHaveBeenCalled();
  });

  it('nunca registra quando deslogado, mesmo que um token exista', async () => {
    mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false });
    mockedUseExpoPushToken.mockReturnValue({ data: 'ExponentPushToken[abc]', error: null });

    await renderHook(() => usePushNotificationsSetup(), { wrapper });

    expect(registerMutate).not.toHaveBeenCalled();
  });

  it('MissingEasProjectIdError é logado uma vez (aviso), nunca lança/quebra o app', async () => {
    mockedUseExpoPushToken.mockReturnValue({ data: undefined, error: new MissingEasProjectIdError() });

    await expect(renderHook(() => usePushNotificationsSetup(), { wrapper })).resolves.toBeTruthy();
    await waitFor(() => expect(consoleWarnSpy).toHaveBeenCalledTimes(1));
  });

  describe('deep link (toque na notificação)', () => {
    it('cold start: app aberto a partir de uma notificação navega pro detalhe da reserva', async () => {
      mockedGetLastNotificationResponseAsync.mockResolvedValue({
        notification: { request: { content: { data: { type: 'booking_confirmed', bookingId: 'booking-1' } } } },
      });

      await renderHook(() => usePushNotificationsSetup(), { wrapper });

      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/reservas/booking-1'));
    });

    it('sem notificação de cold start, nunca navega sozinho', async () => {
      mockedGetLastNotificationResponseAsync.mockResolvedValue(null);

      await renderHook(() => usePushNotificationsSetup(), { wrapper });

      expect(router.push).not.toHaveBeenCalled();
    });

    it('app aberto/background: tocar na notificação navega pro detalhe da reserva', async () => {
      await renderHook(() => usePushNotificationsSetup(), { wrapper });
      const handler = mockedAddNotificationResponseReceivedListener.mock.calls[0][0] as (
        response: unknown,
      ) => void;

      handler({
        notification: { request: { content: { data: { type: 'booking_cancelled', bookingId: 'booking-2' } } } },
      });

      expect(router.push).toHaveBeenCalledWith('/reservas/booking-2');
    });

    it('payload sem bookingId (ou inválido) nunca navega — nunca confia cegamente no conteúdo da notificação', async () => {
      await renderHook(() => usePushNotificationsSetup(), { wrapper });
      const handler = mockedAddNotificationResponseReceivedListener.mock.calls[0][0] as (
        response: unknown,
      ) => void;

      handler({ notification: { request: { content: { data: {} } } } });
      handler({ notification: { request: { content: { data: { bookingId: 42 } } } } });
      handler({ notification: { request: { content: { data: undefined } } } });

      expect(router.push).not.toHaveBeenCalled();
    });

    it('remove o listener ao desmontar', async () => {
      const remove = jest.fn();
      mockedAddNotificationResponseReceivedListener.mockReturnValue({ remove });

      const { unmount } = await renderHook(() => usePushNotificationsSetup(), { wrapper });
      await unmount();

      expect(remove).toHaveBeenCalledTimes(1);
    });
  });
});
