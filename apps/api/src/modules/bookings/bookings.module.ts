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
})
export class BookingsModule {}
