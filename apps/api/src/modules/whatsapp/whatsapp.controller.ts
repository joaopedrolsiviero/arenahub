import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  RawBody,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { WhatsAppService } from './whatsapp.service';

// Convenção espelhada do WebhooksController do Clerk (Fase 2/9): sem
// ClerkAuthGuard (este endpoint é chamado pela Meta, nunca por um usuário
// autenticado do ArenaHub) — a autenticidade da requisição é garantida pela
// verificação de assinatura/token, não por sessão.
//
// Fase 18 (item 4): @SkipThrottle() deliberado — um rate limiter por IP
// quebraria webhooks legítimos (a Meta entrega eventos de múltiplas arenas
// através de um pool de IPs compartilhado, e reenvia agressivamente em caso
// de timeout/erro) sem impedir abuso de verdade: qualquer requisição sem
// assinatura válida já é rejeitada com 403 antes de qualquer processamento
// (verifySignature), e eventos repetidos já são deduplicados
// (WhatsAppEvent). Rate limiting por IP aqui protegeria contra nada que a
// assinatura+dedup já não cubra, e arriscaria descartar entregas reais.
@SkipThrottle()
@Controller('webhooks/whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  // Handshake de verificação exigido pela Meta Cloud API ao configurar o
  // endpoint do webhook no painel do Meta for Developers.
  @Get()
  @HttpCode(HttpStatus.OK)
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    const resolvedChallenge = this.whatsappService.verifyHandshake(mode, token, challenge);
    // A Meta espera o `hub.challenge` de volta como texto puro, nunca
    // envelopado em JSON.
    res.status(HttpStatus.OK).send(resolvedChallenge);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @RawBody() rawBody: Buffer | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!rawBody) {
      throw new ForbiddenException('Corpo da requisição ausente.');
    }
    if (!this.whatsappService.verifySignature(rawBody, signature)) {
      throw new ForbiddenException('Assinatura do webhook inválida.');
    }

    await this.whatsappService.handleEvent(rawBody);
    // Sempre 200, mesmo que o processamento interno tenha ignorado o
    // evento (formato desconhecido, arena não configurada etc.) — devolver
    // erro faria a Meta reenviar indefinidamente algo que nunca vai ter
    // sucesso (item 5 do prompt).
    return { received: true };
  }
}
