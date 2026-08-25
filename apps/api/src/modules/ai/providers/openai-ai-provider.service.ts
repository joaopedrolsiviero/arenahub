import { Injectable, Logger } from '@nestjs/common';
import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiInvalidResponseError,
  AiProvider,
  AiProviderUnavailableError,
  AiTimeoutError,
} from './ai-provider';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 15_000;
const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAiChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Único adapter real do AiProvider nesta fase (item 7 do prompt: "não
 * adicionar dois ou mais provedores"). Usa `fetch` nativo do Node 24 — sem
 * SDK novo, mesma filosofia de dependências mínimas já seguida no resto do
 * backend. Ver docs/ARCHITECTURE.md e docs/DEPLOYMENT.md, Fase 12, para a
 * justificativa completa da escolha do provedor.
 */
@Injectable()
export class OpenAiAiProviderService extends AiProvider {
  private readonly logger = new Logger(OpenAiAiProviderService.name);

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const apiKey = process.env.AI_PROVIDER_API_KEY;
    if (!apiKey) {
      // Nunca loga a ausência como se fosse um erro de infraestrutura vago —
      // mensagem clara, nunca o valor (que nem existe aqui).
      this.logger.warn('AI_PROVIDER_API_KEY não configurada — assistente de IA indisponível.');
      throw new AiProviderUnavailableError();
    }

    const model = process.env.AI_PROVIDER_MODEL ?? DEFAULT_MODEL;
    const timeoutMs = Number(process.env.AI_PROVIDER_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
          temperature: 0.2,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Nunca repassa o corpo do erro do provider pro chamador (poderia
        // vazar detalhe interno da conta/billing) — só loga sanitizado.
        this.logger.error(`OpenAI respondeu ${response.status} em ${Date.now() - startedAt}ms.`);
        throw new AiProviderUnavailableError();
      }

      const body = (await response.json()) as OpenAiChatResponse;
      const text = body.choices?.[0]?.message?.content;
      if (!text) {
        throw new AiInvalidResponseError();
      }

      this.logger.log(
        `OpenAI respondeu em ${Date.now() - startedAt}ms (model=${model}` +
          (body.usage
            ? `, inputTokens=${body.usage.prompt_tokens ?? 0}, outputTokens=${body.usage.completion_tokens ?? 0})`
            : ')'),
      );

      return {
        text,
        usage: body.usage
          ? {
              inputTokens: body.usage.prompt_tokens ?? 0,
              outputTokens: body.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof AiProviderUnavailableError || error instanceof AiInvalidResponseError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error(`OpenAI não respondeu em ${timeoutMs}ms — timeout.`);
        throw new AiTimeoutError();
      }
      this.logger.error(
        `Falha ao chamar OpenAI: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
      throw new AiProviderUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }
}
