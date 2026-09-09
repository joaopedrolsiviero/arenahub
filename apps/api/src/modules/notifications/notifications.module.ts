import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PushTokensController } from './push-tokens.controller';
import { PushTokensService } from './push-tokens.service';
import { PushNotificationsService } from './push-notifications.service';
import { WhatsAppNotificationsService } from './whatsapp-notifications.service';
import { WhatsAppProvider } from '../whatsapp/providers/whatsapp-provider';
import { MetaWhatsAppProviderService } from '../whatsapp/providers/meta-whatsapp-provider.service';

// M7 — módulo novo e mínimo (registro/remoção de token + disparo via Expo
// Push Service). `PushNotificationsService` é exportado para ser injetado
// nos pontos de evento reais (BookingsController, PaymentsWebhookService) —
// nenhum deles precisa conhecer PushTokensService diretamente.
//
// W2 — `WhatsAppNotificationsService` é a contraparte no canal WhatsApp,
// exportada pelo mesmo motivo. Registra `WhatsAppProvider` de novo aqui
// (mesmo adapter `MetaWhatsAppProviderService` já usado por
// `WhatsAppModule` — nunca uma segunda integração com a Meta, só uma
// segunda instância DI de uma classe sem estado próprio) em vez de importar
// `WhatsAppModule` inteiro: `WhatsAppModule` já importa `BookingsModule` e
// `PaymentsModule`, que por sua vez importam `NotificationsModule` — importar
// `WhatsAppModule` aqui fecharia um ciclo novo. Testes que fazem
// `.overrideProvider(WhatsAppProvider)` continuam funcionando sem nenhuma
// mudança: o Nest substitui TODAS as ligações desse token no grafo de DI,
// não só a primeira encontrada.
@Module({
  imports: [AuthModule, UsersModule, PrismaModule],
  controllers: [PushTokensController],
  providers: [
    PushTokensService,
    PushNotificationsService,
    WhatsAppNotificationsService,
    { provide: WhatsAppProvider, useClass: MetaWhatsAppProviderService },
  ],
  exports: [PushNotificationsService, WhatsAppNotificationsService],
})
export class NotificationsModule {}
