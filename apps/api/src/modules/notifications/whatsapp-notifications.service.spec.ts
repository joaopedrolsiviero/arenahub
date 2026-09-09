import { WhatsAppNotificationsService } from './whatsapp-notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    userId: 'user-1',
    type: 'CUSTOMER',
    courtId: 'court-1',
    total: 100,
    startsAt: new Date('2026-09-07T13:00:00.000Z'), // 10:00 -03:00
    ...overrides,
  } as never;
}

describe('WhatsAppNotificationsService', () => {
  let prisma: { court: { findUnique: jest.Mock }; user: { findUnique: jest.Mock } };
  let whatsappProvider: { sendMessage: jest.Mock };
  let service: WhatsAppNotificationsService;

  beforeEach(() => {
    prisma = {
      court: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Quadra 1',
          arena: {
            name: 'Arena Central',
            timezone: 'America/Sao_Paulo',
            whatsappPhoneNumberId: '1000000001',
          },
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ phone: '+5511900000001' }),
      },
    };
    whatsappProvider = { sendMessage: jest.fn().mockResolvedValue(undefined) };

    service = new WhatsAppNotificationsService(
      prisma as unknown as PrismaService,
      whatsappProvider,
    );
  });

  describe('filtro de elegibilidade (nunca notifica o que não é reserva de cliente)', () => {
    it('Booking sem userId (bloqueio programático) nunca consulta a quadra nem chama o provider', async () => {
      await service.notifyBookingConfirmed(booking({ userId: null }));

      expect(prisma.court.findUnique).not.toHaveBeenCalled();
      expect(whatsappProvider.sendMessage).not.toHaveBeenCalled();
    });

    it('BLOCK/MAINTENANCE nunca geram notificação de reserva de cliente', async () => {
      await service.notifyBookingConfirmed(booking({ type: 'BLOCK', userId: 'admin-1' }));

      expect(whatsappProvider.sendMessage).not.toHaveBeenCalled();
    });

    it('arena sem whatsappPhoneNumberId configurado nunca envia (sem remetente pra usar)', async () => {
      prisma.court.findUnique.mockResolvedValue({
        name: 'Quadra 1',
        arena: {
          name: 'Arena Central',
          timezone: 'America/Sao_Paulo',
          whatsappPhoneNumberId: null,
        },
      });

      await service.notifyBookingConfirmed(booking());

      expect(whatsappProvider.sendMessage).not.toHaveBeenCalled();
    });

    it('usuário sem telefone cadastrado nunca envia', async () => {
      prisma.user.findUnique.mockResolvedValue({ phone: null });

      await service.notifyBookingConfirmed(booking());

      expect(whatsappProvider.sendMessage).not.toHaveBeenCalled();
    });

    it('quadra não encontrada (excluída/inconsistência) nunca lança, só não notifica', async () => {
      prisma.court.findUnique.mockResolvedValue(null);

      await expect(service.notifyBookingConfirmed(booking())).resolves.toBeUndefined();
      expect(whatsappProvider.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('identidade do destinatário (item de segurança: sempre do banco, nunca do texto do cliente)', () => {
    it('nunca consulta WhatsAppConversation — usa sempre User.phone', async () => {
      await service.notifyBookingConfirmed(booking());

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { phone: true },
      });
    });

    it('remetente é sempre o whatsappPhoneNumberId da arena DESTA Booking, nunca de outra', async () => {
      await service.notifyBookingConfirmed(booking());

      const [message] = whatsappProvider.sendMessage.mock.calls[0] as [
        { fromPhoneNumberId: string; to: string },
      ];
      expect(message.fromPhoneNumberId).toBe('1000000001');
      expect(message.to).toBe('+5511900000001');
    });
  });

  describe('conteúdo das mensagens (reaproveita as mesmas strings de whatsapp/messages.ts)', () => {
    it('reserva confirmada: quadra, data, horário e preço — nunca ID interno/secret', async () => {
      await service.notifyBookingConfirmed(booking({ total: 150 }));

      const [message] = whatsappProvider.sendMessage.mock.calls[0] as [{ text: string }];
      expect(message.text).toContain('Quadra 1');
      expect(message.text).toContain('10h');
      expect(message.text).toContain('R$');
      expect(message.text).not.toContain('booking-1');
      expect(message.text).not.toContain('user-1');
    });

    it('reserva cancelada: menciona a quadra e o horário', async () => {
      await service.notifyBookingCancelled(booking());

      const [message] = whatsappProvider.sendMessage.mock.calls[0] as [{ text: string }];
      expect(message.text).toMatch(/cancelada/i);
      expect(message.text).toContain('Quadra 1');
    });

    it('pagamento confirmado: mesma mensagem exata da resposta direta do bot pra PaymentStatus.PAID', async () => {
      await service.notifyPaymentConfirmed(booking());

      const [message] = whatsappProvider.sendMessage.mock.calls[0] as [{ text: string }];
      expect(message.text).toBe('Seu pagamento foi aprovado! ✅ Reserva confirmada.');
    });

    it('reembolso confirmado: mensagem dedicada, nunca finge que foi só solicitado', async () => {
      await service.notifyRefundConfirmed(booking());

      const [message] = whatsappProvider.sendMessage.mock.calls[0] as [{ text: string }];
      expect(message.text).toMatch(/reembolso confirmado/i);
    });

    it('nenhuma mensagem inclui payload bruto do provider, token ou dado de autenticação', async () => {
      await service.notifyBookingConfirmed(booking());

      const [message] = whatsappProvider.sendMessage.mock.calls[0] as [{ text: string }];
      expect(message.text).not.toMatch(/Authorization|Bearer|providerPaymentId|idempotencyKey/i);
    });
  });

  describe('resiliência (nunca lança pro chamador — evento de negócio já aconteceu)', () => {
    it('falha do provider ao enviar nunca lança', async () => {
      whatsappProvider.sendMessage.mockRejectedValue(new Error('Meta indisponível'));

      await expect(service.notifyBookingConfirmed(booking())).resolves.toBeUndefined();
    });

    it('erro ao consultar a quadra nunca lança', async () => {
      prisma.court.findUnique.mockRejectedValue(new Error('db down'));

      await expect(service.notifyBookingConfirmed(booking())).resolves.toBeUndefined();
    });

    it('erro ao consultar o usuário nunca lança', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('db down'));

      await expect(service.notifyBookingConfirmed(booking())).resolves.toBeUndefined();
    });
  });
});
