import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { CourtsModule } from '../courts/courts.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { BookingsController } from './bookings.controller';
import { MyBookingsController } from './my-bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  // ArenaMembersModule reexporta UsersModule (Fase 3) — BookingsController
  // usa UsersService sem precisar importá-lo separadamente.
  imports: [AuthModule, ArenaMembersModule, CourtsModule, IdempotencyModule, PrismaModule],
  controllers: [BookingsController, MyBookingsController],
  providers: [BookingsService],
  // Fase 16: WhatsAppModule reaproveita a MESMA BookingsService — nenhuma
  // segunda implementação de criação/cancelamento de reserva (item 18/57 do
  // prompt da fase). Continua sendo a única autoridade sobre preço
  // congelado, Idempotency-Key, lock por quadra e EXCLUDE constraint.
  exports: [BookingsService],
})
export class BookingsModule {}
