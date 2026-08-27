import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import {
  PaymentProvider,
  PaymentProviderError,
  ProviderPaymentStatus,
} from './providers/payment-provider';

// PIX expira em 30 minutos — prazo curto e típico do método (diferente de
// boleto/cartão), avaliado em tempo de leitura (mesmo padrão de
// `ArenaInvitation.expiresAt`, Fase 11 — nunca um job/cron marcando
// expiração).
const PAYMENT_TTL_MINUTES = 30;

// View segura devolvida ao cliente — nunca `providerPaymentId` (ID interno
// do gateway, sem utilidade pro cliente e superfície de enumeração
// desnecessária), nunca `idempotencyKey` (item 17 do prompt: "não exponha
// IDs internos desnecessários ao cliente").
export interface PaymentView {
  id: string;
  bookingId: string;
  status: PaymentStatus;
  amount: Prisma.Decimal;
  currency: string;
  checkoutUrl: string | null;
  pixCopyPaste: string | null;
  qrCodeBase64: string | null;
  failureReason: string | null;
  paidAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

function toView(payment: Payment): PaymentView {
  return {
    id: payment.id,
    bookingId: payment.bookingId,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    checkoutUrl: payment.checkoutUrl,
    pixCopyPaste: payment.pixCopyPaste,
    qrCodeBase64: payment.qrCodeBase64,
    failureReason: payment.failureReason,
    paidAt: payment.paidAt,
    expiresAt: payment.expiresAt,
    createdAt: payment.createdAt,
  };
}

/**
 * Orquestra o ciclo financeiro de uma Booking CUSTOMER (Fase 17) —
 * deliberadamente separado do ciclo operacional (`BookingsService`,
 * intocado nesta fase). O valor SEMPRE vem da própria Booking (`total`,
 * congelado desde a Fase 4) — nunca de qualquer campo enviado pelo cliente
 * (item 4 do prompt). `arenaId`/`userId`/`courtId` também vêm sempre do
 * registro carregado do banco, nunca de parâmetro de rota isolado ou de
 * texto/IA (mesmo princípio "never trust the model" da Fase 16, estendido
 * aqui a "never trust the request body").
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingsService: BookingsService,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  /**
   * Inicia (ou retoma) uma tentativa de pagamento para a Booking. Idempotente
   * por `(bookingId, idempotencyKey)` — mesma chave sempre devolve o mesmo
   * Payment, nunca cria uma segunda cobrança no provider (item 10 do
   * prompt). Concorrência: `pg_advisory_xact_lock(hashtext(bookingId))`
   * serializa tentativas concorrentes pra MESMA Booking (mesmo padrão já
   * usado por `BookingsService.createBooking` pra `courtId`, Fase 4) — só
   * quem de fato CRIA uma linha nova chega a chamar o provider; quem
   * encontra uma tentativa já ativa (ou já resolvida) nunca chama de novo.
   */
  async createPayment(
    userId: string,
    bookingId: string,
    idempotencyKey: string,
  ): Promise<PaymentView> {
    // Reaproveita a MESMA checagem de "a Booking existe, é CUSTOMER, e
    // pertence a este usuário" já usada por "minhas reservas" (Fase 6) —
    // 404 (nunca 403) se não bater qualquer um desses três critérios, mesmo
    // padrão anti-enumeração do resto do produto. BLOCK/MAINTENANCE NUNCA
    // aparecem aqui porque `findMyBookingDetail` já filtra `type: CUSTOMER`
    // — estruturalmente impossível gerar Payment pra eles (item 6.2).
    const booking = await this.bookingsService.findMyBookingDetail(userId, bookingId);

    if (booking.status === 'CANCELLED') {
      throw new ConflictException('Esta reserva foi cancelada e não pode gerar um novo pagamento.');
    }

    const arenaId = booking.court.arena.id;
    const courtId = booking.court.id;
    const amount = booking.total;

    const { payment, isNew } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bookingId}))`;

      const existingByKey = await tx.payment.findUnique({
        where: { bookingId_idempotencyKey: { bookingId, idempotencyKey } },
      });
      if (existingByKey) {
        return { payment: existingByKey, isNew: false };
      }

      const active = await tx.payment.findFirst({
        where: { bookingId, status: { in: [PaymentStatus.PAID, PaymentStatus.PENDING] } },
        orderBy: { createdAt: 'desc' },
      });
      if (active) {
        if (active.status === PaymentStatus.PAID) {
          throw new ConflictException('Esta reserva já está paga.');
        }
        // PENDING: se ainda não expirou, é a mesma tentativa em andamento —
        // devolve ela (nunca abre uma segunda cobrança em paralelo).
        if (active.expiresAt && active.expiresAt.getTime() > Date.now()) {
          return { payment: active, isNew: false };
        }
        // PENDING expirado: fecha essa tentativa (lazy expiry, mesmo padrão
        // de ArenaInvitation) antes de abrir uma nova.
        await tx.payment.updateMany({
          where: { id: active.id, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.EXPIRED },
        });
      }

      const created = await tx.payment.create({
        data: {
          bookingId,
          userId,
          arenaId,
          amount,
          currency: 'BRL',
          status: PaymentStatus.PENDING,
          provider: 'MERCADO_PAGO',
          idempotencyKey,
          expiresAt: new Date(Date.now() + PAYMENT_TTL_MINUTES * 60_000),
        },
      });
      return { payment: created, isNew: true };
    });

    if (!isNew) {
      // Replay de Idempotency-Key, tentativa ativa já em andamento, ou
      // pagamento já concluído — nunca chama o provider de novo (item 10:
      // "duas requisições simultâneas... nunca criar duas cobranças reais").
      return toView(payment);
    }

    // Fora da transação — chamada externa nunca trava o Postgres (item 24
    // do prompt: "não finja que uma transação Prisma pode tornar uma
    // chamada HTTP externa atomicamente transacional").
    const startedAt = Date.now();
    try {
      // O Mercado Pago exige payer.email pra criar um pagamento PIX
      // (achado real, Fase 23 — "payer_cannot_be_nil"). userId já foi
      // validado por findMyBookingDetail acima, então este User sempre
      // existe.
      const { email } = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true },
      });
      const result = await this.paymentProvider.createPayment({
        paymentId: payment.id,
        amount: Number(amount),
        currency: 'BRL',
        description: `Reserva ${courtId}`,
        payerEmail: email,
      });
      this.logger.log(
        `Pagamento ${payment.id} criado no provider em ${Date.now() - startedAt}ms (arena=${arenaId}).`,
      );
      const updated = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId: result.providerPaymentId,
          checkoutUrl: result.checkoutUrl,
          pixCopyPaste: result.pixCopyPaste,
          qrCodeBase64: result.qrCodeBase64,
        },
      });
      return toView(updated);
    } catch (error) {
      this.logger.error(
        `Falha ao criar pagamento ${payment.id} no provider: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
      const failed = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED, failureReason: 'PROVIDER_ERROR' },
      });
      void failed;
      const current = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (error instanceof PaymentProviderError) {
        return toView(current);
      }
      throw error;
    }
  }

  /** Consulta o estado financeiro atual da Booking — `null` se nunca houve nenhuma tentativa. */
  async getPaymentForBooking(userId: string, bookingId: string): Promise<PaymentView | null> {
    // Mesma checagem de ownership/tipo/existência da criação — 404 se a
    // Booking não existir, não for do usuário, ou não for CUSTOMER.
    await this.bookingsService.findMyBookingDetail(userId, bookingId);

    const payment = await this.prisma.payment.findFirst({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) {
      return null;
    }

    const resolved = await this.resolveExpiry(payment);
    return toView(resolved);
  }

  /** Usado só pelo webhook (nunca pelo frontend/IA) para localizar o Payment local a partir do ID do provider. */
  async findByProviderPaymentId(providerPaymentId: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { providerPaymentId } });
  }

  /**
   * Aplica o status AUTORITATIVO já buscado do provider (nunca o que veio
   * no corpo do webhook) — CAS condicionado a `status: PENDING` (item 9 do
   * prompt): PENDING é o ÚNICO estado não-terminal desta máquina de
   * estados. Qualquer Payment que já não esteja PENDING ignora o evento
   * silenciosamente (logado) — PAID nunca volta a FAILED, EXPIRED nunca
   * vira PAID, não importa a ordem de chegada dos eventos.
   */
  async applyProviderStatus(
    paymentId: string,
    providerStatus: ProviderPaymentStatus,
    meta: { paidAt?: Date; failureReason?: string },
  ): Promise<void> {
    if (providerStatus === 'PENDING') {
      return; // nada muda; PENDING->PENDING não é uma transição.
    }

    let attemptedStatus: PaymentStatus | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({ where: { id: paymentId } });
        if (!payment) {
          this.logger.warn(`Evento de pagamento para Payment ${paymentId} inexistente — ignorado.`);
          return;
        }
        if (payment.status !== PaymentStatus.PENDING) {
          this.logger.log(
            `Payment ${paymentId} já está em estado terminal (${payment.status}) — evento ${providerStatus} ignorado.`,
          );
          return;
        }

        let nextStatus: PaymentStatus = providerStatus;
        let failureReason = meta.failureReason ?? null;

        // Item 12 do prompt: "se a Booking for cancelada antes do
        // pagamento, o pagamento não pode ser concluído" — checado DENTRO
        // da mesma transação que aplica a transição, nunca antes (evita
        // corrida entre checar e escrever).
        if (providerStatus === 'PAID') {
          const booking = await tx.booking.findUnique({ where: { id: payment.bookingId } });
          if (!booking || booking.status === 'CANCELLED') {
            nextStatus = PaymentStatus.CANCELLED;
            failureReason = 'BOOKING_CANCELLED_BEFORE_PAYMENT';
          }
        }
        attemptedStatus = nextStatus;

        const result = await tx.payment.updateMany({
          where: { id: paymentId, status: PaymentStatus.PENDING },
          data: {
            status: nextStatus,
            paidAt: nextStatus === PaymentStatus.PAID ? (meta.paidAt ?? new Date()) : null,
            failureReason: nextStatus === PaymentStatus.PAID ? null : failureReason,
          },
        });
        if (result.count === 0) {
          // Outra transação venceu a corrida entre o findUnique acima e
          // este updateMany (ex: dois webhooks concorrentes) — o resultado
          // já é o que a vencedora gravou, nunca um erro.
          this.logger.log(
            `Payment ${paymentId}: corrida perdida ao aplicar ${nextStatus}, ignorado.`,
          );
        }
      });
    } catch (error) {
      // Índice único parcial "no máximo um PAID por bookingId" — só pode
      // disparar em teoria se dois Payment DIFERENTES da mesma Booking
      // tentassem ficar PAID ao mesmo tempo (não deveria acontecer dado o
      // lock de criação em `createPayment`, mas é defesa em profundidade,
      // nunca confiada como caminho principal). A recuperação roda FORA da
      // transação que falhou — o Postgres aborta toda a transação corrente
      // após uma violação de constraint; tentar mais uma escrita dentro
      // dela só produziria "current transaction is aborted" (item 24:
      // nenhum SAVEPOINT foi adicionado só pra este caso raro).
      if (this.isUniqueViolation(error) && attemptedStatus === PaymentStatus.PAID) {
        this.logger.error(
          `Payment ${paymentId}: outra tentativa da mesma Booking já está PAID — marcado FAILED.`,
        );
        await this.prisma.payment.updateMany({
          where: { id: paymentId, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.FAILED, failureReason: 'DUPLICATE_PAYMENT_FOR_BOOKING' },
        });
        return;
      }
      throw error;
    }
  }

  private async resolveExpiry(payment: Payment): Promise<Payment> {
    if (
      payment.status === PaymentStatus.PENDING &&
      payment.expiresAt &&
      payment.expiresAt.getTime() <= Date.now()
    ) {
      const result = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.EXPIRED },
      });
      if (result.count === 1) {
        return { ...payment, status: PaymentStatus.EXPIRED };
      }
      // count===0: outra requisição já resolveu (ex: webhook PAID chegou
      // entre a leitura e esta atualização) — relê o estado real.
      return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    }
    return payment;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
