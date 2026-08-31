import { createHmac } from 'node:crypto';
import { ForbiddenException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationService } from './conversation.service';

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

function signBody(body: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
}

function textMessagePayload(
  overrides: {
    phoneNumberId?: string;
    messageId?: string;
    from?: string;
    body?: string;
  } = {},
) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: overrides.phoneNumberId ?? '1000000000' },
              contacts: [
                { profile: { name: 'Cliente' }, wa_id: overrides.from ?? '5511999998888' },
              ],
              messages: [
                {
                  from: overrides.from ?? '5511999998888',
                  id: overrides.messageId ?? 'wamid.ABC123',
                  timestamp: '1700000000',
                  text: { body: overrides.body ?? 'Quero reservar amanhã às 19h' },
                  type: 'text',
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  });
}

describe('WhatsAppService', () => {
  let prisma: {
    arena: { findUnique: jest.Mock };
    whatsAppEvent: { create: jest.Mock };
  };
  let conversationService: { handleInboundMessage: jest.Mock };
  let whatsappProvider: { sendMessage: jest.Mock };
  let service: WhatsAppService;

  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;

    prisma = {
      arena: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'arena-1', whatsappPhoneNumberId: '1000000000' }),
      },
      whatsAppEvent: {
        create: jest.fn().mockResolvedValue({ id: 'evt-1', providerEventId: 'wamid.ABC123' }),
      },
    };
    conversationService = {
      handleInboundMessage: jest.fn().mockResolvedValue('Resposta simulada.'),
    };
    whatsappProvider = { sendMessage: jest.fn().mockResolvedValue(undefined) };

    service = new WhatsAppService(
      prisma as unknown as PrismaService,
      conversationService as unknown as ConversationService,
      whatsappProvider,
    );
  });

  afterEach(() => {
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  describe('verifyHandshake (item 4 — GET de verificação)', () => {
    it('devolve o challenge quando mode/token batem', () => {
      expect(service.verifyHandshake('subscribe', VERIFY_TOKEN, '12345')).toBe('12345');
    });

    it('lança ForbiddenException com token errado', () => {
      expect(() => service.verifyHandshake('subscribe', 'token-errado', '12345')).toThrow(
        ForbiddenException,
      );
    });

    it('lança ForbiddenException com mode diferente de "subscribe"', () => {
      expect(() => service.verifyHandshake('unsubscribe', VERIFY_TOKEN, '12345')).toThrow(
        ForbiddenException,
      );
    });

    it('lança ForbiddenException sem WHATSAPP_VERIFY_TOKEN configurado', () => {
      delete process.env.WHATSAPP_VERIFY_TOKEN;
      expect(() => service.verifyHandshake('subscribe', 'qualquer', '12345')).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('verifySignature (item 5 — nunca confiar em POST sem verificação)', () => {
    it('assinatura válida (HMAC-SHA256 correto) passa', () => {
      const body = textMessagePayload();
      expect(service.verifySignature(Buffer.from(body), signBody(body))).toBe(true);
    });

    it('assinatura inválida é rejeitada', () => {
      const body = textMessagePayload();
      expect(service.verifySignature(Buffer.from(body), 'sha256=' + '0'.repeat(64))).toBe(false);
    });

    it('header ausente é rejeitado', () => {
      const body = textMessagePayload();
      expect(service.verifySignature(Buffer.from(body), undefined)).toBe(false);
    });

    it('esquema diferente de sha256 é rejeitado', () => {
      const body = textMessagePayload();
      expect(service.verifySignature(Buffer.from(body), 'sha1=abcdef')).toBe(false);
    });

    it('sem WHATSAPP_APP_SECRET configurado, sempre rejeita (nunca aceita por omissão)', () => {
      delete process.env.WHATSAPP_APP_SECRET;
      const body = textMessagePayload();
      expect(service.verifySignature(Buffer.from(body), signBody(body))).toBe(false);
    });

    // Fase 34, item 21 — nenhuma linha de log pode conter o app secret nem o
    // verify token, em nenhum dos dois caminhos (assinatura válida ou
    // rejeitada). Espiona os três níveis do Logger do Nest de uma vez.
    it('nunca loga o app secret nem o verify token, mesmo quando a assinatura é rejeitada', () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      const body = textMessagePayload();
      service.verifySignature(Buffer.from(body), 'sha256=' + '0'.repeat(64));
      service.verifySignature(Buffer.from(body), signBody(body));
      expect(() => service.verifyHandshake('subscribe', 'token-errado', '12345')).toThrow();
      service.verifyHandshake('subscribe', VERIFY_TOKEN, '12345');

      const allCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].flat();
      const serialized = JSON.stringify(allCalls);
      expect(serialized).not.toContain(APP_SECRET);
      expect(serialized).not.toContain(VERIFY_TOKEN);

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('handleEvent — idempotência e roteamento (itens 6, 8)', () => {
    it('resolve a arena pelo phone_number_id e delega a mensagem pra ConversationService', async () => {
      await service.handleEvent(Buffer.from(textMessagePayload()));

      expect(prisma.arena.findUnique).toHaveBeenCalledWith({
        where: { whatsappPhoneNumberId: '1000000000' },
        select: { id: true, whatsappPhoneNumberId: true },
      });
      expect(conversationService.handleInboundMessage).toHaveBeenCalledWith(
        'arena-1',
        '+5511999998888',
        'Quero reservar amanhã às 19h',
      );
      expect(whatsappProvider.sendMessage).toHaveBeenCalledWith({
        fromPhoneNumberId: '1000000000',
        to: '+5511999998888',
        text: 'Resposta simulada.',
      });
    });

    it('evento com o mesmo providerEventId processado duas vezes só executa uma vez (dedup)', async () => {
      prisma.whatsAppEvent.create
        .mockResolvedValueOnce({ id: 'evt-1', providerEventId: 'wamid.ABC123' })
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('unique violation', {
            code: 'P2002',
            clientVersion: '6.0.0',
          }),
        );

      await service.handleEvent(Buffer.from(textMessagePayload()));
      await service.handleEvent(Buffer.from(textMessagePayload()));

      expect(conversationService.handleInboundMessage).toHaveBeenCalledTimes(1);
    });

    it('phone_number_id sem arena associada é ignorado, nunca lança', async () => {
      prisma.arena.findUnique.mockResolvedValue(null);

      await expect(
        service.handleEvent(Buffer.from(textMessagePayload({ phoneNumberId: '999999' }))),
      ).resolves.toBeUndefined();
      expect(conversationService.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('payload que não é JSON válido é ignorado, nunca lança', async () => {
      await expect(service.handleEvent(Buffer.from('isso não é json'))).resolves.toBeUndefined();
      expect(conversationService.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('evento sem "messages" (ex: status de entrega) é ignorado silenciosamente', async () => {
      const statusPayload = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: '1000000000' },
                  statuses: [{ id: 'wamid.STATUS', status: 'delivered' }],
                },
              },
            ],
          },
        ],
      });

      await service.handleEvent(Buffer.from(statusPayload));

      expect(conversationService.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('falha ao ENVIAR a resposta não impede o processamento do evento (evento já foi tratado)', async () => {
      whatsappProvider.sendMessage.mockRejectedValue(new Error('falha de rede'));

      await expect(service.handleEvent(Buffer.from(textMessagePayload()))).resolves.toBeUndefined();
      expect(conversationService.handleInboundMessage).toHaveBeenCalledTimes(1);
    });

    // Fase 34, item 5 — mensagens de tipo não suportado (imagem, áudio,
    // documento, figurinha, localização, resposta de botão interativo etc.)
    // são fora de escopo (item 27 da Fase 16: "não implementar voz/imagem")
    // e precisam ser ignoradas silenciosamente, nunca travar o processamento
    // do restante do evento nem chegar em `ConversationService` sem texto.
    it('mensagem de tipo não suportado (imagem) é ignorada, nunca chega em ConversationService', async () => {
      const imagePayload = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: '1000000000' },
                  messages: [
                    {
                      from: '5511999998888',
                      id: 'wamid.IMG1',
                      timestamp: '1700000000',
                      type: 'image',
                      image: { id: 'media-id-123', mime_type: 'image/jpeg' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });

      await expect(service.handleEvent(Buffer.from(imagePayload))).resolves.toBeUndefined();
      expect(conversationService.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('mensagem de texto sem "text.body" (payload malformado) é ignorada, nunca lança', async () => {
      const malformedPayload = JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: '1000000000' },
                  messages: [
                    {
                      from: '5511999998888',
                      id: 'wamid.MALFORMED1',
                      timestamp: '1700000000',
                      type: 'text',
                      // "text" ausente — a Meta nunca deveria mandar isso pra
                      // type: "text", mas o parser nunca deve assumir sem checar.
                    },
                  ],
                },
              },
            ],
          },
        ],
      });

      await expect(service.handleEvent(Buffer.from(malformedPayload))).resolves.toBeUndefined();
      expect(conversationService.handleInboundMessage).not.toHaveBeenCalled();
    });

    // Fase 34, item 5 — "remetente desconhecido": `normalizePhoneE164`
    // devolve `null` quando o campo `from` não contém nenhum dígito
    // (defesa em profundidade — a Meta sempre entrega `wa_id` numérico na
    // prática, mas o parser nunca deve confiar nisso sem checar, item 4).
    it('remetente sem nenhum dígito (from malformado) é ignorado, nunca chega em ConversationService', async () => {
      await expect(
        service.handleEvent(Buffer.from(textMessagePayload({ from: 'remetente-invalido' }))),
      ).resolves.toBeUndefined();
      expect(conversationService.handleInboundMessage).not.toHaveBeenCalled();
    });
  });
});
