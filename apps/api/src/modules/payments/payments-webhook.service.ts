import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Booking, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestContext } from '../../common/request-context';
import { PaymentsService } from './payments.service';
import { PaymentProvider } from './providers/payment-provider';
import { PushNotificationsService } from '../notifications/push-notifications.service';
import { WhatsAppNotificationsService } from '../notifications/whatsapp-notifications.service';

export interface ParsedPaymentNotification {
  providerEventId: string;
  /** ID do pagamento NO PROVIDER — nunca confiado sozinho: só usado pra buscar o status real de volta (getPaymentStatus). */
  providerPaymentId: string;
}

/**
 * Camada de borda do webhook de pagamento (Fase 17): verifica a assinatura,
 * deduplica eventos, localiza o `Payment` local pelo `providerPaymentId` e
 * delega a transição de estado pra `PaymentsService.applyProviderStatus` —
 * que SEMPRE busca o status atual direto no provider antes de aplicar
 * qualquer coisa (nunca confia no `status` que o corpo do webhook alega).
 * Mesma separação borda/domínio já usada em `WhatsAppService`/
 * `ConversationService` (Fase 16).
 */
@Injectable()
export class PaymentsWebhookService {
  private readonly logger = new Logger(PaymentsWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly paymentProvider: PaymentProvider,
    // M7 — só esta camada de borda conhece PushNotificationsService;
    // PaymentsService continua sem nenhuma dependência de notificações.
    private readonly pushNotificationsService: PushNotificationsService,
    // W2 — mesmo padrão, canal WhatsApp.
    private readonly whatsappNotificationsService: WhatsAppNotificationsService,
  ) {}

  // Parsing defensivo do formato de notificação do Mercado Pago — nunca
  // assume a forma exata sem checar (mesmo princípio do parsing do webhook
  // do WhatsApp, Fase 16). O formato real é
  // `{ id, type: "payment", action: "payment.updated", data: { id: "..." } }`.
  parseNotification(payload: unknown): ParsedPaymentNotification | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const record = payload as Record<string, unknown>;

    const data = record.data;
    const dataId =
      typeof data === 'object' && data !== null ? (data as Record<string, unknown>).id : undefined;
    const providerPaymentId = this.toIdString(dataId);
    if (!providerPaymentId) return null;

    const notificationId = this.toIdString(record.id);
    const type = this.toIdString(record.type) ?? 'payment';
    const providerEventId = notificationId ?? `${type}:${providerPaymentId}`;

    return { providerEventId, providerPaymentId };
  }

  // A Meta Cloud API e o Mercado Pago entregam IDs numéricos ou strings
  // dependendo do campo — nunca `String(unknown)` direto (poderia
  // stringificar um objeto aninhado como "[object Object]" sem erro).
  private toIdString(value: unknown): string | null {
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
    return null;
  }

  /**
   * `X-Signature: ts=<epoch>,v1=<hmac hex>` + `X-Request-Id` — esquema real
   * documentado pelo Mercado Pago (manifesto `id:{data.id};request-id:
   * {x-request-id};ts:{ts};`, HMAC-SHA256 com `PAYMENT_WEBHOOK_SECRET`).
   * NUNCA validado contra um webhook real da Meta neste ambiente — ver
   * relatório da Fase 17. `timingSafeEqual`, mesma disciplina de
   * Clerk/WhatsApp.
   */
  verifySignature(
    providerPaymentId: string,
    requestId: string | undefined,
    signatureHeader: string | undefined,
  ): boolean {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret || !signatureHeader || !requestId) {
      return false;
    }

    const parts: Record<string, string> = {};
    for (const piece of signatureHeader.split(',')) {
      const [key, value] = piece.trim().split('=');
      if (key && value) parts[key] = value;
    }
    const ts = parts.ts;
    const v1 = parts.v1;
    if (!ts || !v1) {
      return false;
    }

    const manifest = `id:${providerPaymentId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    const expectedHex = createHmac('sha256', secret).update(manifest).digest('hex');
    const provided = Buffer.from(v1, 'hex');
    const expected = Buffer.from(expectedHex, 'hex');
    if (provided.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(provided, expected);
  }

  /**
   * Processa a notificação já com assinatura verificada. Nunca lança pro
   * controller — um evento mal formado ou de um pagamento desconhecido é
   * ignorado (logado, marcado no `PaymentWebhookEvent`), não um erro 500
   * (o provider reenviaria indefinidamente algo que sempre falha do mesmo
   * jeito — mesma disciplina do webhook do WhatsApp).
   */
  async handleEvent(notification: ParsedPaymentNotification): Promise<void> {
    const claimed = await this.claimEvent(notification.providerEventId);
    if (!claimed) {
      this.logger.log(
        `Evento ${notification.providerEventId} já processado — ignorado (idempotência).`,
      );
      return;
    }

    const payment = await this.paymentsService.findByProviderPaymentId(
      notification.providerPaymentId,
    );
    if (!payment) {
      this.logger.warn(
        `Webhook para providerPaymentId=${notification.providerPaymentId} sem Payment local correspondente — ignorado.`,
      );
      await this.markEvent(notification.providerEventId, 'ignored: payment not found locally');
      return;
    }

    try {
      // Nunca confia no `status` do corpo do webhook — busca o status
      // AUTORITATIVO direto no provider pelo ID (item 8.10/33 do prompt).
      const providerResult = await this.paymentProvider.getPaymentStatus(
        notification.providerPaymentId,
      );
      const applyResult = await this.paymentsService.applyProviderStatus(
        payment.id,
        providerResult.status,
        { paidAt: providerResult.paidAt, failureReason: providerResult.failureReason },
      );

      // M7 — só notifica quando ESTE evento é quem realmente transicionou
      // pra PAID agora (applyResult.transitioned), nunca num webhook
      // duplicado/reprocessado que encontra o Payment já PAID (isso já é
      // coberto por `claimEvent` acima, mas `transitioned` é a proteção
      // definitiva contra qualquer outra via de duplicação — ex: um resync
      // administrativo futuro chamando applyProviderStatus diretamente).
      // Nunca deixa uma falha de notificação virar erro no processamento
      // do webhook (o webhook já está confirmado nesse ponto).
      if (applyResult.transitioned && applyResult.status === 'PAID' && applyResult.booking) {
        try {
          await this.pushNotificationsService.notifyPaymentConfirmed(applyResult.booking);
        } catch (error) {
          this.logger.error(
            `Falha ao notificar pagamento confirmado da Booking ${applyResult.booking.id}: ${
              error instanceof Error ? error.message : 'erro desconhecido'
            }`,
          );
        }
        // W2 — mesmo guard exato do push acima (applyResult.transitioned):
        // dispara pra reservas de QUALQUER canal de origem (web, app,
        // WhatsApp) — mesmo uma reserva criada pelo WhatsApp nunca recebeu
        // esta informação especificamente (a resposta direta do bot na
        // criação só fala do PIX pendente, nunca da aprovação em si, que
        // sempre chega depois via este webhook), então isto nunca duplica
        // a resposta conversacional.
        try {
          await this.whatsappNotificationsService.notifyPaymentConfirmed(applyResult.booking);
        } catch (error) {
          this.logger.error(
            `Falha ao notificar pagamento confirmado via WhatsApp da Booking ${applyResult.booking.id}: ${
              error instanceof Error ? error.message : 'erro desconhecido'
            }`,
          );
        }
      }

      // Aprovação tardia sobre uma Booking JÁ cancelada: o provider recebeu
      // dinheiro real e o Payment ficou PAID (ver `applyProviderStatus`).
      // Aciona o MESMO refund idempotente de qualquer cancelamento de
      // reserva paga (`refundIfPaid`: advisory lock + CAS + idempotency key
      // estável no provider) — nunca dentro da transação do Payment, e nunca
      // uma notificação de "pagamento confirmado" (a reserva não existe mais).
      if (applyResult.transitioned && applyResult.refundRequired) {
        await this.refundLateApproval(
          payment.id,
          notification.providerPaymentId,
          applyResult.refundRequired,
        );
      }

      await this.markEvent(notification.providerEventId, `processed: ${providerResult.status}`);
    } catch (error) {
      this.logger.error(
        `Falha ao processar webhook de pagamento ${payment.id}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
      await this.markEvent(notification.providerEventId, 'error');
    }
  }

  /**
   * Reembolso automático de um pagamento aprovado tardiamente para uma
   * Booking já cancelada. Nunca lança (o webhook já está confirmado) e nunca
   * deixa o dinheiro "esquecido": o Payment permanece PAID/REFUNDING (visível
   * em `getPaymentForBooking`) e cada desfecho é logado com paymentId,
   * bookingId e requestId. Falha = estado recuperável — `refundIfPaid` é
   * idempotente (mesma idempotency key `refund:${paymentId}` no provider),
   * então repetir o cancelamento da Booking (POST .../cancel, idempotente)
   * refaz a tentativa sem risco de segundo reembolso.
   */
  private async refundLateApproval(
    paymentId: string,
    providerPaymentId: string,
    required: { bookingId: string; booking: Booking | null },
  ): Promise<void> {
    const context = `payment=${paymentId} booking=${required.bookingId} requestId=${
      RequestContext.getRequestId() ?? 'n/a'
    }`;
    let refunded = false;
    try {
      refunded = (await this.paymentsService.refundIfPaid(required.bookingId)).refunded;
    } catch (error) {
      this.logger.error(
        `[late-approval][ACAO-OPERACIONAL] ${context}: falha inesperada ao solicitar o reembolso automático: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }

    const current = await this.paymentsService.findByProviderPaymentId(providerPaymentId);
    if (current?.status === 'REFUNDED') {
      this.logger.warn(`[late-approval] ${context}: reembolso automático confirmado.`);
    } else if (current?.status === 'REFUNDING' && current.refundId) {
      // Só um REFUNDING COM `refundId` significa "o provider aceitou o pedido
      // e ainda está processando" (reconciliado lazily na próxima leitura).
      this.logger.warn(
        `[late-approval] ${context}: reembolso automático solicitado, aguardando confirmação do provider (reconciliado na próxima leitura do Payment).`,
      );
    } else {
      // PAID, ou REFUNDING SEM `refundId` (reivindicado localmente mas a
      // chamada ao provider falhou/deu timeout): nada foi confirmado. O
      // estado é recuperável e o Payment segue visível para a Booking.
      this.logger.error(
        `[late-approval][ACAO-OPERACIONAL] ${context}: reembolso automático NÃO concluído — o Payment permanece ${
          current?.status ?? 'desconhecido'
        }${current?.status === 'REFUNDING' ? ' (sem refundId: o pedido ao provider não foi confirmado)' : ''}. ` +
          `Repita o cancelamento da reserva (idempotente, mesma idempotency key no provider) ou reembolse manualmente.`,
      );
    }

    if (refunded && required.booking) {
      try {
        await this.whatsappNotificationsService.notifyRefundConfirmed(required.booking);
      } catch (error) {
        this.logger.error(
          `Falha ao notificar reembolso via WhatsApp da Booking ${required.bookingId}: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      }
    }
  }

  private async claimEvent(providerEventId: string): Promise<boolean> {
    try {
      await this.prisma.paymentWebhookEvent.create({
        data: { provider: 'MERCADO_PAGO', providerEventId },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  private async markEvent(providerEventId: string, resultSummary: string): Promise<void> {
    await this.prisma.paymentWebhookEvent.updateMany({
      where: { provider: 'MERCADO_PAGO', providerEventId },
      data: { processedAt: new Date(), resultSummary },
    });
  }
}
