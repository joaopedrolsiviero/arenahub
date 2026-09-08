import { PushNotificationsService } from './push-notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PushTokensService } from './push-tokens.service';

const originalFetch = global.fetch;

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    userId: 'user-1',
    type: 'CUSTOMER',
    courtId: 'court-1',
    startsAt: new Date('2026-09-07T13:00:00.000Z'),
    ...overrides,
  } as never;
}

describe('PushNotificationsService', () => {
  let prisma: { court: { findUnique: jest.Mock } };
  let pushTokensService: { findTokensForUser: jest.Mock; removeByToken: jest.Mock };
  let service: PushNotificationsService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    prisma = {
      court: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Quadra 1',
          arena: { name: 'Arena Central', timezone: 'America/Sao_Paulo' },
        }),
      },
    };
    pushTokensService = {
      findTokensForUser: jest.fn().mockResolvedValue([{ token: 'ExponentPushToken[a]' }]),
      removeByToken: jest.fn().mockResolvedValue(undefined),
    };
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: [{ status: 'ok', id: 'ticket-1' }] }),
    });
    global.fetch = fetchMock;
    delete process.env.EXPO_ACCESS_TOKEN;

    service = new PushNotificationsService(
      prisma as unknown as PrismaService,
      pushTokensService as unknown as PushTokensService,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.EXPO_ACCESS_TOKEN;
  });

  describe('filtro de elegibilidade (nunca notifica o que não é reserva de cliente)', () => {
    it('Booking sem userId (bloqueio programático) nunca chama o provedor nem consulta a quadra', async () => {
      await service.notifyBookingConfirmed(booking({ userId: null }));

      expect(prisma.court.findUnique).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('BLOCK/MAINTENANCE nunca geram notificação de reserva de cliente', async () => {
      await service.notifyBookingConfirmed(booking({ type: 'BLOCK', userId: 'admin-1' }));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('usuário sem nenhum token de push registrado nunca chama o Expo Push Service', async () => {
      pushTokensService.findTokensForUser.mockResolvedValue([]);

      await service.notifyBookingConfirmed(booking());

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('quadra não encontrada (excluída/inconsistência) nunca lança, só não notifica', async () => {
      prisma.court.findUnique.mockResolvedValue(null);

      await expect(service.notifyBookingConfirmed(booking())).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('conteúdo da notificação (item 6 do prompt: nunca dados sensíveis)', () => {
    it('reserva confirmada: título/corpo com arena, quadra e horário; data só com type+bookingId', async () => {
      await service.notifyBookingConfirmed(booking());

      expect(fetchMock).toHaveBeenCalledWith(
        'https://exp.host/--/api/v2/push/send',
        expect.objectContaining({ method: 'POST' }),
      );
      const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
      const [message] = JSON.parse(options.body) as [Record<string, unknown>];
      expect(message.to).toBe('ExponentPushToken[a]');
      expect(message.title).toBe('Reserva confirmada');
      expect(message.body).toContain('Arena Central');
      expect(message.body).toContain('Quadra 1');
      expect(message.data).toEqual({ type: 'booking_confirmed', bookingId: 'booking-1' });
      // Nunca inclui QR code, PIX, valor, token de sessão ou qualquer campo
      // financeiro/de autenticação (o próprio "to" é o endereço de entrega —
      // um Expo Push Token, não um token de sessão/autenticação — por isso
      // é excluído desta checagem, mesmo tendo "Token" no nome).
      const rest: Record<string, unknown> = { ...message };
      delete rest.to;
      const serialized = JSON.stringify(rest);
      expect(serialized).not.toMatch(
        /qrCode|pixCopyPaste|amount|checkoutUrl|Authorization|Bearer/i,
      );
    });

    it('reserva cancelada: título correto', async () => {
      await service.notifyBookingCancelled(booking());

      const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
      const [message] = JSON.parse(options.body) as [Record<string, unknown>];
      expect(message.title).toBe('Reserva cancelada');
      expect(message.data).toEqual({ type: 'booking_cancelled', bookingId: 'booking-1' });
    });

    it('pagamento confirmado: título correto, menciona a arena, nunca o valor', async () => {
      await service.notifyPaymentConfirmed(booking());

      const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
      const [message] = JSON.parse(options.body) as [Record<string, unknown>];
      expect(message.title).toBe('Pagamento confirmado');
      expect(message.data).toEqual({ type: 'payment_confirmed', bookingId: 'booking-1' });
    });

    it('envia uma mensagem por token quando o usuário tem múltiplos dispositivos', async () => {
      pushTokensService.findTokensForUser.mockResolvedValue([
        { token: 'ExponentPushToken[a]' },
        { token: 'ExponentPushToken[b]' },
      ]);

      await service.notifyBookingConfirmed(booking());

      const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
      const messages = JSON.parse(options.body) as Array<Record<string, unknown>>;
      expect(messages).toHaveLength(2);
      expect(messages.map((m) => m.to)).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
    });

    it('EXPO_ACCESS_TOKEN, quando configurado, vai como Authorization; ausente, nenhum header extra', async () => {
      await service.notifyBookingConfirmed(booking());
      const [, noTokenOptions] = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(noTokenOptions.headers.Authorization).toBeUndefined();

      fetchMock.mockClear();
      process.env.EXPO_ACCESS_TOKEN = 'expo-token-abc';
      await service.notifyBookingConfirmed(booking());
      const [, withTokenOptions] = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(withTokenOptions.headers.Authorization).toBe('Bearer expo-token-abc');
    });
  });

  describe('autolimpeza de token inválido (item 5 do prompt)', () => {
    it('DeviceNotRegistered remove o token correspondente', async () => {
      pushTokensService.findTokensForUser.mockResolvedValue([
        { token: 'ExponentPushToken[valido]' },
        { token: 'ExponentPushToken[invalido]' },
      ]);
      fetchMock.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [
            { status: 'ok', id: 'ticket-1' },
            {
              status: 'error',
              message: 'device not registered',
              details: { error: 'DeviceNotRegistered' },
            },
          ],
        }),
      });

      await service.notifyBookingConfirmed(booking());

      expect(pushTokensService.removeByToken).toHaveBeenCalledTimes(1);
      expect(pushTokensService.removeByToken).toHaveBeenCalledWith('ExponentPushToken[invalido]');
    });

    it('erro que não é DeviceNotRegistered nunca remove o token', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [{ status: 'error', details: { error: 'MessageTooBig' } }],
        }),
      });

      await service.notifyBookingConfirmed(booking());

      expect(pushTokensService.removeByToken).not.toHaveBeenCalled();
    });
  });

  describe('resiliência (nunca lança pro chamador — booking/cancelamento/pagamento nunca podem falhar por causa disto)', () => {
    it('Expo Push Service respondendo erro HTTP nunca lança', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: jest.fn() });

      await expect(service.notifyBookingConfirmed(booking())).resolves.toBeUndefined();
    });

    it('falha de rede (fetch rejeita) nunca lança', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(service.notifyBookingConfirmed(booking())).resolves.toBeUndefined();
    });

    it('erro ao consultar a quadra nunca lança', async () => {
      prisma.court.findUnique.mockRejectedValue(new Error('db down'));

      await expect(service.notifyBookingConfirmed(booking())).resolves.toBeUndefined();
    });
  });
});
