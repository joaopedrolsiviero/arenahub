import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  ensureAndroidNotificationChannel,
  getExpoPushToken,
  getPushPermissionStatus,
  MissingEasProjectIdError,
  requestPushPermission,
} from './push-notifications';

jest.mock('expo-device', () => ({ __esModule: true, isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} }, easConfig: undefined },
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));

const mockedDevice = jest.requireMock('expo-device') as { isDevice: boolean };
const mockedConstants = jest.requireMock('expo-constants') as {
  default: { expoConfig: { extra: Record<string, unknown> }; easConfig?: { projectId?: string } };
};

describe('lib/push-notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDevice.isDevice = true;
    mockedConstants.default.expoConfig.extra = {};
    mockedConstants.default.easConfig = undefined;
  });

  describe('getExpoPushToken', () => {
    it('simulador/emulador (Device.isDevice=false): devolve null, nunca tenta obter token real', async () => {
      mockedDevice.isDevice = false;

      await expect(getExpoPushToken()).resolves.toBeNull();
      expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it('sem extra.eas.projectId configurado: lança MissingEasProjectIdError explícito, nunca tenta a chamada nativa', async () => {
      await expect(getExpoPushToken()).rejects.toBeInstanceOf(MissingEasProjectIdError);
      expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it('com projectId configurado (extra.eas.projectId): obtém e devolve o token real', async () => {
      mockedConstants.default.expoConfig.extra = { eas: { projectId: 'project-abc' } };
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        type: 'expo',
        data: 'ExponentPushToken[abc]',
      });

      await expect(getExpoPushToken()).resolves.toBe('ExponentPushToken[abc]');
      expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-abc' });
    });

    it('fallback para Constants.easConfig.projectId quando extra.eas.projectId está ausente', async () => {
      mockedConstants.default.easConfig = { projectId: 'project-from-eas-config' };
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        type: 'expo',
        data: 'ExponentPushToken[xyz]',
      });

      await getExpoPushToken();

      expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
        projectId: 'project-from-eas-config',
      });
    });
  });

  describe('getPushPermissionStatus / requestPushPermission', () => {
    it('getPushPermissionStatus delega em Notifications.getPermissionsAsync', async () => {
      const response = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue(response);

      await expect(getPushPermissionStatus()).resolves.toEqual(response);
    });

    it('requestPushPermission delega em Notifications.requestPermissionsAsync', async () => {
      const response = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue(response);

      await expect(requestPushPermission()).resolves.toEqual(response);
    });
  });

  describe('ensureAndroidNotificationChannel', () => {
    const originalOS = Platform.OS;

    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    });

    it('nunca cria o canal fora do Android', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

      await ensureAndroidNotificationChannel();

      expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    });

    it('no Android, cria o canal "default" com importância DEFAULT', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

      await ensureAndroidNotificationChannel();

      expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({ importance: Notifications.AndroidImportance.DEFAULT }),
      );
    });
  });
});
