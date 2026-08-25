export interface WhatsAppOutboundMessage {
  /** phone_number_id da Meta da arena que está enviando (nunca o número em si). */
  fromPhoneNumberId: string;
  /** E.164, sem espaços/parênteses. */
  to: string;
  text: string;
}

export class WhatsAppProviderError extends Error {
  constructor(message = 'Não foi possível enviar a mensagem de WhatsApp.') {
    super(message);
    this.name = 'WhatsAppProviderError';
  }
}

/**
 * Abstração sobre o provedor de WhatsApp (Fase 16, item 3) — o domínio
 * (ConversationService/WhatsAppService) nunca depende do SDK/API de um
 * provedor específico, só desta interface. Mesmo padrão de `AiProvider`
 * (Fase 12): classe abstrata (não `interface` TS) porque o DI do Nest
 * precisa de um token de injeção real em runtime. Trocar de provedor é
 * trocar a implementação registrada em `WhatsAppModule`
 * (`{ provide: WhatsAppProvider, useClass: ... }`), sem tocar em mais nada.
 */
export abstract class WhatsAppProvider {
  abstract sendMessage(message: WhatsAppOutboundMessage): Promise<void>;
}
