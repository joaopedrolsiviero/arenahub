import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { CourtsModule } from '../courts/courts.module';
import { OperatingHoursModule } from '../operating-hours/operating-hours.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { OperationalMetricsService } from './operational-metrics.service';
import { AiProvider } from './providers/ai-provider';
import { OpenAiAiProviderService } from './providers/openai-ai-provider.service';

@Module({
  imports: [AuthModule, ArenaMembersModule, CourtsModule, OperatingHoursModule, PrismaModule],
  controllers: [AiController],
  providers: [
    AiService,
    OperationalMetricsService,
    // Único adapter real registrado (item 7 do prompt da fase) — testes e2e
    // trocam isso por um fake via `.overrideProvider(AiProvider)`, nunca em
    // produção.
    { provide: AiProvider, useClass: OpenAiAiProviderService },
  ],
})
export class AiModule {}
