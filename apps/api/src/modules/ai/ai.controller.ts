import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArenaRole } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ArenaAccessGuard } from '../arena-members/arena-access.guard';
import { RequireArenaRole } from '../arena-members/require-arena-role.decorator';
import { AiService, AskAiResponse } from './ai.service';
import { AskAiDto } from './dto/ask-ai.dto';

// Assistente operacional de IA (Fase 12) — só leitura/análise, nunca
// executa ação. Explicitamente OWNER+ADMIN (item 6 do prompt da fase: usar
// `@RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)` em vez do
// `@RequireArenaRole()` vazio, para deixar a intenção clara — hoje os dois
// têm o mesmo efeito, já que só existem esses dois papéis, mas o vazio
// significaria "qualquer membro", que deixaria de ser verdade se um papel
// novo (STAFF) existisse no futuro sem essa rota ser revisada).
@Controller('arenas/:arenaId/ai')
@UseGuards(ClerkAuthGuard, ArenaAccessGuard)
@RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // Fase 18 (item 4/17): endpoint mais caro do produto (cada chamada é uma
  // requisição paga à OpenAI) — limite dedicado bem mais apertado que o
  // default global. 30/min por IP é generoso para uso humano real (ninguém
  // digita 30 perguntas por minuto) e barato o bastante para limitar o
  // custo de um script abusivo, sem exigir crédito real da OpenAI para
  // validar (a proteção age antes de chamar o provider).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('ask')
  ask(@Param('arenaId') arenaId: string, @Body() dto: AskAiDto): Promise<AskAiResponse> {
    return this.aiService.ask(arenaId, dto);
  }
}
