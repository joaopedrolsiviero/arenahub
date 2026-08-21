import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ArenaAccessGuard } from '../arena-members/arena-access.guard';
import { RequireArenaRole } from '../arena-members/require-arena-role.decorator';
import { DashboardService, DashboardResponse } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

// Só leitura, qualquer ArenaMember (OWNER ou ADMIN — os únicos papéis que
// existem; CUSTOMER nunca é ArenaMember, então @RequireArenaRole() vazio já
// exclui CUSTOMER automaticamente, mesmo padrão de GET :arenaId/GET courts).
@Controller('arenas/:arenaId/dashboard')
@UseGuards(ClerkAuthGuard, ArenaAccessGuard)
@RequireArenaRole()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(
    @Param('arenaId') arenaId: string,
    @Query() query: DashboardQueryDto,
  ): Promise<DashboardResponse> {
    return this.dashboardService.getDashboard(arenaId, query.date);
  }
}
