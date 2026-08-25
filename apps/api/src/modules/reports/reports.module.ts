import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// Fase 15: importa AiModule só para reaproveitar a MESMA instância de
// OperationalMetricsService que a IA já usa (exportada de lá) — nenhuma
// segunda implementação das regras de receita/ocupação/demanda/comparação.
@Module({
  imports: [AuthModule, ArenaMembersModule, AiModule, PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
