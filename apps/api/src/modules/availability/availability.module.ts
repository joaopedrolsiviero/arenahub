import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CourtsModule } from '../courts/courts.module';
import { OperatingHoursModule } from '../operating-hours/operating-hours.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

@Module({
  imports: [AuthModule, CourtsModule, OperatingHoursModule, PrismaModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  // Fase 16: WhatsAppModule reaproveita a MESMA AvailabilityService (nunca
  // uma segunda implementação de disponibilidade — item 15/57 do prompt da
  // fase) para responder "tem quadra livre nesse horário?" pelo canal de
  // WhatsApp. Mesmo padrão de CourtsModule exportando CourtsService.
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
