import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { PaymentProvider } from './providers/payment-provider';

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
    const matches = provided.length === expected.length && timingSafeEqual(provided, expected);

    // DIAGNÓSTICO TEMPORÁRIO (Fase 24) — remover depois de confirmar a causa
    // raiz do 403 na Orders API. Nunca loga o secret; só manifestos e hex
    // (dados já públicos no próprio request do provider).
    if (!matches) {
      const manifestRaw = `id:${providerPaymentId};request-id:${requestId};ts:${ts};`;
      const expectedHexRaw = createHmac('sha256', secret).update(manifestRaw).digest('hex');
      this.logger.warn(
        `[DIAG] assinatura não bateu. providerPaymentId=${providerPaymentId} manifest(lower)=${manifest} v1_recebido=${v1} hex_esperado(lower)=${expectedHex} hex_esperado(raw)=${expectedHexRaw} bateria_com_raw=${expectedHexRaw === v1}`,
      );
    }
    return matches;
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
      const result = await this.paymentProvider.getPaymentStatus(notification.providerPaymentId);
      await this.paymentsService.applyProviderStatus(payment.id, result.status, {
        paidAt: result.paidAt,
        failureReason: result.failureReason,
      });
      await this.markEvent(notification.providerEventId, `processed: ${result.status}`);
    } catch (error) {
      this.logger.error(
        `Falha ao processar webhook de pagamento ${payment.id}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
      await this.markEvent(notification.providerEventId, 'error');
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
