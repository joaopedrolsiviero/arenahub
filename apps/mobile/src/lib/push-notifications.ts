import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

// Handler de foreground (M7, item 9 — "aplicativo aberto"): sem isso, o
// Expo SDK (desde a remoção do comportamento default) NÃO mostra nada
// quando uma notificação chega com o app em primeiro plano. Registrado uma
// única vez, em tempo de import (nunca dentro de um componente/hook — é
// configuração global do módulo nativo, não estado de React).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const ANDROID_CHANNEL_ID = 'default';

// M7, item 11 — canal obrigatório no Android 8+ (sem ele, a notificação
// nunca aparece nesses aparelhos). Importância DEFAULT (nunca MAX/HIGH):
// confirmação de reserva/pagamento/cancelamento é informativo, não
// interrupção urgente (nunca justificaria heads-up + som insistente).
export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Reservas e pagamentos',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
  });
}

export async function getPushPermissionStatus(): Promise<Notifications.PermissionResponse> {
  return Notifications.getPermissionsAsync();
}

export async function requestPushPermission(): Promise<Notifications.PermissionResponse> {
  return Notifications.requestPermissionsAsync();
}

// M7, item "critério de parada" — este projeto NUNCA teve um projeto
// EAS vinculado (app.json não tem extra.eas.projectId; confirmado na
// auditoria desta fase, ver relatório final). Sem esse ID, o Expo Push
// Service não consegue emitir um token real — em vez de deixar a chamada
// nativa falhar com um erro opaco, este erro é lançado explicitamente ANTES
// de tentar, com uma mensagem que explica exatamente o que falta.
export class MissingEasProjectIdError extends Error {
  constructor() {
    super(
      'Notificações push exigem um projeto EAS vinculado (app.json: extra.eas.projectId, ' +
        'configurado via "eas init"). Nenhum projeto está vinculado neste ambiente.',
    );
    this.name = 'MissingEasProjectIdError';
  }
}

// `null` (nunca lança) quando o ambiente estruturalmente não pode ter um
// token real — simulador/emulador (item 12 do prompt: nunca simular push
// real). `MissingEasProjectIdError` é a ÚNICA condição que lança, porque é
// uma configuração ausente que vale a pena reportar explicitamente ao
// chamador (ver usePushNotifications), não um estado normal do dispositivo.
export async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
  if (!projectId) {
    throw new MissingEasProjectIdError();
  }
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}
