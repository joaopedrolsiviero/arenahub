import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PushTokensController } from './push-tokens.controller';
import { PushTokensService } from './push-tokens.service';
import { PushNotificationsService } from './push-notifications.service';

// M7 — módulo novo e mínimo (registro/remoção de token + disparo via Expo
// Push Service). `PushNotificationsService` é exportado para ser injetado
// nos pontos de evento reais (BookingsController, PaymentsWebhookService) —
// nenhum deles precisa conhecer PushTokensService diretamente.
@Module({
  imports: [AuthModule, UsersModule, PrismaModule],
  controllers: [PushTokensController],
  providers: [PushTokensService, PushNotificationsService],
  exports: [PushNotificationsService],
})
export class NotificationsModule {}
