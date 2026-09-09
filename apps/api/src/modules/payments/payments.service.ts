import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Booking, Payment, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import {
  PaymentProvider,
  PaymentProviderError,
  ProviderPaymentStatus,
} from './providers/payment-provider';

// Estados de Payment que ainda podem representar "dinheiro que precisa
// voltar" (Fase 27) — PAID nunca teve refund tentado; REFUNDING é uma
// tentativa anterior que não chegou a REFUNDED (pode ter sido só
// "in_process" no Mercado Pago, ou pode ter falhado antes de sequer
// completar a chamada). Os dois são elegíveis pra (re)tentar o refund —
// a segurança contra duplicidade vem da X-Idempotency-Key ESTÁVEL enviada
// ao provider (item 8/9 do prompt), não de um lock local que só permite
// uma tentativa.
const REFUNDABLE_STATUSES: PaymentStatus[] = [PaymentStatus.PAID, PaymentStatus.REFUNDING];

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
  // Fase 27 — nunca `refundId` (mesmo espírito de `providerPaymentId`: ID
  // interno do gateway, sem utilidade pro cliente).
  refundedAt: Date | null;
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
    refundedAt: payment.refundedAt,
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

    // Fase de melhorias no fluxo de reserva — arena configurada para
    // pagamento presencial nunca inicia cobrança online: `paymentMode`
    // vem sempre de `Arena` no banco (via `findMyBookingDetail` acima),
    // nunca de qualquer valor enviado pelo cliente (item de segurança
    // explícito do prompt: "não confiar em valores enviados pelo
    // frontend para autorizar pagamento presencial" — aqui é o inverso,
    // mas o princípio é o mesmo: só o banco decide).
    if (booking.court.arena.paymentMode === 'IN_PERSON') {
      throw new ConflictException(
        'Esta arena usa pagamento presencial — não é possível criar um pagamento online para esta reserva.',
      );
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
    const reconciled = await this.resolveRefund(resolved);
    return toView(reconciled);
  }

  /** Usado só pelo webhook (nunca pelo frontend/IA) para localizar o Payment local a partir do ID do provider. */
  async findByProviderPaymentId(providerPaymentId: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { providerPaymentId } });
  }

  /**
   * Resumo leve (só `bookingId` + `status`) da tentativa de pagamento MAIS
   * RECENTE de cada Booking do usuário — pensado pra "Minhas reservas"
   * (Fase 26, item 14 do prompt: a lista precisa mostrar status do
   * pagamento, não só da reserva) mostrar isso sem N+1 (uma consulta por
   * reserva). `distinct: ['bookingId']` + `orderBy: createdAt desc` é o
   * padrão suportado pelo Prisma pra "a linha mais recente de cada grupo"
   * numa única query.
   *
   * Nunca escreve no banco (diferente de `resolveExpiry`, usado na tela de
   * detalhes) — um `PENDING` cujo prazo já passou é reportado como
   * `EXPIRED` só nesta resposta, pra exibição; a escrita real (lazy expiry)
   * continua acontecendo só quando o cliente abre os detalhes da reserva,
   * evitando N escritas concorrentes toda vez que a lista é carregada.
   */
  async getLatestPaymentStatusesForUser(userId: string): Promise<Record<string, PaymentStatus>> {
    const payments = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      distinct: ['bookingId'],
      select: { bookingId: true, status: true, expiresAt: true },
    });

    const now = Date.now();
    const result: Record<string, PaymentStatus> = {};
    for (const payment of payments) {
      const displayStatus =
        payment.status === PaymentStatus.PENDING &&
        payment.expiresAt &&
        payment.expiresAt.getTime() <= now
          ? PaymentStatus.EXPIRED
          : payment.status;
      result[payment.bookingId] = displayStatus;
    }
    return result;
  }

  /**
   * Aplica o status AUTORITATIVO já buscado do provider (nunca o que veio
   * no corpo do webhook) — CAS condicionado a `status: PENDING` (item 9 do
   * prompt): PENDING é o ÚNICO estado não-terminal desta máquina de
   * estados. Qualquer Payment que já não esteja PENDING ignora o evento
   * silenciosamente (logado) — PAID nunca volta a FAILED, EXPIRED nunca
   * vira PAID, não importa a ordem de chegada dos eventos.
   *
   * M7, item 8 (idempotência de notificações): o retorno passou a incluir
   * `transitioned` — true SÓ quando ESTE CAS é quem realmente moveu
   * PENDING -> outro status agora (nunca quando o Payment já estava
   * terminal, nunca quando outra transação venceu a corrida). Junto com
   * `booking` (só presente quando o novo status é PAID), isso é o
   * suficiente para `PaymentsWebhookService` disparar a notificação de
   * pagamento confirmado sem nenhum mecanismo novo de deduplicação —
   * reaproveita o MESMO CAS que já protegia a máquina de estados.
   */
  async applyProviderStatus(
    paymentId: string,
    providerStatus: ProviderPaymentStatus,
    meta: { paidAt?: Date; failureReason?: string },
  ): Promise<{ transitioned: boolean; status: PaymentStatus | null; booking?: Booking }> {
    if (providerStatus === 'PENDING') {
      return { transitioned: false, status: null }; // nada muda; PENDING->PENDING não é uma transição.
    }

    let attemptedStatus: PaymentStatus | null = null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({ where: { id: paymentId } });
        if (!payment) {
          this.logger.warn(`Evento de pagamento para Payment ${paymentId} inexistente — ignorado.`);
          return { transitioned: false, status: null };
        }
        if (payment.status !== PaymentStatus.PENDING) {
          this.logger.log(
            `Payment ${paymentId} já está em estado terminal (${payment.status}) — evento ${providerStatus} ignorado.`,
          );
          return { transitioned: false, status: payment.status };
        }

        let nextStatus: PaymentStatus = providerStatus;
        let failureReason = meta.failureReason ?? null;
        let booking: Booking | null = null;

        // Item 12 do prompt: "se a Booking for cancelada antes do
        // pagamento, o pagamento não pode ser concluído" — checado DENTRO
        // da mesma transação que aplica a transição, nunca antes (evita
        // corrida entre checar e escrever).
        if (providerStatus === 'PAID') {
          booking = await tx.booking.findUnique({ where: { id: payment.bookingId } });
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
          return { transitioned: false, status: nextStatus };
        }
        return {
          transitioned: true,
          status: nextStatus,
          booking: nextStatus === PaymentStatus.PAID && booking ? booking : undefined,
        };
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
        return { transitioned: true, status: PaymentStatus.FAILED };
      }
      throw error;
    }
  }

  /**
   * Reembolsa integralmente o Payment mais recente de uma Booking, se houver
   * um pra reembolsar (Fase 27, Regra 2/5/6/7) — chamado pelo cancelamento
   * de Booking (`BookingsController`), nunca por um endpoint próprio: o
   * MESMO endpoint de cancelar é o único ponto de entrada, e chamar de novo
   * (retry após timeout, duplo clique, duas abas) é sempre seguro porque
   * este método é idempotente de ponta a ponta.
   *
   * Nunca lança: uma falha aqui não pode transformar um cancelamento de
   * Booking já bem-sucedido numa resposta de erro pro cliente — quem chama
   * decide o que fazer com uma falha de refund (ela fica logada e elegível
   * pra nova tentativa, nunca perdida).
   *
   * W2 — devolve `{ refunded: boolean }` (antes era `void`): `refunded:
   * true` só quando ESTA chamada, especificamente, é quem confirma
   * `REFUNDED` (nunca um "solicitado"/"em processamento" — ver
   * `docs`/relatório da fase). É o sinal que `BookingsController` usa pra
   * decidir se dispara a notificação proativa de reembolso — nenhuma lógica
   * de reembolso duplicada lá, só reage a este resultado.
   */
  async refundIfPaid(bookingId: string): Promise<{ refunded: boolean }> {
    // A chamada HTTP ao provider NUNCA pode ficar dentro da transação
    // (item 24 do prompt) — a transação aqui só reivindica localmente
    // (CAS PAID->REFUNDING) sob o mesmo advisory lock já usado por
    // `createPayment`, serializando tentativas concorrentes pra MESMA
    // Booking (duplo clique, duas abas, retry).
    const claimed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bookingId}))`;

      const latest = await tx.payment.findFirst({
        where: { bookingId },
        orderBy: { createdAt: 'desc' },
      });
      if (!latest || !REFUNDABLE_STATUSES.includes(latest.status)) {
        // Nunca pago (Regra 1), ou pagamento nunca chegou a ser confirmado
        // (FAILED/CANCELLED/EXPIRED — Regra 7), ou já REFUNDED — nada a fazer.
        return null;
      }

      if (latest.status === PaymentStatus.PAID) {
        // Reivindica a tentativa — só quem vence este CAS chama o provider
        // "pela primeira vez"; uma segunda chamada concorrente encontra
        // REFUNDING (não PAID) e cai direto no retry abaixo usando a MESMA
        // idempotency key, nunca reivindicando de novo.
        await tx.payment.updateMany({
          where: { id: latest.id, status: PaymentStatus.PAID },
          data: { status: PaymentStatus.REFUNDING },
        });
      }

      return tx.payment.findUniqueOrThrow({ where: { id: latest.id } });
    });

    if (!claimed) {
      return { refunded: false };
    }
    if (!claimed.providerPaymentId) {
      // Estruturalmente não deveria acontecer (só chega a PAID depois de ter
      // um providerPaymentId) — defesa em profundidade, nunca uma exceção
      // que derrubaria o cancelamento da Booking.
      this.logger.error(
        `Payment ${claimed.id}: PAID/REFUNDING sem providerPaymentId — refund abortado.`,
      );
      return { refunded: false };
    }

    // Estável por Payment (nunca por tentativa) — é o que permite chamar
    // este método de novo (retry, duas abas, timeout) sem nunca gerar um
    // segundo refund real no Mercado Pago, mesmo que o CAS acima já tenha
    // reivindicado ou não (item 8/9 do prompt).
    const idempotencyKey = `refund:${claimed.id}`;
    const startedAt = Date.now();
    try {
      const result = await this.paymentProvider.refundPayment(
        claimed.providerPaymentId,
        idempotencyKey,
      );

      if (result.status === 'REFUNDED') {
        // W2 — CAS de verdade (checa `count`, não só dispara o update):
        // o advisory lock acima já foi LIBERADO neste ponto (a chamada ao
        // provider é sempre fora da transação — item 24 do prompt), então
        // duas chamadas concorrentes a este método (ex: duplo clique bem
        // rápido) podem ambas chegar até aqui e ambas receber `REFUNDED` do
        // provider (mesma idempotencyKey estável). Sem checar `count`, as
        // duas se considerariam "quem confirmou agora" e disparariam duas
        // notificações de reembolso — a mesma classe de corrida que
        // `applyProviderStatus` já resolve (linha ~364 acima) checando
        // `result.count === 0`.
        const updated = await this.prisma.payment.updateMany({
          where: { id: claimed.id, status: { in: [PaymentStatus.PAID, PaymentStatus.REFUNDING] } },
          data: {
            status: PaymentStatus.REFUNDED,
            refundId: result.refundId,
            refundedAt: new Date(),
          },
        });
        this.logger.log(`Payment ${claimed.id}: refund confirmado em ${Date.now() - startedAt}ms.`);
        return { refunded: updated.count > 0 };
      } else if (result.status === 'REFUNDING') {
        await this.prisma.payment.updateMany({
          where: { id: claimed.id, status: { in: [PaymentStatus.PAID, PaymentStatus.REFUNDING] } },
          data: { status: PaymentStatus.REFUNDING, refundId: result.refundId },
        });
        this.logger.log(
          `Payment ${claimed.id}: refund solicitado (in_process), aguardando confirmação.`,
        );
      } else {
        // Mercado Pago respondeu com sucesso HTTP mas recusou o refund em si
        // (ex: status "rejected"/"cancelled" na resposta) — reverte a
        // reivindicação otimista pra permitir nova tentativa depois; nunca
        // fica preso em REFUNDING sem progresso real confirmado.
        this.logger.error(
          `Payment ${claimed.id}: Mercado Pago recusou o refund (refundId=${result.refundId}).`,
        );
        await this.prisma.payment.updateMany({
          where: { id: claimed.id, status: PaymentStatus.REFUNDING },
          data: { status: PaymentStatus.PAID },
        });
      }
    } catch (error) {
      // Timeout, rede fora, resposta inesperada: estado local fica como
      // está (REFUNDING, já reivindicado) — nunca marcado REFUNDED sem
      // confirmação real, e continua elegível pra nova tentativa (mesma
      // idempotency key) na próxima chamada a este método.
      this.logger.error(
        `Falha ao solicitar refund do Payment ${claimed.id}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
    return { refunded: false };
  }

  /**
   * Reconcilia um refund `REFUNDING` (PIX assíncrono, sem webhook
   * documentado) ao ler o Payment — mesmo padrão "lazy" de `resolveExpiry`,
   * nunca um job/cron. Só é chamado a partir de leitura (nunca do
   * cancelamento em si), então uma falha aqui nunca pode quebrar a
   * consulta: devolve o estado local e tenta de novo na próxima leitura.
   */
  private async resolveRefund(payment: Payment): Promise<Payment> {
    if (
      payment.status !== PaymentStatus.REFUNDING ||
      !payment.refundId ||
      !payment.providerPaymentId
    ) {
      return payment;
    }

    try {
      const status = await this.paymentProvider.getRefundStatus(
        payment.providerPaymentId,
        payment.refundId,
      );
      if (status !== 'REFUNDED') {
        // Ainda em processamento, ou o provider reportou falha nesta
        // consulta — nunca revertido aqui (evita mudar o estado numa
        // leitura); só `refundIfPaid` reverte pra PAID, numa nova tentativa
        // explícita.
        return payment;
      }
      const result = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.REFUNDING },
        data: { status: PaymentStatus.REFUNDED, refundedAt: new Date() },
      });
      if (result.count === 1) {
        return { ...payment, status: PaymentStatus.REFUNDED, refundedAt: new Date() };
      }
      // count===0: outra requisição já resolveu entre a leitura e esta
      // atualização — relê o estado real.
      return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    } catch {
      return payment;
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
