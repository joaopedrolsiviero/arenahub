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

// Duration ISO-8601 (30 min) — só o prazo que o PRÓPRIO Mercado Pago usa
// pra expirar o QR Code do lado dele; não é a autoridade sobre expiração
// (essa é sempre `Payment.expiresAt`, resolvida lazily por
// `PaymentsService.resolveExpiry`). Espelha o `PAYMENT_TTL_MINUTES` de lá —
// se aquele valor mudar, ajustar aqui também.
const ORDER_EXPIRATION_TIME = 'PT30M';

interface MercadoPagoOrderPaymentMethod {
  ticket_url?: string;
  qr_code?: string;
  qr_code_base64?: string;
}

interface MercadoPagoOrderTransactionPayment {
  id?: string;
  status?: string;
  status_detail?: string;
  payment_method?: MercadoPagoOrderPaymentMethod;
}

interface MercadoPagoOrderResponse {
  id?: string;
  status?: string;
  status_detail?: string;
  transactions?: {
    payments?: MercadoPagoOrderTransactionPayment[];
  };
}

function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

// Mapeamento dos status/status_detail reais da Orders API do Mercado Pago
// pro nosso enum fechado — nunca repassamos a string do provider direto pro
// domínio (mesmo princípio de `mapMercadoPagoStatus` da Payments API, Fase
// 17: "never trust the gateway's raw status string").
//
// Vocabulário oficial (Fase 24): created; processed (+ accredited = pago);
// processing (+ in_process); action_required (+ waiting_payment |
// waiting_transfer = pendente); canceled; expired; failed; charged_back;
// refunded.
function mapMercadoPagoOrderStatus(
  status: string | undefined,
  statusDetail: string | undefined,
): ProviderPaymentStatus {
  switch (status) {
    case 'processed':
      return statusDetail === 'accredited' ? 'PAID' : 'PENDING';
    case 'processing':
    case 'action_required':
    case 'created':
      return 'PENDING';
    case 'expired':
      return 'EXPIRED';
    case 'canceled':
      return 'CANCELLED';
    case 'failed':
      return 'FAILED';
    case 'charged_back':
    case 'refunded':
      // Só chegam depois de um PAID já aplicado localmente —
      // `PaymentsService.applyProviderStatus` só transiciona a partir de
      // PENDING, então isto nunca reverte um Payment já terminal; mapeado
      // como FAILED só por segurança defensiva (nunca deveria ser lido com
      // o Payment ainda PENDING).
      return 'FAILED';
    default:
      return 'FAILED';
  }
}

/**
 * Único adapter real do PaymentProvider nesta fase (Mercado Pago, PIX — ver
 * docs/ARCHITECTURE.md, Fase 17, para a justificativa completa da escolha
 * do gateway). Usa `fetch` nativo, sem SDK novo — mesma filosofia de
 * dependências mínimas já seguida em `OpenAiAiProviderService` (Fase 12) e
 * `MetaWhatsAppProviderService` (Fase 16).
 *
 * Migrado da Payments API (`/v1/payments`) pra Orders API (`/v1/orders`) na
 * Fase 24: a Payments API não tem NENHUM mecanismo oficial de sandbox pra
 * simular a aprovação de um PIX de teste (confirmado via documentação
 * oficial do Mercado Pago) — a Orders API tem, através da "palavra mágica"
 * `payer.first_name: "APRO"` (ver `sandboxTestPayerFirstName`), o que
 * permite validar o ciclo completo (webhook de aprovação real incluído)
 * sem dinheiro real e sem depender de um app bancário de verdade. O
 * esquema de assinatura do webhook (`X-Signature`/`X-Request-Id`,
 * HMAC-SHA256) é idêntico entre as duas APIs — `PaymentsWebhookService`
 * não precisou de nenhuma mudança.
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
      const amount = formatAmount(request.amount);
      const testPayerFirstName = this.sandboxTestPayerFirstName();
      const response = await fetch(`${API_BASE_URL}/v1/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          // Idempotência do LADO DO PROVIDER (item 10 do prompt original da
          // Fase 17, ainda válido na Orders API) — retry de rede pra este
          // MESMO Payment local nunca cria um segundo pedido no Mercado
          // Pago, mesmo que nosso próprio claim-first
          // (Payment.idempotencyKey) já tenha, por algum motivo, deixado
          // passar uma segunda chamada.
          'X-Idempotency-Key': request.paymentId,
        },
        body: JSON.stringify({
          type: 'online',
          total_amount: amount,
          external_reference: request.paymentId,
          processing_mode: 'automatic',
          transactions: {
            payments: [
              {
                amount,
                payment_method: { id: 'pix', type: 'bank_transfer' },
                expiration_time: ORDER_EXPIRATION_TIME,
              },
            ],
          },
          payer: {
            // Obrigatório — sem isso o Mercado Pago rejeita a criação
            // (achado real ao validar contra a API de verdade, Fase 23).
            // E-mail é o único dado do payer que o domínio já tem
            // disponível e precisa enviar.
            email: request.payerEmail,
            // `first_name: "APRO"` é a palavra-mágica documentada pelo
            // Mercado Pago que força aprovação automática de um pedido de
            // SANDBOX — sem isso um PIX de teste nunca sai de
            // action_required/waiting_transfer (achado real, Fase 24). SÓ
            // enviado quando `PAYMENT_SANDBOX_TEST_PAYER_NAME` está
            // explicitamente configurada (nunca em produção real — ver
            // `sandboxTestPayerFirstName`); em produção, com um access
            // token real (`APP_USR-...`), o Mercado Pago não dá nenhum
            // tratamento especial a este campo, então nunca é enviado.
            ...(testPayerFirstName ? { first_name: testPayerFirstName } : {}),
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.error(
          `Mercado Pago respondeu ${response.status} em ${Date.now() - startedAt}ms.`,
        );
        throw new PaymentProviderError();
      }

      const body = (await response.json()) as MercadoPagoOrderResponse;
      const payment = body.transactions?.payments?.[0];
      if (!body.id || !payment) {
        throw new PaymentProviderError();
      }

      this.logger.log(`Pedido criado no Mercado Pago (Orders API) em ${Date.now() - startedAt}ms.`);
      return {
        providerPaymentId: body.id,
        checkoutUrl: payment.payment_method?.ticket_url ?? null,
        pixCopyPaste: payment.payment_method?.qr_code ?? null,
        qrCodeBase64: payment.payment_method?.qr_code_base64 ?? null,
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
      const response = await fetch(`${API_BASE_URL}/v1/orders/${providerPaymentId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.error(
          `Mercado Pago respondeu ${response.status} em ${Date.now() - startedAt}ms.`,
        );
        throw new PaymentProviderError();
      }

      const body = (await response.json()) as MercadoPagoOrderResponse;
      this.logger.log(
        `Status consultado no Mercado Pago (Orders API) em ${Date.now() - startedAt}ms.`,
      );
      return {
        status: mapMercadoPagoOrderStatus(body.status, body.status_detail),
        // A Orders API não devolve uma data de aprovação dedicada no nível
        // do pedido — `PaymentsService.applyProviderStatus` já trata
        // `paidAt` ausente como "agora" (`meta.paidAt ?? new Date()`), o
        // que é correto: o webhook só chega depois que o provider já
        // aprovou, então "agora" é uma aproximação aceitável do momento
        // real de aprovação.
        //
        // status_detail é um código curto do provider (ex:
        // "waiting_transfer"), nunca uma mensagem livre — seguro pra
        // armazenar/logar (item 25 do prompt original).
        failureReason: body.status === 'failed' ? (body.status_detail ?? 'failed') : undefined,
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

  // Env var deliberadamente separada de `PAYMENT_API_KEY` (nunca inferida
  // automaticamente do prefixo do token `TEST-`) — uma camada extra de
  // segurança: mesmo rodando contra credenciais de sandbox, "APRO" só é
  // enviado se alguém ligar isto explicitamente pra uma validação
  // controlada (Fase 24), nunca como comportamento padrão. Não documentada
  // em `.env.example` como algo pra manter configurado — é uma chave de
  // uso pontual, removida depois da validação.
  private sandboxTestPayerFirstName(): string | undefined {
    const value = process.env.PAYMENT_SANDBOX_TEST_PAYER_NAME;
    return value && value.trim().length > 0 ? value.trim() : undefined;
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
