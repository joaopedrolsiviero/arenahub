import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { OperatingHoursController } from './operating-hours.controller';
import { OperatingHoursService } from './operating-hours.service';

@Module({
  imports: [AuthModule, ArenaMembersModule, PrismaModule],
  controllers: [OperatingHoursController],
  providers: [OperatingHoursService],
  // Exporta OperatingHoursService: AvailabilityModule e BookingsModule
  // reutilizam a leitura de intervalos, nunca reimplementam a query.
  exports: [OperatingHoursService],
})
export class OperatingHoursModule {}
