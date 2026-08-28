import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentProviderCreateRequest,
  PaymentProviderCreateResult,
  PaymentProviderError,
  PaymentProviderStatusResult,
  PaymentProviderTimeoutError,
  ProviderPaymentStatus,
} from './payment-provider';

const DEFAULT_TIMEOUT_MS = 15_000;
const API_BASE_URL = 'https://api.mercadopago.com';

interface MercadoPagoPaymentResponse {
  id?: number;
  status?: string;
  status_detail?: string;
  date_approved?: string | null;
  point_of_interaction?: {
    transaction_data?: { ticket_url?: string; qr_code?: string; qr_code_base64?: string };
  };
}

// Mapeamento dos status reais da API do Mercado Pago
// (approved/pending/in_process/rejected/cancelled/refunded/charged_back)
// pro nosso enum fechado — nunca repassamos a string do provider direto
// pro domínio (item 33 da Fase 16, mesmo princípio: "never trust the
// model/provider", aplicado aqui a "never trust the gateway's raw status
// string").
function mapMercadoPagoStatus(status: string | undefined): ProviderPaymentStatus {
  switch (status) {
    case 'approved':
      return 'PAID';
    case 'pending':
    case 'in_process':
    case 'authorized':
      return 'PENDING';
    case 'rejected':
      return 'FAILED';
    case 'cancelled':
      return 'CANCELLED';
    default:
      return 'FAILED';
  }
}

/**
 * Único adapter real do PaymentProvider nesta fase (Mercado Pago, PIX — ver
 * docs/ARCHITECTURE.md, Fase 17, para a justificativa completa da escolha).
 * Usa `fetch` nativo, sem SDK novo — mesma filosofia de dependências
 * mínimas já seguida em `OpenAiAiProviderService` (Fase 12) e
 * `MetaWhatsAppProviderService` (Fase 16). Validado contra a API real de
 * sandbox na Fase 23 — ver docs/DEPLOYMENT.md.
 */
@Injectable()
export class MercadoPagoPaymentProviderService extends PaymentProvider {
  private readonly logger = new Logger(MercadoPagoPaymentProviderService.name);

  async createPayment(request: PaymentProviderCreateRequest): Promise<PaymentProviderCreateResult> {
    const apiKey = this.requireApiKey();
    const timeoutMs = this.timeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(`${API_BASE_URL}/v1/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          // Idempotência do LADO DO PROVIDER (item 10 do prompt) — retry de
          // rede pra este MESMO Payment local nunca cria uma segunda
          // cobrança no Mercado Pago, mesmo que nosso próprio claim-first
          // (Payment.idempotencyKey) já tenha, por algum motivo, deixado
          // passar uma segunda chamada.
          'X-Idempotency-Key': request.paymentId,
        },
        body: JSON.stringify({
          transaction_amount: request.amount,
          description: request.description,
          payment_method_id: 'pix',
          // Obrigatório — sem isso o Mercado Pago rejeita a criação com
          // "payer_cannot_be_nil" (achado real ao validar contra a API de
          // verdade, Fase 23). E-mail é o único dado do payer que o domínio
          // já tem disponível e precisa enviar; nenhum outro campo de payer
          // é necessário pra PIX.
          payer: { email: request.payerEmail },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.error(
          `Mercado Pago respondeu ${response.status} em ${Date.now() - startedAt}ms.`,
        );
        throw new PaymentProviderError();
      }

      const body = (await response.json()) as MercadoPagoPaymentResponse;
      if (!body.id) {
        throw new PaymentProviderError();
      }

      this.logger.log(`Pagamento criado no Mercado Pago em ${Date.now() - startedAt}ms.`);
      return {
        providerPaymentId: String(body.id),
        checkoutUrl: body.point_of_interaction?.transaction_data?.ticket_url ?? null,
        pixCopyPaste: body.point_of_interaction?.transaction_data?.qr_code ?? null,
        qrCodeBase64: body.point_of_interaction?.transaction_data?.qr_code_base64 ?? null,
      };
    } catch (error) {
      this.rethrowMapped(error, timeoutMs, startedAt);
    } finally {
      clearTimeout(timeout);
    }
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentProviderStatusResult> {
    const apiKey = this.requireApiKey();
    const timeoutMs = this.timeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(`${API_BASE_URL}/v1/payments/${providerPaymentId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.error(
          `Mercado Pago respondeu ${response.status} em ${Date.now() - startedAt}ms.`,
        );
        throw new PaymentProviderError();
      }

      const body = (await response.json()) as MercadoPagoPaymentResponse;
      this.logger.log(`Status consultado no Mercado Pago em ${Date.now() - startedAt}ms.`);
      return {
        status: mapMercadoPagoStatus(body.status),
        paidAt: body.date_approved ? new Date(body.date_approved) : undefined,
        // status_detail é um código curto do provider (ex: "cc_rejected_insufficient_amount"),
        // nunca uma mensagem livre — seguro pra armazenar/logar (item 25).
        failureReason: body.status === 'rejected' ? (body.status_detail ?? 'rejected') : undefined,
      };
    } catch (error) {
      this.rethrowMapped(error, timeoutMs, startedAt);
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireApiKey(): string {
    const apiKey = process.env.PAYMENT_API_KEY;
    if (!apiKey) {
      this.logger.warn('PAYMENT_API_KEY não configurada — gateway de pagamento indisponível.');
      throw new PaymentProviderError();
    }
    return apiKey;
  }

  private timeoutMs(): number {
    return Number(process.env.PAYMENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  }

  private rethrowMapped(error: unknown, timeoutMs: number, startedAt: number): never {
    if (error instanceof PaymentProviderError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      this.logger.error(`Mercado Pago não respondeu em ${timeoutMs}ms — timeout.`);
      throw new PaymentProviderTimeoutError();
    }
    this.logger.error(
      `Falha ao chamar Mercado Pago (${Date.now() - startedAt}ms): ${
        error instanceof Error ? error.message : 'erro desconhecido'
      }`,
    );
    throw new PaymentProviderError();
  }
}
