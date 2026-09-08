import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@clerk/clerk-expo';
import { useQueryClient } from '@tanstack/react-query';
import { ensureAndroidNotificationChannel, MissingEasProjectIdError } from '@/lib/push-notifications';
import { usePushPermissionStatus, useExpoPushToken, useRegisterPushToken } from './usePushToken';

/**
 * Orquestração de push (M7) — chamado UMA ÚNICA VEZ, na raiz do app
 * (app/_layout.tsx), pelo tempo de vida inteiro da aplicação. Nunca pede
 * permissão sozinho (item 4 do prompt: "não peça permissão agressivamente
 * ao abrir o app sem contexto") — só reage a uma permissão JÁ concedida
 * (por este hook, por uma sessão anterior, ou pelo usuário direto nas
 * configurações do sistema). O pedido explícito de permissão vive na tela
 * de Perfil (useRequestPushPermission), sempre por toque do usuário.
 */
export function usePushNotificationsSetup(): void {
  const { isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const permissionQuery = usePushPermissionStatus();
  const canFetchToken = isLoaded && isSignedIn === true && permissionQuery.data?.status === 'granted';
  const tokenQuery = useExpoPushToken(canFetchToken);
  const registerToken = useRegisterPushToken();
  // `ref`, não estado — só precisa sobreviver entre re-renders pra nunca
  // reenviar o MESMO token já registrado nesta sessão do app; nunca precisa
  // disparar re-render por si só.
  const registeredTokenRef = useRef<string | null>(null);

  useEffect(() => {
    ensureAndroidNotificationChannel();
  }, []);

  // M7, item 4: "respeite... alteração posterior da permissão nas
  // configurações do sistema" — o usuário pode sair do app, mudar a
  // permissão no sistema operacional e voltar; sem isto, o app só
  // descobriria na próxima abertura fria.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        queryClient.invalidateQueries({ queryKey: ['push-permission-status'] });
      }
    });
    return () => subscription.remove();
  }, [queryClient]);

  useEffect(() => {
    if (tokenQuery.error instanceof MissingEasProjectIdError) {
      // Configuração ausente (ver relatório final da M7, BLOCKED BY
      // ENVIRONMENT) — logado uma vez por mudança de erro, nunca em loop;
      // nunca impede o resto do app de funcionar.
      console.warn(tokenQuery.error.message);
    }
  }, [tokenQuery.error]);

  // Registra (ou reassocia) o token sempre que ele muda enquanto logado com
  // permissão concedida — nunca reenviado ao backend se for o MESMO token
  // já registrado nesta sessão do app (evita chamada de rede redundante a
  // cada re-render/remonte deste hook).
  useEffect(() => {
    const token = tokenQuery.data;
    if (!token || !canFetchToken) {
      return;
    }
    if (registeredTokenRef.current === token) {
      return;
    }
    registeredTokenRef.current = token;
    registerToken.mutate({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    // `registeredTokenRef` já impede reenvio do MESMO token — incluir
    // `registerToken` nas deps é seguro mesmo que o objeto mude de
    // referência entre renders.
  }, [tokenQuery.data, canFetchToken, registerToken]);

  // Deep link (M7, item 10) — reaproveita a rota de detalhe já existente
  // (M5, /reservas/:bookingId): ela mesma relê os dados reais via
  // GET /users/me/bookings/:bookingId e aplica ownership (404 se a reserva
  // não for do usuário logado) — um payload de notificação forjado ou
  // desatualizado nunca expõe dado de outra pessoa, nenhuma checagem nova
  // precisa existir aqui além de validar que veio uma string não vazia.
  useEffect(() => {
    function handleResponse(response: Notifications.NotificationResponse) {
      const data = response.notification.request.content.data as { bookingId?: unknown } | undefined;
      if (typeof data?.bookingId === 'string' && data.bookingId.length > 0) {
        router.push(`/reservas/${data.bookingId}`);
      }
    }

    // Cobre o caso "app fechado, aberto ao tocar na notificação" (cold
    // start) — nunca confundido com "recebi uma resposta de API" (item 9 do
    // prompt): isto só resolve quando o SO reporta que o app foi aberto A
    // PARTIR de uma notificação real.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleResponse(response);
      }
    });

    // Cobre foreground/background (app já rodando, notificação tocada).
    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => subscription.remove();
  }, []);
}
