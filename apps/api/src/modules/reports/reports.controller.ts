import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArenaRole } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ArenaAccessGuard } from '../arena-members/arena-access.guard';
import { RequireArenaRole } from '../arena-members/require-arena-role.decorator';
import { ReportsQueryDto } from './dto/reports-query.dto';
import { ReportResponse, ReportsService } from './reports.service';

// Fase 15: relatórios operacionais — só leitura, OWNER/ADMIN, explícito
// (mesma convenção do AiController/CustomersController) via
// @RequireArenaRole(OWNER, ADMIN), reaproveitando ClerkAuthGuard/
// ArenaAccessGuard sem modificação — nenhum sistema de autorização novo.
// Fase 18 (item 4): relatórios agregam consultas potencialmente caras
// (várias agregações sobre Booking) — limite dedicado evita que o
// dashboard de relatórios vire um vetor de negação de serviço por
// consulta cara repetida.
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('arenas/:arenaId/reports')
@UseGuards(ClerkAuthGuard, ArenaAccessGuard)
@RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  getReport(
    @Param('arenaId') arenaId: string,
    @Query() query: ReportsQueryDto,
  ): Promise<ReportResponse> {
    return this.reportsService.getReport(arenaId, query);
  }
}
