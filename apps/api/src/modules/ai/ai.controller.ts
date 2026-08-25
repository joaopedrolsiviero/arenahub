import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
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

  @Post('ask')
  ask(@Param('arenaId') arenaId: string, @Body() dto: AskAiDto): Promise<AskAiResponse> {
    return this.aiService.ask(arenaId, dto);
  }
}
