import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { PaymentsService } from './payments.service';
import { PaymentsWebhookService } from './payments-webhook.service';
import { PaymentProvider } from './providers/payment-provider';
import { MercadoPagoPaymentProviderService } from './providers/mercado-pago-payment-provider.service';

// Fase 17 — reaproveita `BookingsService.findMyBookingDetail` (já exportado
// desde a Fase 16, ver bookings.module.ts) pra toda checagem de
// existência/ownership/tipo — nenhuma segunda implementação dessas regras.
// `PaymentsService` é exportado pro caso de um consumidor futuro (ex:
// WhatsApp) precisar iniciar pagamento — não usado por ninguém além deste
// módulo nesta fase (item 14 do prompt: "não implemente pagamentos pelo
// WhatsApp além do necessário pra manter a arquitetura preparada").
@Module({
  imports: [AuthModule, UsersModule, BookingsModule, PrismaModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [
    PaymentsService,
    PaymentsWebhookService,
    // Único adapter real registrado (mesmo padrão de AiModule/WhatsAppModule)
    // — testes trocam por um fake via `.overrideProvider(PaymentProvider)`,
    // nunca em produção.
    { provide: PaymentProvider, useClass: MercadoPagoPaymentProviderService },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
