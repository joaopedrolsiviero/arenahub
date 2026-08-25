export interface AiGenerateRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface AiGenerateResponse {
  text: string;
  /** Quando o provider expõe contagem de tokens (item 22 do prompt) — nunca exibido ao usuário nesta fase, só para log/custo interno. */
  usage?: { inputTokens: number; outputTokens: number };
}

export class AiProviderUnavailableError extends Error {
  constructor(message = 'Assistente de IA temporariamente indisponível.') {
    super(message);
    this.name = 'AiProviderUnavailableError';
  }
}

export class AiTimeoutError extends Error {
  constructor(message = 'O assistente de IA demorou demais para responder.') {
    super(message);
    this.name = 'AiTimeoutError';
  }
}

export class AiInvalidResponseError extends Error {
  constructor(message = 'O assistente de IA retornou uma resposta inválida.') {
    super(message);
    this.name = 'AiInvalidResponseError';
  }
}

/**
 * Abstração sobre o provedor de LLM (Fase 12) — o domínio (AiService) nunca
 * depende do SDK/API de um provedor específico, só desta interface. Trocar
 * de provedor é trocar a implementação registrada em AiModule
 * (`{ provide: AiProvider, useClass: ... }`), sem tocar em mais nada. Classe
 * abstrata (não `interface` TS) pelo mesmo motivo do `InvitationEmailService`
 * da Fase 11: interfaces não existem em runtime, e o DI do Nest precisa de
 * um token de injeção real.
 */
export abstract class AiProvider {
  abstract generate(request: AiGenerateRequest): Promise<AiGenerateResponse>;
}
