import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentProviderError } from './providers/payment-provider';

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: '6.0.0',
  });
}

describe('PaymentsService', () => {
  let tx: {
    $executeRaw: jest.Mock;
    payment: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    booking: { findUnique: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    payment: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    user: { findUniqueOrThrow: jest.Mock };
  };
  let bookingsService: { findMyBookingDetail: jest.Mock };
  let paymentProvider: {
    createPayment: jest.Mock;
    getPaymentStatus: jest.Mock;
    refundPayment: jest.Mock;
    getRefundStatus: jest.Mock;
  };
  let service: PaymentsService;

  const myBooking = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'booking-1',
    status: 'CONFIRMED',
    startsAt: new Date(),
    endsAt: new Date(),
    total: new Prisma.Decimal(75),
    court: {
      id: 'court-1',
      name: 'Quadra 1',
      sport: 'BEACH_VOLLEYBALL',
      arena: { id: 'arena-1', name: 'Arena A', slug: 'a', timezone: 'America/Sao_Paulo' },
    },
    ...overrides,
  });

  const paymentRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'payment-1',
    bookingId: 'booking-1',
    userId: 'user-1',
    arenaId: 'arena-1',
    amount: new Prisma.Decimal(75),
    currency: 'BRL',
    status: 'PENDING',
    provider: 'MERCADO_PAGO',
    providerPaymentId: null,
    checkoutUrl: null,
    pixCopyPaste: null,
    qrCodeBase64: null,
    idempotencyKey: 'key-1',
    failureReason: null,
    paidAt: null,
    expiresAt: new Date(Date.now() + 30 * 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn(),
      payment: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      booking: { findUnique: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      payment: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ email: 'user1@example.com' }) },
    };
    bookingsService = { findMyBookingDetail: jest.fn().mockResolvedValue(myBooking()) };
    paymentProvider = {
      createPayment: jest.fn().mockResolvedValue({
        providerPaymentId: 'mp-123',
        checkoutUrl: 'https://mp.example/checkout',
        pixCopyPaste: '00020126...',
        qrCodeBase64: 'iVBORw0KGgo=',
      }),
      getPaymentStatus: jest.fn(),
      refundPayment: jest.fn(),
      getRefundStatus: jest.fn(),
    };

    service = new PaymentsService(
      prisma as unknown as PrismaService,
      bookingsService as unknown as BookingsService,
      paymentProvider,
    );
  });

  describe('createPayment', () => {
    it('propaga NotFoundException quando a Booking não existe/não é do usuário/não é CUSTOMER', async () => {
      bookingsService.findMyBookingDetail.mockRejectedValue(
        new NotFoundException('Reserva não encontrada.'),
      );

      await expect(service.createPayment('user-1', 'booking-x', 'key-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejeita Booking CANCELLED com ConflictException, sem tocar na tabela Payment', async () => {
      bookingsService.findMyBookingDetail.mockResolvedValue(myBooking({ status: 'CANCELLED' }));

      await expect(service.createPayment('user-1', 'booking-1', 'key-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // Fase pós-M7 (auditoria) — lacuna de cobertura identificada: o guard de
    // `paymentMode: 'IN_PERSON'` (item de segurança explícito — a arena vem
    // sempre do banco via `findMyBookingDetail`, nunca de um valor enviado
    // pelo cliente) nunca tinha teste dedicado. Mesmo padrão do teste
    // irmão acima (Booking CANCELLED): rejeita ANTES de qualquer transação
    // ou chamada ao provider.
    it('rejeita ConflictException quando a arena usa paymentMode IN_PERSON — nunca chama o provider nem toca na tabela Payment', async () => {
      bookingsService.findMyBookingDetail.mockResolvedValue(
        myBooking({
          court: {
            id: 'court-1',
            name: 'Quadra 1',
            sport: 'BEACH_VOLLEYBALL',
            arena: {
              id: 'arena-1',
              name: 'Arena A',
              slug: 'a',
              timezone: 'America/Sao_Paulo',
              paymentMode: 'IN_PERSON',
            },
          },
        }),
      );

      await expect(service.createPayment('user-1', 'booking-1', 'key-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(paymentProvider.createPayment).not.toHaveBeenCalled();
    });

    it('cria o Payment com o valor EXATO de Booking.total — nunca outro valor', async () => {
      tx.payment.create.mockResolvedValue(paymentRow({ providerPaymentId: null }));
      prisma.payment.update.mockResolvedValue(paymentRow({ providerPaymentId: 'mp-123' }));

      await service.createPayment('user-1', 'booking-1', 'key-1');

      const [[createArgs]] = tx.payment.create.mock.calls as [[{ data: Record<string, unknown> }]];
      expect(createArgs.data.amount).toBeInstanceOf(Prisma.Decimal);
      expect((createArgs.data.amount as Prisma.Decimal).toNumber()).toBe(75);
      expect(createArgs.data.currency).toBe('BRL');
      expect(createArgs.data.status).toBe('PENDING');
    });

    it('serializa a criação por bookingId via advisory lock', async () => {
      tx.payment.create.mockResolvedValue(paymentRow());
      prisma.payment.update.mockResolvedValue(paymentRow({ providerPaymentId: 'mp-123' }));

      await service.createPayment('user-1', 'booking-1', 'key-1');

      expect(tx.$executeRaw).toHaveBeenCalled();
    });

    it('chama o provider só depois de criar o Payment local, e persiste o providerPaymentId', async () => {
      tx.payment.create.mockResolvedValue(paymentRow());
      prisma.payment.update.mockResolvedValue(
        paymentRow({
          providerPaymentId: 'mp-123',
          checkoutUrl: 'https://mp.example/checkout',
          pixCopyPaste: '00020126...',
          qrCodeBase64: 'iVBORw0KGgo=',
        }),
      );

      const result = await service.createPayment('user-1', 'booking-1', 'key-1');

      expect(paymentProvider.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentId: 'payment-1',
          amount: 75,
          currency: 'BRL',
          payerEmail: 'user1@example.com',
        }),
      );
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: {
          providerPaymentId: 'mp-123',
          checkoutUrl: 'https://mp.example/checkout',
          pixCopyPaste: '00020126...',
          qrCodeBase64: 'iVBORw0KGgo=',
        },
      });
      expect(result.checkoutUrl).toBe('https://mp.example/checkout');
      expect(result.pixCopyPaste).toBe('00020126...');
      expect(result.qrCodeBase64).toBe('iVBORw0KGgo=');
    });

    it('idempotência: mesma (bookingId, idempotencyKey) devolve o Payment existente, nunca chama o provider de novo', async () => {
      const existing = paymentRow({ providerPaymentId: 'mp-existing' });
      tx.payment.findUnique.mockResolvedValue(existing);

      const result = await service.createPayment('user-1', 'booking-1', 'key-1');

      expect(paymentProvider.createPayment).not.toHaveBeenCalled();
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(result.id).toBe('payment-1');
    });

    it('tentativa PENDING ativa (não expirada) para outra chave: devolve a mesma tentativa, nunca abre uma segunda cobrança', async () => {
      tx.payment.findFirst.mockResolvedValue(paymentRow({ idempotencyKey: 'outra-chave' }));

      const result = await service.createPayment('user-1', 'booking-1', 'key-nova');

      expect(paymentProvider.createPayment).not.toHaveBeenCalled();
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(result.id).toBe('payment-1');
    });

    it('Booking já com Payment PAID: rejeita com ConflictException, nunca cria nova tentativa', async () => {
      tx.payment.findFirst.mockResolvedValue(paymentRow({ status: 'PAID' }));

      await expect(service.createPayment('user-1', 'booking-1', 'key-nova')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    // Precedência financeira (pós EXPIRED -> PAID): A (antigo, expirado
    // localmente) foi aprovado tardiamente e está PAID; B, mais novo, ainda
    // é PENDING. "A tentativa mais recente" deixou de ser uma regra válida.
    it('Booking com Payment PAID mais ANTIGO e uma tentativa PENDING mais nova: ConflictException — nunca devolve o PIX da tentativa nova nem cria uma terceira cobrança', async () => {
      tx.payment.findFirst
        .mockResolvedValueOnce(
          paymentRow({ id: 'payment-A', status: 'PAID', idempotencyKey: 'key-A' }),
        )
        .mockResolvedValue(
          paymentRow({ id: 'payment-B', status: 'PENDING', idempotencyKey: 'key-B' }),
        );

      await expect(service.createPayment('user-1', 'booking-1', 'key-nova')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(paymentProvider.createPayment).not.toHaveBeenCalled();
    });

    it('replay da chave da tentativa PENDING (B) depois que A já está PAID: ConflictException, nunca devolve o PIX de B', async () => {
      tx.payment.findFirst.mockResolvedValueOnce(
        paymentRow({ id: 'payment-A', status: 'PAID', idempotencyKey: 'key-A' }),
      );
      tx.payment.findUnique.mockResolvedValue(
        paymentRow({ id: 'payment-B', status: 'PENDING', idempotencyKey: 'key-B' }),
      );

      await expect(service.createPayment('user-1', 'booking-1', 'key-B')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(paymentProvider.createPayment).not.toHaveBeenCalled();
    });

    it('replay da chave da PRÓPRIA tentativa paga (A): continua idempotente — devolve o Payment PAID, sem erro e sem chamar o provider', async () => {
      const paidA = paymentRow({ id: 'payment-A', status: 'PAID', idempotencyKey: 'key-A' });
      tx.payment.findFirst.mockResolvedValueOnce(paidA);
      tx.payment.findUnique.mockResolvedValue(paidA);

      const result = await service.createPayment('user-1', 'booking-1', 'key-A');

      expect(result.id).toBe('payment-A');
      expect(result.status).toBe('PAID');
      expect(paymentProvider.createPayment).not.toHaveBeenCalled();
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('tentativa PENDING expirada: expira a antiga e cria uma nova, chamando o provider só para a nova', async () => {
      const expired = paymentRow({ id: 'payment-old', expiresAt: new Date(Date.now() - 1000) });
      tx.payment.findFirst.mockResolvedValue(expired);
      tx.payment.create.mockResolvedValue(paymentRow({ id: 'payment-new' }));
      prisma.payment.update.mockResolvedValue(
        paymentRow({ id: 'payment-new', providerPaymentId: 'mp-123' }),
      );

      const result = await service.createPayment('user-1', 'booking-1', 'key-nova');

      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-old', status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      expect(tx.payment.create).toHaveBeenCalled();
      expect(paymentProvider.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: 'payment-new' }),
      );
      expect(result.id).toBe('payment-new');
    });

    it('falha do provider marca o Payment como FAILED e devolve a view, sem lançar', async () => {
      tx.payment.create.mockResolvedValue(paymentRow());
      paymentProvider.createPayment.mockRejectedValue(new PaymentProviderError());
      prisma.payment.findUniqueOrThrow.mockResolvedValue(
        paymentRow({ status: 'FAILED', failureReason: 'PROVIDER_ERROR' }),
      );

      const result = await service.createPayment('user-1', 'booking-1', 'key-1');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PENDING' },
        data: { status: 'FAILED', failureReason: 'PROVIDER_ERROR' },
      });
      expect(result.status).toBe('FAILED');
      expect(result.failureReason).toBe('PROVIDER_ERROR');
    });
  });

  describe('getPaymentForBooking', () => {
    it('devolve null quando nunca houve nenhuma tentativa', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(service.getPaymentForBooking('user-1', 'booking-1')).resolves.toBeNull();
      expect(bookingsService.findMyBookingDetail).toHaveBeenCalledWith('user-1', 'booking-1');
    });

    it('precedência financeira: Payment PAID (antigo) + tentativa PENDING mais nova — devolve o PAID, e a 1ª consulta pede só PAID/REFUNDING', async () => {
      prisma.payment.findFirst.mockResolvedValueOnce(
        paymentRow({ id: 'payment-A', status: 'PAID' }),
      );

      const result = await service.getPaymentForBooking('user-1', 'booking-1');

      expect(result?.id).toBe('payment-A');
      expect(result?.status).toBe('PAID');
      expect(prisma.payment.findFirst).toHaveBeenNthCalledWith(1, {
        where: { bookingId: 'booking-1', status: { in: ['PAID', 'REFUNDING'] } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('sem PAID/REFUNDING, cai no Payment mais recente (regra anterior preservada)', async () => {
      prisma.payment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(paymentRow({ id: 'payment-B', status: 'FAILED' }));

      const result = await service.getPaymentForBooking('user-1', 'booking-1');

      expect(result?.id).toBe('payment-B');
      expect(prisma.payment.findFirst).toHaveBeenNthCalledWith(2, {
        where: { bookingId: 'booking-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('propaga 404 quando a Booking não existe/não é do usuário', async () => {
      bookingsService.findMyBookingDetail.mockRejectedValue(new NotFoundException());

      await expect(service.getPaymentForBooking('user-1', 'booking-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('PENDING expirado é lazily marcado EXPIRED na leitura (mesmo padrão de ArenaInvitation)', async () => {
      const expired = paymentRow({ expiresAt: new Date(Date.now() - 1000) });
      prisma.payment.findFirst.mockResolvedValue(expired);
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.getPaymentForBooking('user-1', 'booking-1');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      expect(result?.status).toBe('EXPIRED');
    });

    it('REFUNDING confirmado (REFUNDED) pelo provider é reconciliado lazily na leitura (Fase 27)', async () => {
      const refunding = paymentRow({
        status: 'REFUNDING',
        providerPaymentId: 'mp-123',
        refundId: 'refund-1',
      });
      prisma.payment.findFirst.mockResolvedValue(refunding);
      paymentProvider.getRefundStatus.mockResolvedValue('REFUNDED');
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.getPaymentForBooking('user-1', 'booking-1');

      expect(paymentProvider.getRefundStatus).toHaveBeenCalledWith('mp-123', 'refund-1');
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'REFUNDING' },
        data: { status: 'REFUNDED', refundedAt: expect.any(Date) as Date },
      });
      expect(result?.status).toBe('REFUNDED');
    });

    it('REFUNDING ainda em processamento: continua REFUNDING, nunca escreve no banco (Fase 27)', async () => {
      const refunding = paymentRow({
        status: 'REFUNDING',
        providerPaymentId: 'mp-123',
        refundId: 'refund-1',
      });
      prisma.payment.findFirst.mockResolvedValue(refunding);
      paymentProvider.getRefundStatus.mockResolvedValue('REFUNDING');

      const result = await service.getPaymentForBooking('user-1', 'booking-1');

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(result?.status).toBe('REFUNDING');
    });

    it('falha ao consultar o provider durante a leitura nunca lança — devolve o estado local (Fase 27)', async () => {
      const refunding = paymentRow({
        status: 'REFUNDING',
        providerPaymentId: 'mp-123',
        refundId: 'refund-1',
      });
      prisma.payment.findFirst.mockResolvedValue(refunding);
      paymentProvider.getRefundStatus.mockRejectedValue(new Error('timeout'));

      const result = await service.getPaymentForBooking('user-1', 'booking-1');

      expect(result?.status).toBe('REFUNDING');
    });
  });

  describe('getLatestPaymentStatusesForUser (Fase 26)', () => {
    it('devolve um mapa bookingId -> status, uma linha por Booking (a mais recente)', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { bookingId: 'booking-1', status: 'PAID', expiresAt: null },
        { bookingId: 'booking-2', status: 'FAILED', expiresAt: null },
      ]);

      const result = await service.getLatestPaymentStatusesForUser('user-1');

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        distinct: ['bookingId'],
        select: { bookingId: true, status: true, expiresAt: true },
      });
      expect(result).toEqual({ 'booking-1': 'PAID', 'booking-2': 'FAILED' });
    });

    it('PENDING com prazo vencido é reportado como EXPIRED só na resposta, sem escrever no banco', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { bookingId: 'booking-1', status: 'PENDING', expiresAt: new Date(Date.now() - 1000) },
      ]);

      const result = await service.getLatestPaymentStatusesForUser('user-1');

      expect(result).toEqual({ 'booking-1': 'EXPIRED' });
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('PENDING ainda dentro do prazo continua PENDING', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { bookingId: 'booking-1', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) },
      ]);

      const result = await service.getLatestPaymentStatusesForUser('user-1');

      expect(result).toEqual({ 'booking-1': 'PENDING' });
    });

    it('precedência financeira: Booking com PAID antigo e uma tentativa PENDING mais nova aparece como PAID, nunca PENDING', async () => {
      prisma.payment.findMany
        .mockResolvedValueOnce([
          { bookingId: 'booking-1', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) },
        ])
        .mockResolvedValueOnce([{ bookingId: 'booking-1', status: 'PAID' }]);

      const result = await service.getLatestPaymentStatusesForUser('user-1');

      expect(result).toEqual({ 'booking-1': 'PAID' });
      expect(prisma.payment.findMany).toHaveBeenNthCalledWith(2, {
        where: { userId: 'user-1', status: { in: ['PAID', 'REFUNDING'] } },
        select: { bookingId: true, status: true },
      });
    });

    it('REFUNDING vence uma tentativa mais nova não financeira, e PAID nunca é sobrescrito por REFUNDING (em qualquer ordem)', async () => {
      prisma.payment.findMany
        .mockResolvedValueOnce([
          { bookingId: 'booking-1', status: 'FAILED', expiresAt: null },
          { bookingId: 'booking-2', status: 'EXPIRED', expiresAt: null },
          { bookingId: 'booking-3', status: 'EXPIRED', expiresAt: null },
        ])
        .mockResolvedValueOnce([
          { bookingId: 'booking-1', status: 'REFUNDING' },
          { bookingId: 'booking-2', status: 'PAID' },
          { bookingId: 'booking-2', status: 'REFUNDING' },
          { bookingId: 'booking-3', status: 'REFUNDING' },
          { bookingId: 'booking-3', status: 'PAID' },
        ]);

      const result = await service.getLatestPaymentStatusesForUser('user-1');

      expect(result).toEqual({
        'booking-1': 'REFUNDING',
        'booking-2': 'PAID',
        'booking-3': 'PAID',
      });
    });

    it('sem nenhuma tentativa de pagamento, devolve mapa vazio', async () => {
      prisma.payment.findMany.mockResolvedValue([]);

      await expect(service.getLatestPaymentStatusesForUser('user-1')).resolves.toEqual({});
    });
  });

  describe('applyProviderStatus — máquina de estados (item 9: eventos fora de ordem)', () => {
    it('PENDING -> PAID aplica normalmente, com paidAt', async () => {
      prisma.$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(tx));
      tx.payment.findUnique.mockResolvedValue(paymentRow());
      tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });

      const result = await service.applyProviderStatus('payment-1', 'PAID', {
        paidAt: new Date('2026-01-01'),
      });

      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PENDING' },
        data: { status: 'PAID', paidAt: new Date('2026-01-01'), failureReason: null },
      });
      // M7 — sinal de idempotência pra notificação: transição real +
      // Booking anexada só quando o novo status é PAID.
      expect(result).toEqual({
        transitioned: true,
        status: 'PAID',
        booking: { id: 'booking-1', status: 'CONFIRMED' },
      });
    });

    it('PENDING -> FAILED aplica normalmente (pagamento recusado pelo Mercado Pago, Fase 25 Caso 3)', async () => {
      prisma.$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(tx));
      tx.payment.findUnique.mockResolvedValue(paymentRow());
      tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });

      const result = await service.applyProviderStatus('payment-1', 'FAILED', {
        failureReason: 'cc_rejected_other',
      });

      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PENDING' },
        data: { status: 'FAILED', paidAt: null, failureReason: 'cc_rejected_other' },
      });
      // M7 — transicionou de verdade, mas nunca anexa `booking` fora de
      // PAID (PushNotificationsService.notifyPaymentConfirmed é só para
      // pagamento confirmado, nunca para falha).
      expect(result).toEqual({ transitioned: true, status: 'FAILED', booking: undefined });
    });

    it('PAID é terminal: um evento FAILED posterior é ignorado, nunca reverte pra FAILED', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'PAID' }));

      const result = await service.applyProviderStatus('payment-1', 'FAILED', {});

      expect(tx.payment.updateMany).not.toHaveBeenCalled();
      // M7 — nunca transicionou (já estava terminal); nunca notifica de novo.
      expect(result).toEqual({ transitioned: false, status: 'PAID' });
    });

    it('EXPIRED + FAILED do provider continua ignorado (terminal) — só PAID reabre um EXPIRED', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'EXPIRED' }));

      const result = await service.applyProviderStatus('payment-1', 'FAILED', {});

      expect(tx.payment.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ transitioned: false, status: 'EXPIRED' });
    });

    it('EXPIRED + CANCELLED do provider continua ignorado (terminal) — só PAID reabre um EXPIRED', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'EXPIRED' }));

      const result = await service.applyProviderStatus('payment-1', 'CANCELLED', {});

      expect(tx.payment.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ transitioned: false, status: 'EXPIRED' });
    });

    // BLOCKER (correção desta fase) — o Mercado Pago não recebe
    // `date_of_expiration` e pode aprovar um PIX depois do nosso prazo
    // local de 30min; antes desta correção, um Payment já EXPIRED
    // descartava silenciosamente esse PAID (dinheiro real recebido, nunca
    // refletido no banco). Reconciliação: reabre EXCLUSIVAMENTE
    // EXPIRED+PAID, reaproveitando as MESMAS checagens de Booking do
    // caminho PENDING normal — nunca confirma uma reserva que não é mais
    // válida.
    describe('BLOCKER — aprovação tardia do provider sobre um Payment já EXPIRED localmente', () => {
      it('reconcilia EXPIRED -> PAID quando a Booking continua CONFIRMED — nunca perde um pagamento aprovado', async () => {
        tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'EXPIRED' }));
        tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });

        const result = await service.applyProviderStatus('payment-1', 'PAID', {
          paidAt: new Date('2026-01-01'),
        });

        expect(tx.payment.updateMany).toHaveBeenCalledWith({
          where: { id: 'payment-1', status: 'EXPIRED' },
          data: { status: 'PAID', paidAt: new Date('2026-01-01'), failureReason: null },
        });
        expect(result).toEqual({
          transitioned: true,
          status: 'PAID',
          booking: { id: 'booking-1', status: 'CONFIRMED' },
        });
      });

      // Decisão desta fase (substitui o comportamento anterior, que gravava
      // CANCELLED e deixava dinheiro real recebido sem tratamento): o
      // provider APROVOU o pagamento, então o Payment é registrado como PAID
      // (verdade financeira) e o resultado sinaliza `refundRequired` pra
      // borda do webhook acionar o refund idempotente. A Booking cancelada
      // nunca é reaberta, e nunca há `booking` no resultado (nada de
      // notificação de "pagamento confirmado" pra uma reserva que não existe).
      it('Booking já CANCELLED quando a aprovação tardia chega: Payment vira PAID (dinheiro recebido) e sinaliza refundRequired — nunca reabre a reserva', async () => {
        tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'EXPIRED' }));
        tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CANCELLED' });

        const result = await service.applyProviderStatus('payment-1', 'PAID', {
          paidAt: new Date('2026-01-01'),
        });

        expect(tx.payment.updateMany).toHaveBeenCalledWith({
          where: { id: 'payment-1', status: 'EXPIRED' },
          data: { status: 'PAID', paidAt: new Date('2026-01-01'), failureReason: null },
        });
        expect(result.transitioned).toBe(true);
        expect(result.status).toBe('PAID');
        expect(result.booking).toBeUndefined(); // nunca dispara "pagamento confirmado"
        expect(result.refundRequired).toEqual({
          bookingId: 'booking-1',
          booking: { id: 'booking-1', status: 'CANCELLED' },
        });
      });

      it('Booking inexistente quando a aprovação tardia chega: Payment vira PAID e sinaliza refundRequired, nunca lança', async () => {
        tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'EXPIRED' }));
        tx.booking.findUnique.mockResolvedValue(null);

        const result = await service.applyProviderStatus('payment-1', 'PAID', {});

        expect(result.status).toBe('PAID');
        expect(result.transitioned).toBe(true);
        expect(result.booking).toBeUndefined();
        expect(result.refundRequired).toEqual({ bookingId: 'booking-1', booking: null });
      });

      it('Booking CONFIRMED (aprovação tardia normal) nunca sinaliza refundRequired', async () => {
        tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'EXPIRED' }));
        tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });

        const result = await service.applyProviderStatus('payment-1', 'PAID', {});

        expect(result.refundRequired).toBeUndefined();
      });

      it('aprovação tardia sobre Booking cancelada loga em nível error com paymentId/bookingId (nunca só warn)', async () => {
        const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
        tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'EXPIRED' }));
        tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CANCELLED' });

        await service.applyProviderStatus('payment-1', 'PAID', {});

        const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
        expect(logged).toContain('[late-approval][ACAO-OPERACIONAL]');
        expect(logged).toContain('payment=payment-1');
        expect(logged).toContain('booking=booking-1');
        errorSpy.mockRestore();
      });

      // Race levantada na revisão: o webhook lê PENDING, uma LEITURA expira
      // o Payment (PENDING -> EXPIRED) e o CAS do webhook devolve count 0 —
      // sem a retentativa, o PAID aprovado seria descartado como "corrida
      // perdida" com o evento já consumido.
      it('race com o lazy-expiry: CAS a partir de PENDING dá count 0, mas o Payment virou EXPIRED — refaz a reconciliação tardia a partir de EXPIRED', async () => {
        tx.payment.findUnique
          .mockResolvedValueOnce(paymentRow({ status: 'PENDING' })) // leitura inicial
          .mockResolvedValueOnce(paymentRow({ status: 'EXPIRED' })); // releitura após o count 0
        tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });
        tx.payment.updateMany
          .mockResolvedValueOnce({ count: 0 }) // WHERE status = PENDING: já expirou
          .mockResolvedValueOnce({ count: 1 }); // WHERE status = EXPIRED

        const result = await service.applyProviderStatus('payment-1', 'PAID', {});

        expect(tx.payment.updateMany).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ where: { id: 'payment-1', status: 'PENDING' } }),
        );
        expect(tx.payment.updateMany).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ where: { id: 'payment-1', status: 'EXPIRED' } }),
        );
        expect(result.transitioned).toBe(true);
        expect(result.status).toBe('PAID');
      });

      it('race com o lazy-expiry: se a releitura NÃO mostra EXPIRED (outra transação já aplicou o desfecho), continua "corrida perdida" sem retentar', async () => {
        tx.payment.findUnique
          .mockResolvedValueOnce(paymentRow({ status: 'PENDING' }))
          .mockResolvedValueOnce(paymentRow({ status: 'PAID' }));
        tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });
        tx.payment.updateMany.mockResolvedValue({ count: 0 });

        const result = await service.applyProviderStatus('payment-1', 'PAID', {});

        expect(tx.payment.updateMany).toHaveBeenCalledTimes(1);
        expect(result.transitioned).toBe(false);
      });

      it('corrida perdida na reconciliação (outra transação já resolveu o EXPIRED) nunca sinaliza transição', async () => {
        tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'EXPIRED' }));
        tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });
        tx.payment.updateMany.mockResolvedValue({ count: 0 });

        const result = await service.applyProviderStatus('payment-1', 'PAID', {});

        expect(result).toEqual({ transitioned: false, status: 'PAID' });
      });

      it('violação do índice único (outra tentativa da mesma Booking já PAID) recupera marcando FAILED a partir de EXPIRED, nunca de PENDING', async () => {
        tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'EXPIRED' }));
        tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });
        tx.payment.updateMany.mockRejectedValue(uniqueViolation());

        const result = await service.applyProviderStatus('payment-1', 'PAID', {});

        // A recuperação precisa casar o WHERE com o estado de origem REAL
        // (EXPIRED aqui) — usar PENDING por engano faria 0 linhas baterem e
        // devolveria `transitioned: true` sem nada ter sido escrito.
        expect(prisma.payment.updateMany).toHaveBeenCalledWith({
          where: { id: 'payment-1', status: 'EXPIRED' },
          data: { status: 'FAILED', failureReason: 'DUPLICATE_PAYMENT_FOR_BOOKING' },
        });
        expect(result).toEqual({ transitioned: true, status: 'FAILED' });
      });
    });

    it('PENDING (sem mudança real) é sempre um no-op, nunca escreve', async () => {
      const result = await service.applyProviderStatus('payment-1', 'PENDING', {});

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result).toEqual({ transitioned: false, status: null });
    });

    it('Booking cancelada enquanto o Payment está PENDING: PAID do provider é registrado como PAID (dinheiro recebido) e sinaliza refundRequired — nunca CANCELLED, nunca reabre a reserva', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow());
      tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CANCELLED' });
      const errorLog = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

      const result = await service.applyProviderStatus('payment-1', 'PAID', {
        paidAt: new Date('2026-01-01'),
      });

      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PENDING' },
        data: { status: 'PAID', paidAt: new Date('2026-01-01'), failureReason: null },
      });
      // Nunca "pagamento confirmado" (sem `booking`) — só sinal de refund.
      expect(result.booking).toBeUndefined();
      expect(result.refundRequired).toEqual({
        bookingId: 'booking-1',
        booking: { id: 'booking-1', status: 'CANCELLED' },
      });
      // Nenhuma escrita em Booking e nenhuma chamada HTTP ao provider dentro
      // (ou fora) da transação — o refund é responsabilidade da borda.
      expect(paymentProvider.refundPayment).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('[late-approval][ACAO-OPERACIONAL]'),
      );
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('PENDING -> PAID'));
    });

    it('PENDING + PAID sobre Booking CONFIRMED (caminho normal) segue igual: PAID com `booking`, sem refundRequired', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow());
      tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });

      const result = await service.applyProviderStatus('payment-1', 'PAID', {});

      expect(result.booking).toEqual({ id: 'booking-1', status: 'CONFIRMED' });
      expect(result.refundRequired).toBeUndefined();
    });

    it('corrida perdida (count 0) é logada, nunca lança', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow());
      tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });
      tx.payment.updateMany.mockResolvedValue({ count: 0 });

      // M7 — perder a corrida nunca sinaliza uma transição real (o CAS é a
      // MESMA proteção reaproveitada pra evitar notificação duplicada).
      await expect(service.applyProviderStatus('payment-1', 'PAID', {})).resolves.toEqual({
        transitioned: false,
        status: 'PAID',
      });
    });

    it('Payment inexistente é ignorado, nunca lança', async () => {
      tx.payment.findUnique.mockResolvedValue(null);

      await expect(service.applyProviderStatus('payment-x', 'PAID', {})).resolves.toEqual({
        transitioned: false,
        status: null,
      });
    });

    it('violação do índice único "um PAID por Booking" recupera marcando FAILED (fora da transação que falhou)', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow());
      tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });
      tx.payment.updateMany.mockRejectedValue(uniqueViolation());

      const result = await service.applyProviderStatus('payment-1', 'PAID', {});

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PENDING' },
        data: { status: 'FAILED', failureReason: 'DUPLICATE_PAYMENT_FOR_BOOKING' },
      });
      // M7 — desfecho real foi FAILED (duplicidade), nunca PAID; nunca
      // anexa Booking (só PaymentsWebhookService.handleEvent decide notificar,
      // e só faz isso quando status === 'PAID').
      expect(result).toEqual({ transitioned: true, status: 'FAILED' });
    });
  });

  describe('refundIfPaid (Fase 27 — cancelamento e reembolso)', () => {
    it('Regra 1: sem nenhum Payment pra Booking, é um no-op — nunca chama o provider', async () => {
      tx.payment.findFirst.mockResolvedValue(null);

      await expect(service.refundIfPaid('booking-1')).resolves.toEqual({ refunded: false });

      expect(paymentProvider.refundPayment).not.toHaveBeenCalled();
      expect(tx.payment.updateMany).not.toHaveBeenCalled();
    });

    it('Regra 1: Payment PENDING (nunca pago) — no-op, nunca chama o provider', async () => {
      tx.payment.findFirst.mockResolvedValue(paymentRow({ status: 'PENDING' }));

      await service.refundIfPaid('booking-1');

      expect(paymentProvider.refundPayment).not.toHaveBeenCalled();
    });

    it('Regra 7: Payment FAILED/CANCELLED/EXPIRED — no-op, nunca chama o provider', async () => {
      for (const status of ['FAILED', 'CANCELLED', 'EXPIRED']) {
        paymentProvider.refundPayment.mockClear();
        tx.payment.findFirst.mockResolvedValue(paymentRow({ status }));

        await service.refundIfPaid('booking-1');

        expect(paymentProvider.refundPayment).not.toHaveBeenCalled();
      }
    });

    it('Regra 6: Payment já REFUNDED — no-op, nunca chama o provider de novo', async () => {
      tx.payment.findFirst.mockResolvedValue(paymentRow({ status: 'REFUNDED' }));

      await service.refundIfPaid('booking-1');

      expect(paymentProvider.refundPayment).not.toHaveBeenCalled();
    });

    // Precedência financeira: o Payment PAID/REFUNDING da Booking manda, nunca
    // "o mais recente" — uma tentativa nova PENDING/EXPIRED/FAILED não pode
    // esconder um pagamento antigo aprovado tardiamente (senão o cliente que
    // pagou A perderia o reembolso ao cancelar).
    it('precedência financeira: Payment PAID antigo + tentativa PENDING mais nova — reembolsa O PAID (a 1ª consulta pede só PAID/REFUNDING), nunca a tentativa nova', async () => {
      const paidA = paymentRow({ id: 'payment-A', status: 'PAID', providerPaymentId: 'mp-A' });
      tx.payment.findFirst.mockResolvedValueOnce(paidA);
      tx.payment.findUniqueOrThrow.mockResolvedValue({ ...paidA, status: 'REFUNDING' });
      paymentProvider.refundPayment.mockResolvedValue({ refundId: 'refund-A', status: 'REFUNDED' });

      const result = await service.refundIfPaid('booking-1');

      expect(tx.payment.findFirst).toHaveBeenNthCalledWith(1, {
        where: { bookingId: 'booking-1', status: { in: ['PAID', 'REFUNDING'] } },
        orderBy: { createdAt: 'desc' },
      });
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-A', status: 'PAID' },
        data: { status: 'REFUNDING' },
      });
      expect(paymentProvider.refundPayment).toHaveBeenCalledWith('mp-A', 'refund:payment-A');
      expect(result).toEqual({ refunded: true });
    });

    it('precedência financeira: só tentativas PENDING/EXPIRED/FAILED (nenhuma PAID/REFUNDING) — no-op, nunca reembolsa uma tentativa não paga', async () => {
      tx.payment.findFirst
        .mockResolvedValueOnce(null) // consulta PAID/REFUNDING
        .mockResolvedValueOnce(paymentRow({ id: 'payment-B', status: 'PENDING' })); // mais recente

      const result = await service.refundIfPaid('booking-1');

      expect(paymentProvider.refundPayment).not.toHaveBeenCalled();
      expect(tx.payment.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({ refunded: false });
    });

    it('precedência financeira: Payment REFUNDING tem precedência sobre uma tentativa mais nova e NÃO é reivindicado de novo — reusa a MESMA idempotency key', async () => {
      const refunding = paymentRow({
        id: 'payment-A',
        status: 'REFUNDING',
        providerPaymentId: 'mp-A',
        refundId: 'refund-A',
      });
      tx.payment.findFirst.mockResolvedValueOnce(refunding);
      tx.payment.findUniqueOrThrow.mockResolvedValue(refunding);
      paymentProvider.refundPayment.mockResolvedValue({ refundId: 'refund-A', status: 'REFUNDED' });

      await service.refundIfPaid('booking-1');

      expect(tx.payment.updateMany).not.toHaveBeenCalled(); // sem novo CAS PAID -> REFUNDING
      expect(paymentProvider.refundPayment).toHaveBeenCalledWith('mp-A', 'refund:payment-A');
    });

    it('Regra 2: Payment PAID — reivindica (CAS pra REFUNDING) sob advisory lock e chama o provider', async () => {
      const paid = paymentRow({ status: 'PAID', providerPaymentId: 'mp-123' });
      tx.payment.findFirst.mockResolvedValue(paid);
      tx.payment.findUniqueOrThrow.mockResolvedValue({ ...paid, status: 'REFUNDING' });
      paymentProvider.refundPayment.mockResolvedValue({ refundId: 'refund-1', status: 'REFUNDED' });

      await service.refundIfPaid('booking-1');

      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PAID' },
        data: { status: 'REFUNDING' },
      });
      expect(paymentProvider.refundPayment).toHaveBeenCalledWith('mp-123', 'refund:payment-1');
    });

    it('Regra 2: refund confirmado (REFUNDED) pelo provider persiste refundId/refundedAt — reembolso 100% integral, sem `amount`', async () => {
      const paid = paymentRow({ status: 'PAID', providerPaymentId: 'mp-123' });
      tx.payment.findFirst.mockResolvedValue(paid);
      tx.payment.findUniqueOrThrow.mockResolvedValue({ ...paid, status: 'REFUNDING' });
      paymentProvider.refundPayment.mockResolvedValue({ refundId: 'refund-1', status: 'REFUNDED' });

      const result = await service.refundIfPaid('booking-1');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: { in: ['PAID', 'REFUNDING'] } },
        data: { status: 'REFUNDED', refundId: 'refund-1', refundedAt: expect.any(Date) as Date },
      });
      // W2 — `refunded: true` é o sinal que o controller usa pra decidir se
      // dispara a notificação proativa de reembolso confirmado.
      expect(result).toEqual({ refunded: true });
    });

    // W2 — mesma classe de corrida que `applyProviderStatus` já resolve
    // (checar `count`, não só disparar o update): o advisory lock já foi
    // liberado quando a chamada ao provider acontece (é sempre fora da
    // transação), então duas chamadas concorrentes podem ambas receber
    // REFUNDED do provider (mesma idempotencyKey estável) — só uma pode
    // genuinamente "vencer" a escrita local (count > 0); a perdedora nunca
    // pode se considerar "quem confirmou agora" (nunca dispara notificação
    // duplicada).
    it('duas chamadas concorrentes recebendo REFUNDED do provider: só uma reporta refunded=true (perdedora do CAS local)', async () => {
      const paid = paymentRow({ status: 'PAID', providerPaymentId: 'mp-123' });
      tx.payment.findFirst.mockResolvedValue(paid);
      tx.payment.findUniqueOrThrow.mockResolvedValue({ ...paid, status: 'REFUNDING' });
      paymentProvider.refundPayment.mockResolvedValue({ refundId: 'refund-1', status: 'REFUNDED' });
      // A "vencedora" já gravou REFUNDED antes desta chamada chegar ao
      // updateMany final — count 0, ninguém mais pra transicionar.
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.refundIfPaid('booking-1');

      expect(result).toEqual({ refunded: false });
    });

    it('refund assíncrono (in_process) marca REFUNDING com refundId — nunca REFUNDED sem confirmação real', async () => {
      const paid = paymentRow({ status: 'PAID', providerPaymentId: 'mp-123' });
      tx.payment.findFirst.mockResolvedValue(paid);
      tx.payment.findUniqueOrThrow.mockResolvedValue({ ...paid, status: 'REFUNDING' });
      paymentProvider.refundPayment.mockResolvedValue({
        refundId: 'refund-1',
        status: 'REFUNDING',
      });

      await service.refundIfPaid('booking-1');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: { in: ['PAID', 'REFUNDING'] } },
        data: { status: 'REFUNDING', refundId: 'refund-1' },
      });
    });

    it('Mercado Pago recusa o refund (status FAILED com sucesso HTTP): reverte REFUNDING -> PAID, elegível pra retry', async () => {
      const paid = paymentRow({ status: 'PAID', providerPaymentId: 'mp-123' });
      tx.payment.findFirst.mockResolvedValue(paid);
      tx.payment.findUniqueOrThrow.mockResolvedValue({ ...paid, status: 'REFUNDING' });
      paymentProvider.refundPayment.mockResolvedValue({ refundId: 'refund-1', status: 'FAILED' });

      await service.refundIfPaid('booking-1');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'REFUNDING' },
        data: { status: 'PAID' },
      });
    });

    it('timeout/exceção do provider nunca lança e nunca marca REFUNDED sem confirmação — retry seguro depois', async () => {
      const paid = paymentRow({ status: 'PAID', providerPaymentId: 'mp-123' });
      tx.payment.findFirst.mockResolvedValue(paid);
      tx.payment.findUniqueOrThrow.mockResolvedValue({ ...paid, status: 'REFUNDING' });
      paymentProvider.refundPayment.mockRejectedValue(new Error('timeout'));

      await expect(service.refundIfPaid('booking-1')).resolves.toEqual({ refunded: false });

      const calls = prisma.payment.updateMany.mock.calls as [{ data: { status?: string } }][];
      expect(calls.every(([call]) => call.data.status !== 'REFUNDED')).toBe(true);
    });

    it('retry sobre um Payment já REFUNDING: não reivindica de novo (CAS só roda a partir de PAID), reusa a MESMA idempotency key', async () => {
      const refunding = paymentRow({ status: 'REFUNDING', providerPaymentId: 'mp-123' });
      tx.payment.findFirst.mockResolvedValue(refunding);
      tx.payment.findUniqueOrThrow.mockResolvedValue(refunding);
      paymentProvider.refundPayment.mockResolvedValue({ refundId: 'refund-1', status: 'REFUNDED' });

      await service.refundIfPaid('booking-1');

      expect(tx.payment.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'payment-1', status: 'PAID' } }),
      );
      expect(paymentProvider.refundPayment).toHaveBeenCalledWith('mp-123', 'refund:payment-1');
    });
  });
});
