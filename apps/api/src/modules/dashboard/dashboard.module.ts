import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { CourtsModule } from '../courts/courts.module';
import { OperatingHoursModule } from '../operating-hours/operating-hours.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// Não é um domínio novo (item 101 da Fase 7) — só agrega Arena/Court/
// ArenaOperatingHours/Booking já existentes numa única resposta.
@Module({
  imports: [AuthModule, ArenaMembersModule, CourtsModule, OperatingHoursModule, PrismaModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
