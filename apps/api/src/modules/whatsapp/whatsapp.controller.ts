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
import { WhatsAppService } from './whatsapp.service';

// Convenção espelhada do WebhooksController do Clerk (Fase 2/9): sem
// ClerkAuthGuard (este endpoint é chamado pela Meta, nunca por um usuário
// autenticado do ArenaHub) — a autenticidade da requisição é garantida pela
// verificação de assinatura/token, não por sessão.
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
