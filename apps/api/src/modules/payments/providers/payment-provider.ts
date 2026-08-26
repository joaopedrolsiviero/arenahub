export interface PaymentProviderCreateRequest {
  /** ID local do Payment — usado também como Idempotency-Key do LADO DO PROVIDER (item 10 do prompt). */
  paymentId: string;
  amount: number;
  currency: string;
  description: string;
}

export interface PaymentProviderCreateResult {
  providerPaymentId: string;
  /** Link de checkout hospedado pelo provider, quando aplicável (ex: Checkout Pro). */
  checkoutUrl: string | null;
  /** Código "copia e cola" do PIX, quando o provider gera na criação. */
  pixCopyPaste: string | null;
}

export type ProviderPaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface PaymentProviderStatusResult {
  status: ProviderPaymentStatus;
  paidAt?: Date;
  /** Motivo curto e seguro pra logar/exibir — nunca o diagnóstico bruto do provider (item 25). */
  failureReason?: string;
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
}
