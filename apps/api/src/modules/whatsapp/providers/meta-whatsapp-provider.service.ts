import { Injectable, Logger } from '@nestjs/common';
import {
  WhatsAppOutboundMessage,
  WhatsAppProvider,
  WhatsAppProviderError,
} from './whatsapp-provider';

const GRAPH_API_VERSION = 'v21.0';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Único adapter real do WhatsAppProvider (item 3 do prompt: WhatsApp
 * Business Platform / Cloud API oficial da Meta — nunca uma solução não
 * oficial baseada em QR Code/scraping). Usa `fetch` nativo, sem SDK novo,
 * mesma filosofia de dependências mínimas já usada em
 * `OpenAiAiProviderService` (Fase 12). Sem credenciais reais neste
 * ambiente (item 32/42) — nunca exercitado de verdade nos testes, que usam
 * um fake (ver `whatsapp.e2e-spec.ts`), mas o formato da chamada segue a
 * documentação pública da Cloud API (`POST /{phone-number-id}/messages`).
 */
@Injectable()
export class MetaWhatsAppProviderService extends WhatsAppProvider {
  private readonly logger = new Logger(MetaWhatsAppProviderService.name);

  async sendMessage(message: WhatsAppOutboundMessage): Promise<void> {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) {
      this.logger.warn('WHATSAPP_ACCESS_TOKEN não configurada — envio de WhatsApp indisponível.');
      throw new WhatsAppProviderError();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const response = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${message.fromPhoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: message.to.replace(/^\+/, ''),
            type: 'text',
            text: { body: message.text },
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        // Nunca repassa o corpo do erro da Meta pro chamador — pode conter
        // detalhe de conta/billing (mesmo cuidado do provider de IA).
        this.logger.error(`Meta respondeu ${response.status} em ${Date.now() - startedAt}ms.`);
        throw new WhatsAppProviderError();
      }

      this.logger.log(`Mensagem WhatsApp enviada em ${Date.now() - startedAt}ms.`);
    } catch (error) {
      if (error instanceof WhatsAppProviderError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error(`Meta não respondeu em ${DEFAULT_TIMEOUT_MS}ms — timeout.`);
        throw new WhatsAppProviderError();
      }
      this.logger.error(
        `Falha ao enviar mensagem via Meta: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
      throw new WhatsAppProviderError();
    } finally {
      clearTimeout(timeout);
    }
  }
}
