export interface PaymentProviderCreateRequest {
  /** ID local do Payment — usado também como Idempotency-Key do LADO DO PROVIDER (item 10 do prompt). */
  paymentId: string;
  amount: number;
  currency: string;
  description: string;
  /** E-mail de quem está pagando — exigido pelo Mercado Pago (`payer.email`) para criar um pagamento PIX. */
  payerEmail: string;
}

export interface PaymentProviderCreateResult {
  providerPaymentId: string;
  /** Link de checkout hospedado pelo provider, quando aplicável (ex: Checkout Pro). */
  checkoutUrl: string | null;
  /** Código "copia e cola" do PIX, quando o provider gera na criação. */
  pixCopyPaste: string | null;
  /** Imagem do QR Code do PIX, em base64 (PNG), pronta pra exibir num `<img>`. */
  qrCodeBase64: string | null;
}

export type ProviderPaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface PaymentProviderStatusResult {
  status: ProviderPaymentStatus;
  paidAt?: Date;
  /** Motivo curto e seguro pra logar/exibir — nunca o diagnóstico bruto do provider (item 25). */
  failureReason?: string;
}

// Fase 27 — mapeamento fechado dos estados REAIS de refund do Mercado Pago
// (`status: "approved"`/`"in_process"`/qualquer outra coisa), documentado
// oficialmente: reembolso de PIX pode ser assíncrono
// (`X-Render-In-Process-Refunds: true` → `201` com `status: "in_process"`
// em vez do `400` genérico sem esse header). REFUNDING nunca é tratado
// como sucesso — só REFUNDED, e só depois de "approved" real.
export type ProviderRefundStatus = 'REFUNDED' | 'REFUNDING' | 'FAILED';

export interface PaymentProviderRefundResult {
  /** ID do refund NO PROVIDER — nunca confiado sozinho, só usado pra reconsultar depois. */
  refundId: string;
  status: ProviderRefundStatus;
}

export class PaymentProviderError extends Error {
  constructor(message = 'Não foi possível processar o pagamento no momento.') {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export class PaymentProviderTimeoutError extends Error {
  constructor(message = 'O provedor de pagamento demorou demais para responder.') {
    super(message);
    this.name = 'PaymentProviderTimeoutError';
  }
}

/**
 * Abstração sobre o gateway de pagamento (Fase 17) — o domínio
 * (PaymentsService) nunca depende do SDK/API de um provider específico, só
 * desta interface. Mesmo padrão de `AiProvider` (Fase 12) e `WhatsAppProvider`
 * (Fase 16): classe abstrata porque o DI do Nest precisa de um token de
 * injeção real em runtime. Trocar de provider é trocar a implementação
 * registrada em `PaymentsModule` (`{ provide: PaymentProvider, useClass: ... }`
 * ), sem tocar em mais nada do domínio.
 *
 * `getPaymentStatus` existe porque o webhook do Mercado Pago (e da maioria
 * dos gateways) NUNCA inclui o status definitivo no corpo da notificação —
 * só avisa "algo mudou no pagamento X"; o status real é sempre buscado de
 * volta na API do provider, nunca confiado no payload do webhook (item 8.10
 * do prompt: "nunca confiar em valores enviados" — aqui estendido a "nunca
 * confiar no corpo do webhook").
 */
export abstract class PaymentProvider {
  abstract createPayment(
    request: PaymentProviderCreateRequest,
  ): Promise<PaymentProviderCreateResult>;
  abstract getPaymentStatus(providerPaymentId: string): Promise<PaymentProviderStatusResult>;

  /**
   * Reembolso INTEGRAL (Fase 27 — MVP não tem reembolso parcial, item 26 do
   * prompt) de um pagamento já aprovado. `idempotencyKey` deve ser ESTÁVEL
   * por Payment (não regenerada a cada tentativa) — é ela, não um lock
   * local, que garante ao provider que retries (timeout, retomar depois de
   * um crash, o mesmo clique duas vezes) nunca geram um segundo refund
   * real, mesmo que o estado local tenha ficado inconsistente no meio do
   * caminho.
   */
  abstract refundPayment(
    providerPaymentId: string,
    idempotencyKey: string,
  ): Promise<PaymentProviderRefundResult>;

  /**
   * Reconsulta o status de um refund já criado — necessário porque reembolso
   * de PIX pode ficar `REFUNDING` (assíncrono) e o Mercado Pago não notifica
   * isso por webhook (não documentado); a única forma de saber que resolveu
   * é perguntar de novo, mesmo padrão "lazy" já usado pra expiração de PIX
   * pendente (nunca um job/cron).
   */
  abstract getRefundStatus(
    providerPaymentId: string,
    refundId: string,
  ): Promise<ProviderRefundStatus>;
}
