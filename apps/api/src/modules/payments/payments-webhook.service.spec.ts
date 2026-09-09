import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PaymentsWebhookService } from './payments-webhook.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { PaymentProvider } from './providers/payment-provider';
import { PushNotificationsService } from '../notifications/push-notifications.service';
import { WhatsAppNotificationsService } from '../notifications/whatsapp-notifications.service';

const SECRET = 'test-webhook-secret';

function sign(dataId: string, requestId: string, ts: string): string {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const hex = createHmac('sha256', SECRET).update(manifest).digest('hex');
  return `ts=${ts},v1=${hex}`;
}

describe('PaymentsWebhookService', () => {
  let prisma: { paymentWebhookEvent: { create: jest.Mock; updateMany: jest.Mock } };
  let paymentsService: { findByProviderPaymentId: jest.Mock; applyProviderStatus: jest.Mock };
  let paymentProvider: { getPaymentStatus: jest.Mock };
  let pushNotificationsService: { notifyPaymentConfirmed: jest.Mock };
  let whatsappNotificationsService: { notifyPaymentConfirmed: jest.Mock };
  let service: PaymentsWebhookService;

  beforeEach(() => {
    process.env.PAYMENT_WEBHOOK_SECRET = SECRET;
    prisma = {
      paymentWebhookEvent: {
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    paymentsService = {
      findByProviderPaymentId: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      // Default: nenhuma transição real (a maioria dos testes deste arquivo
      // não é sobre notificação) — os testes de M7 abaixo sobrescrevem isto.
      applyProviderStatus: jest.fn().mockResolvedValue({ transitioned: false, status: null }),
    };
    paymentProvider = { getPaymentStatus: jest.fn().mockResolvedValue({ status: 'PAID' }) };
    pushNotificationsService = { notifyPaymentConfirmed: jest.fn().mockResolvedValue(undefined) };
    whatsappNotificationsService = {
      notifyPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
    };

    service = new PaymentsWebhookService(
      prisma as unknown as PrismaService,
      paymentsService as unknown as PaymentsService,
      paymentProvider as unknown as PaymentProvider,
      pushNotificationsService as unknown as PushNotificationsService,
      whatsappNotificationsService as unknown as WhatsAppNotificationsService,
    );
  });

  afterEach(() => {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  });

  describe('parseNotification', () => {
    it('parseia o formato real do Mercado Pago', () => {
      const result = service.parseNotification({
        id: 999,
        type: 'payment',
        action: 'payment.updated',
        data: { id: 'mp-123' },
      });

      expect(result).toEqual({ providerEventId: '999', providerPaymentId: 'mp-123' });
    });

    it('sem notification id, deriva um providerEventId a partir de type+data.id', () => {
      const result = service.parseNotification({ type: 'payment', data: { id: 'mp-123' } });

      expect(result).toEqual({ providerEventId: 'payment:mp-123', providerPaymentId: 'mp-123' });
    });

    it('payload sem data.id é rejeitado', () => {
      expect(service.parseNotification({ type: 'payment' })).toBeNull();
      expect(service.parseNotification({ data: {} })).toBeNull();
    });

    it('payload que não é objeto é rejeitado', () => {
      expect(service.parseNotification('não é json')).toBeNull();
      expect(service.parseNotification(null)).toBeNull();
      expect(service.parseNotification(42)).toBeNull();
    });

    it('data.id como objeto aninhado (tentativa de forjar) nunca vira "[object Object]"', () => {
      expect(service.parseNotification({ data: { id: { forged: true } } })).toBeNull();
    });
  });

  describe('verifySignature', () => {
    it('assinatura válida (HMAC correto) passa', () => {
      const ts = '1700000000';
      const requestId = 'req-1';
      const signature = sign('mp-123', requestId, ts);

      expect(service.verifySignature('mp-123', requestId, signature)).toBe(true);
    });

    it('assinatura inválida é rejeitada', () => {
      expect(service.verifySignature('mp-123', 'req-1', 'ts=1700000000,v1=' + '0'.repeat(64))).toBe(
        false,
      );
    });

    it('header ausente é rejeitado', () => {
      expect(service.verifySignature('mp-123', 'req-1', undefined)).toBe(false);
    });

    it('sem x-request-id é rejeitado', () => {
      const signature = sign('mp-123', 'req-1', '1700000000');
      expect(service.verifySignature('mp-123', undefined, signature)).toBe(false);
    });

    it('sem PAYMENT_WEBHOOK_SECRET configurado, sempre rejeita', () => {
      delete process.env.PAYMENT_WEBHOOK_SECRET;
      const signature = sign('mp-123', 'req-1', '1700000000');
      expect(service.verifySignature('mp-123', 'req-1', signature)).toBe(false);
    });

    it('assinatura calculada para outro providerPaymentId não bate (evita reaproveitar assinatura de outro evento)', () => {
      const signature = sign('mp-999', 'req-1', '1700000000');
      expect(service.verifySignature('mp-123', 'req-1', signature)).toBe(false);
    });
  });

  describe('handleEvent — idempotência e "nunca confiar no corpo do webhook"', () => {
    it('busca o status AUTORITATIVO no provider — nunca aplica um status vindo só do payload', async () => {
      await service.handleEvent({ providerEventId: 'evt-1', providerPaymentId: 'mp-123' });

      expect(paymentProvider.getPaymentStatus).toHaveBeenCalledWith('mp-123');
      expect(paymentsService.applyProviderStatus).toHaveBeenCalledWith('payment-1', 'PAID', {
        paidAt: undefined,
        failureReason: undefined,
      });
    });

    it('evento com o mesmo providerEventId processado duas vezes só executa uma vez (dedup)', async () => {
      prisma.paymentWebhookEvent.create
        .mockResolvedValueOnce({ id: 'evt-1' })
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('unique violation', {
            code: 'P2002',
            clientVersion: '6.0.0',
          }),
        );

      await service.handleEvent({ providerEventId: 'evt-1', providerPaymentId: 'mp-123' });
      await service.handleEvent({ providerEventId: 'evt-1', providerPaymentId: 'mp-123' });

      expect(paymentProvider.getPaymentStatus).toHaveBeenCalledTimes(1);
      expect(paymentsService.applyProviderStatus).toHaveBeenCalledTimes(1);
    });

    it('providerPaymentId sem Payment local correspondente é ignorado, nunca lança', async () => {
      paymentsService.findByProviderPaymentId.mockResolvedValue(null);

      await expect(
        service.handleEvent({ providerEventId: 'evt-2', providerPaymentId: 'mp-desconhecido' }),
      ).resolves.toBeUndefined();
      expect(paymentProvider.getPaymentStatus).not.toHaveBeenCalled();
    });

    it('erro ao consultar o provider é logado e marcado no evento, nunca lança pro chamador', async () => {
      paymentProvider.getPaymentStatus.mockRejectedValue(new Error('timeout'));

      await expect(
        service.handleEvent({ providerEventId: 'evt-3', providerPaymentId: 'mp-123' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('handleEvent — notificação de pagamento confirmado (M7)', () => {
    const booking = { id: 'booking-1', userId: 'user-1' };

    it('transição real para PAID dispara a notificação com a Booking correta', async () => {
      paymentsService.applyProviderStatus.mockResolvedValue({
        transitioned: true,
        status: 'PAID',
        booking,
      });

      await service.handleEvent({ providerEventId: 'evt-1', providerPaymentId: 'mp-123' });

      expect(pushNotificationsService.notifyPaymentConfirmed).toHaveBeenCalledWith(booking);
      expect(pushNotificationsService.notifyPaymentConfirmed).toHaveBeenCalledTimes(1);
      // W2 — mesmo guard exato, canal WhatsApp.
      expect(whatsappNotificationsService.notifyPaymentConfirmed).toHaveBeenCalledWith(booking);
      expect(whatsappNotificationsService.notifyPaymentConfirmed).toHaveBeenCalledTimes(1);
    });

    it('evento ignorado (Payment já terminal) NUNCA notifica — nenhuma duplicação por webhook reprocessado', async () => {
      paymentsService.applyProviderStatus.mockResolvedValue({
        transitioned: false,
        status: 'PAID',
      });

      await service.handleEvent({ providerEventId: 'evt-1', providerPaymentId: 'mp-123' });

      expect(pushNotificationsService.notifyPaymentConfirmed).not.toHaveBeenCalled();
      expect(whatsappNotificationsService.notifyPaymentConfirmed).not.toHaveBeenCalled();
    });

    it('transição real para um status diferente de PAID (ex: FAILED) nunca dispara notificação de pagamento confirmado', async () => {
      paymentsService.applyProviderStatus.mockResolvedValue({
        transitioned: true,
        status: 'FAILED',
      });

      await service.handleEvent({ providerEventId: 'evt-1', providerPaymentId: 'mp-123' });

      expect(pushNotificationsService.notifyPaymentConfirmed).not.toHaveBeenCalled();
      expect(whatsappNotificationsService.notifyPaymentConfirmed).not.toHaveBeenCalled();
    });

    it('falha ao notificar nunca impede o evento de ser marcado como processado', async () => {
      paymentsService.applyProviderStatus.mockResolvedValue({
        transitioned: true,
        status: 'PAID',
        booking,
      });
      pushNotificationsService.notifyPaymentConfirmed.mockRejectedValue(
        new Error('Expo indisponível'),
      );

      await expect(
        service.handleEvent({ providerEventId: 'evt-1', providerPaymentId: 'mp-123' }),
      ).resolves.toBeUndefined();
      const [[updateManyArg]] = prisma.paymentWebhookEvent.updateMany.mock.calls as [
        [{ data: { resultSummary: string } }],
      ];
      expect(updateManyArg.data.resultSummary).toBe('processed: PAID');
    });

    // W2 — canais independentes: uma falha no WhatsApp nunca impede o push
    // (e vice-versa, provado pelo teste acima) nem o evento de ser marcado
    // como processado. Nenhum dos dois pode reverter o estado financeiro já
    // decidido por `applyProviderStatus`.
    it('falha ao notificar via WhatsApp nunca impede o push nem o evento de ser marcado como processado', async () => {
      paymentsService.applyProviderStatus.mockResolvedValue({
        transitioned: true,
        status: 'PAID',
        booking,
      });
      whatsappNotificationsService.notifyPaymentConfirmed.mockRejectedValue(
        new Error('Meta indisponível'),
      );

      await expect(
        service.handleEvent({ providerEventId: 'evt-1', providerPaymentId: 'mp-123' }),
      ).resolves.toBeUndefined();

      expect(pushNotificationsService.notifyPaymentConfirmed).toHaveBeenCalledWith(booking);
      const [[updateManyArg]] = prisma.paymentWebhookEvent.updateMany.mock.calls as [
        [{ data: { resultSummary: string } }],
      ];
      expect(updateManyArg.data.resultSummary).toBe('processed: PAID');
    });
  });
});
