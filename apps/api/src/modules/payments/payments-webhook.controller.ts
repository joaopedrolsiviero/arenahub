import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PaymentsWebhookService } from './payments-webhook.service';

// Convenção espelhada do webhook do WhatsApp (Fase 16) e do Clerk (Fase 2):
// sem ClerkAuthGuard (chamado pelo gateway, nunca por um usuário
// autenticado do ArenaHub) — autenticidade garantida pela assinatura, não
// por sessão. Rota fixa (`mercadopago`), não um `:provider` genérico —
// só existe UM provider real registrado nesta fase (item 3 da auditoria);
// um `:provider` coringa sem handler nenhum registrado pra outro valor
// seria abstração sem uso real.
//
// Fase 18 (item 4): mesma justificativa do webhook do WhatsApp —
// @SkipThrottle() deliberado. Assinatura HMAC + dedup por
// PaymentWebhookEvent já cobrem o abuso real; rate limiting por IP só
// arriscaria descartar notificações legítimas de retry do Mercado Pago.
@SkipThrottle()
@Controller('webhooks/payments/mercadopago')
export class PaymentsWebhookController {
  constructor(private readonly webhookService: PaymentsWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() body: unknown,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
  ): Promise<{ received: true }> {
    const parsed = this.webhookService.parseNotification(body);
    // Falha ao entender o payload E falha de assinatura levam ao MESMO erro
    // genérico (item 8.2/8.3 do prompt) — nunca dar pistas de qual parte
    // exatamente falhou pra quem está tentando forjar um webhook.
    if (
      !parsed ||
      !this.webhookService.verifySignature(parsed.providerPaymentId, requestId, signature)
    ) {
      throw new ForbiddenException('Webhook de pagamento inválido ou não assinado corretamente.');
    }

    await this.webhookService.handleEvent(parsed);
    // Sempre 200 depois de aceito — mesmo que o processamento interno
    // tenha ignorado o evento (Payment desconhecido, já terminal etc.):
    // devolver erro faria o provider reenviar indefinidamente algo que
    // nunca vai ter sucesso (mesma decisão do webhook do WhatsApp).
    return { received: true };
  }
}
