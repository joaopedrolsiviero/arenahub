import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { ArenasModule } from '../arenas/arenas.module';
import { CourtsModule } from '../courts/courts.module';
import { AvailabilityModule } from '../availability/availability.module';
import { BookingsModule } from '../bookings/bookings.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { AiModule } from '../ai/ai.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { ConversationService } from './conversation.service';
import { WhatsAppIntentService } from './intent.service';
import { WhatsAppProvider } from './providers/whatsapp-provider';
import { MetaWhatsAppProviderService } from './providers/meta-whatsapp-provider.service';

// Fase 16 — WhatsApp é só mais um canal de entrada para o domínio já
// existente (ver docs/ARCHITECTURE.md, Fase 16, "Princípio arquitetural
// fundamental"): este módulo importa os módulos de domínio pra reaproveitar
// literalmente `ArenasService`/`CourtsService`/`AvailabilityService`/
// `BookingsService`/`IdempotencyService` — nunca uma segunda implementação
// de reserva/cancelamento/disponibilidade/preço. `AiModule` é reaproveitado
// só pelo `AiProvider` (a "última milha" de rede até o LLM) — o
// classificador de intenção desta fase (`WhatsAppIntentService`) é um
// consumidor NOVO e SEPARADO de `AiService` (Fase 12): propósitos
// diferentes (classificar intenção de cliente vs. responder pergunta
// analítica de OWNER/ADMIN), nunca misturados no mesmo service (item 60).
@Module({
  imports: [
    PrismaModule,
    UsersModule,
    ArenasModule,
    CourtsModule,
    AvailabilityModule,
    BookingsModule,
    IdempotencyModule,
    AiModule,
  ],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    ConversationService,
    WhatsAppIntentService,
    // Único adapter real registrado (mesmo padrão de AiModule/
    // OpenAiAiProviderService) — testes e2e trocam por um fake via
    // `.overrideProvider(WhatsAppProvider)`, nunca em produção.
    { provide: WhatsAppProvider, useClass: MetaWhatsAppProviderService },
  ],
})
export class WhatsAppModule {}
