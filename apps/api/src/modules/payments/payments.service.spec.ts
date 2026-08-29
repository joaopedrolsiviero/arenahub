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

      await service.applyProviderStatus('payment-1', 'PAID', { paidAt: new Date('2026-01-01') });

      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PENDING' },
        data: { status: 'PAID', paidAt: new Date('2026-01-01'), failureReason: null },
      });
    });

    it('PENDING -> FAILED aplica normalmente (pagamento recusado pelo Mercado Pago, Fase 25 Caso 3)', async () => {
      prisma.$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(tx));
      tx.payment.findUnique.mockResolvedValue(paymentRow());
      tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });

      await service.applyProviderStatus('payment-1', 'FAILED', {
        failureReason: 'cc_rejected_other',
      });

      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PENDING' },
        data: { status: 'FAILED', paidAt: null, failureReason: 'cc_rejected_other' },
      });
    });

    it('PAID é terminal: um evento FAILED posterior é ignorado, nunca reverte pra FAILED', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'PAID' }));

      await service.applyProviderStatus('payment-1', 'FAILED', {});

      expect(tx.payment.updateMany).not.toHaveBeenCalled();
    });

    it('EXPIRED é terminal: um PAID que chega depois nunca reverte pra PAID', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow({ status: 'EXPIRED' }));

      await service.applyProviderStatus('payment-1', 'PAID', {});

      expect(tx.payment.updateMany).not.toHaveBeenCalled();
    });

    it('PENDING (sem mudança real) é sempre um no-op, nunca escreve', async () => {
      await service.applyProviderStatus('payment-1', 'PENDING', {});

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('Booking cancelada antes da confirmação: PAID vira CANCELLED, nunca PAID (item 12)', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow());
      tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CANCELLED' });

      await service.applyProviderStatus('payment-1', 'PAID', {});

      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          paidAt: null,
          failureReason: 'BOOKING_CANCELLED_BEFORE_PAYMENT',
        },
      });
    });

    it('corrida perdida (count 0) é logada, nunca lança', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow());
      tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });
      tx.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.applyProviderStatus('payment-1', 'PAID', {})).resolves.toBeUndefined();
    });

    it('Payment inexistente é ignorado, nunca lança', async () => {
      tx.payment.findUnique.mockResolvedValue(null);

      await expect(service.applyProviderStatus('payment-x', 'PAID', {})).resolves.toBeUndefined();
    });

    it('violação do índice único "um PAID por Booking" recupera marcando FAILED (fora da transação que falhou)', async () => {
      tx.payment.findUnique.mockResolvedValue(paymentRow());
      tx.booking.findUnique.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED' });
      tx.payment.updateMany.mockRejectedValue(uniqueViolation());

      await service.applyProviderStatus('payment-1', 'PAID', {});

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'PENDING' },
        data: { status: 'FAILED', failureReason: 'DUPLICATE_PAYMENT_FOR_BOOKING' },
      });
    });
  });

  describe('refundIfPaid (Fase 27 — cancelamento e reembolso)', () => {
    it('Regra 1: sem nenhum Payment pra Booking, é um no-op — nunca chama o provider', async () => {
      tx.payment.findFirst.mockResolvedValue(null);

      await service.refundIfPaid('booking-1');

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

      await service.refundIfPaid('booking-1');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: { in: ['PAID', 'REFUNDING'] } },
        data: { status: 'REFUNDED', refundId: 'refund-1', refundedAt: expect.any(Date) as Date },
      });
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

      await expect(service.refundIfPaid('booking-1')).resolves.toBeUndefined();

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
