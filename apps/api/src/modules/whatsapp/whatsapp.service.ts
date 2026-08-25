import { createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationService } from './conversation.service';
import { normalizePhoneE164 } from '../users/phone.util';
import { WhatsAppProvider } from './providers/whatsapp-provider';

interface InboundTextMessage {
  providerEventId: string;
  fromPhone: string;
  text: string;
}

interface ParsedChange {
  phoneNumberId: string;
  messages: InboundTextMessage[];
}

// Nunca loga o telefone completo (item 49) — só os últimos 4 dígitos, o
// suficiente pra correlacionar linhas de log da mesma conversa sem expor o
// número inteiro.
function maskPhone(phone: string): string {
  return phone.length > 4 ? `***${phone.slice(-4)}` : '***';
}

/**
 * Camada de borda do canal de WhatsApp (Fase 16): verifica a assinatura do
 * webhook, deduplica eventos, resolve qual Arena está recebendo a mensagem
 * (por `phone_number_id`, nunca por comparação de string de telefone — item
 * 8) e delega toda a lógica de conversa pra `ConversationService`. Nunca
 * decide nada de domínio aqui.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    private readonly whatsappProvider: WhatsAppProvider,
  ) {}

  /** GET /webhooks/whatsapp — handshake de verificação exigido pela Meta Cloud API. */
  verifyHandshake(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string {
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!expectedToken || mode !== 'subscribe' || token !== expectedToken || !challenge) {
      throw new ForbiddenException('Verificação de webhook inválida.');
    }
    return challenge;
  }

  /**
   * Compara `X-Hub-Signature-256` (HMAC-SHA256 do corpo cru com
   * WHATSAPP_APP_SECRET) — mesma disciplina de "nunca confiar num
   * POST /webhook sem autenticação" já usada pelo webhook do Clerk (item 5).
   * `timingSafeEqual` evita vazar timing information sobre o quanto da
   * assinatura bateu.
   */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret || !signatureHeader) {
      return false;
    }
    const [scheme, providedHex] = signatureHeader.split('=');
    if (scheme !== 'sha256' || !providedHex) {
      return false;
    }
    const expectedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const provided = Buffer.from(providedHex, 'hex');
    const expected = Buffer.from(expectedHex, 'hex');
    if (provided.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(provided, expected);
  }

  /**
   * Processa o payload já com assinatura verificada. Nunca lança pro
   * controller — um webhook mal formado é ignorado (logado), não um erro
   * 500 (a Meta reenviaria indefinidamente um evento que sempre falha do
   * mesmo jeito).
   */
  async handleEvent(rawBody: Buffer): Promise<void> {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      this.logger.warn('Payload de webhook do WhatsApp não é JSON válido — ignorado.');
      return;
    }

    for (const change of this.parseChanges(payload)) {
      const arena = await this.prisma.arena.findUnique({
        where: { whatsappPhoneNumberId: change.phoneNumberId },
        select: { id: true, whatsappPhoneNumberId: true },
      });
      if (!arena || !arena.whatsappPhoneNumberId) {
        this.logger.warn(
          `Evento recebido para phone_number_id não associado a nenhuma arena — ignorado.`,
        );
        continue;
      }

      for (const message of change.messages) {
        await this.processMessage(arena.id, arena.whatsappPhoneNumberId, message);
      }
    }
  }

  private async processMessage(
    arenaId: string,
    fromPhoneNumberId: string,
    message: InboundTextMessage,
  ): Promise<void> {
    const claimed = await this.claimEvent(message.providerEventId);
    if (!claimed) {
      this.logger.log(`Evento ${message.providerEventId} já processado — ignorado (idempotência).`);
      return;
    }

    const fromPhone = normalizePhoneE164(message.fromPhone);
    if (!fromPhone) {
      this.logger.warn('Mensagem de WhatsApp sem remetente válido — ignorada.');
      return;
    }

    const startedAt = Date.now();
    const reply = await this.conversationService.handleInboundMessage(
      arenaId,
      fromPhone,
      message.text,
    );
    this.logger.log(
      `WhatsApp: arena=${arenaId} de=${maskPhone(fromPhone)} processado em ${Date.now() - startedAt}ms.`,
    );

    try {
      await this.whatsappProvider.sendMessage({ fromPhoneNumberId, to: fromPhone, text: reply });
    } catch (error) {
      // Falha ao ENVIAR a resposta não deve derrubar o processamento do
      // evento (já concluído e deduplicado) — só loga; o cliente pode
      // reenviar a mensagem, e o fluxo de conversa já avançou
      // corretamente no backend.
      this.logger.error(
        `Falha ao enviar resposta de WhatsApp: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
    }
  }

  private async claimEvent(providerEventId: string): Promise<boolean> {
    try {
      await this.prisma.whatsAppEvent.create({ data: { providerEventId } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  // Parsing defensivo do formato da Meta Cloud API — nunca assume a forma
  // exata sem checar (item 4 do prompt: "não assumir formato sem verificar
  // a documentação do provider"). Eventos que não são mensagens de texto
  // (status de entrega, reações, mídia, etc.) são ignorados silenciosamente
  // — fora de escopo desta fase (item 27 da lista de "não implementar":
  // voz/imagem).
  private parseChanges(payload: unknown): ParsedChange[] {
    const changes: ParsedChange[] = [];
    if (typeof payload !== 'object' || payload === null) return changes;
    const entries = (payload as Record<string, unknown>).entry;
    if (!Array.isArray(entries)) return changes;

    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      const entryChanges = (entry as Record<string, unknown>).changes;
      if (!Array.isArray(entryChanges)) continue;

      for (const change of entryChanges) {
        if (typeof change !== 'object' || change === null) continue;
        const value = (change as Record<string, unknown>).value;
        if (typeof value !== 'object' || value === null) continue;

        const metadata = (value as Record<string, unknown>).metadata;
        const phoneNumberId =
          typeof metadata === 'object' && metadata !== null
            ? (metadata as Record<string, unknown>).phone_number_id
            : undefined;
        if (typeof phoneNumberId !== 'string') continue;

        const rawMessages = (value as Record<string, unknown>).messages;
        const messages: InboundTextMessage[] = [];
        if (Array.isArray(rawMessages)) {
          for (const rawMessage of rawMessages) {
            const parsed = this.parseTextMessage(rawMessage);
            if (parsed) messages.push(parsed);
          }
        }
        if (messages.length > 0) {
          changes.push({ phoneNumberId, messages });
        }
      }
    }
    return changes;
  }

  private parseTextMessage(raw: unknown): InboundTextMessage | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Record<string, unknown>;
    if (record.type !== 'text') return null;

    const id = record.id;
    const from = record.from;
    const textField = record.text;
    const body =
      typeof textField === 'object' && textField !== null
        ? (textField as Record<string, unknown>).body
        : undefined;

    if (typeof id !== 'string' || typeof from !== 'string' || typeof body !== 'string') {
      return null;
    }
    return { providerEventId: id, fromPhone: from, text: body };
  }
}
