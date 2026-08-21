import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBody,
} from '@nestjs/common';
import { verifyWebhook } from '@clerk/backend/webhooks';
import type { WebhookEvent } from '@clerk/backend';
import { UsersService } from '../users/users.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly usersService: UsersService) {}

  @Post('clerk')
  @HttpCode(HttpStatus.OK)
  async handleClerkWebhook(
    @RawBody() rawBody: Buffer | undefined,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
  ): Promise<{ received: true }> {
    if (!rawBody || !svixId || !svixTimestamp || !svixSignature) {
      throw new BadRequestException('Headers ou corpo da requisição de webhook ausentes.');
    }

    // @clerk/backend/webhooks espera um Request padrão (Fetch API), não o
    // `req` do Express — reconstruímos um a partir dos bytes crus do corpo
    // (necessários para a verificação de assinatura Svix) e dos headers
    // relevantes.
    const fetchRequest = new Request('http://internal.arenahub/webhooks/clerk', {
      method: 'POST',
      headers: {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      },
      // .toString('utf-8') em vez de passar o Buffer direto: evita
      // ambiguidade de tipos entre Buffer e o BodyInit do Fetch API, e o
      // payload do webhook é sempre texto (JSON) — não há dado binário aqui.
      body: rawBody.toString('utf-8'),
    });

    let event: WebhookEvent;
    try {
      event = await verifyWebhook(fetchRequest);
    } catch {
      throw new BadRequestException('Assinatura do webhook inválida.');
    }

    if (
      event.type === 'user.created' ||
      event.type === 'user.updated' ||
      event.type === 'user.deleted'
    ) {
      await this.usersService.syncFromClerkEvent(event);
    }

    return { received: true };
  }
}
