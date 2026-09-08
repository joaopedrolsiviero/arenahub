import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { CourtsModule } from '../courts/courts.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingsController } from './bookings.controller';
import { MyBookingsController } from './my-bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  // ArenaMembersModule reexporta UsersModule (Fase 3) — BookingsController
  // usa UsersService sem precisar importá-lo separadamente.
  //
  // forwardRef(PaymentsModule) (Fase 27) — PaymentsModule já importa
  // BookingsModule (pra PaymentsService reaproveitar
  // `findMyBookingDetail`); este import de volta é só pra
  // BookingsController disparar `PaymentsService.refundIfPaid` depois de um
  // cancelamento bem-sucedido, no MESMO endpoint de cancelar (nenhum
  // endpoint novo). `BookingsService` em si continua sem conhecer
  // PaymentsService — o ciclo existe só entre módulos/controller, nunca no
  // domínio de Booking (docs/ARCHITECTURE.md: "Booking nunca depende de
  // Payment").
  imports: [
    AuthModule,
    ArenaMembersModule,
    CourtsModule,
    IdempotencyModule,
    PrismaModule,
    forwardRef(() => PaymentsModule),
    // M7 — BookingsController dispara notificação de confirmação/
    // cancelamento no mesmo endpoint, sem endpoint novo (mesmo padrão do
    // forwardRef(PaymentsModule) acima para refundIfPaid).
    NotificationsModule,
  ],
  controllers: [BookingsController, MyBookingsController],
  providers: [BookingsService],
  // Fase 16: WhatsAppModule reaproveita a MESMA BookingsService — nenhuma
  // segunda implementação de criação/cancelamento de reserva (item 18/57 do
  // prompt da fase). Continua sendo a única autoridade sobre preço
  // congelado, Idempotency-Key, lock por quadra e EXCLUDE constraint.
  exports: [BookingsService],
})
export class BookingsModule {}
