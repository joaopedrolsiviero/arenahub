import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ArenaRole } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ArenaAccessGuard } from '../arena-members/arena-access.guard';
import { RequireArenaRole } from '../arena-members/require-arena-role.decorator';
import { OperatingHoursService } from './operating-hours.service';
import { OperatingIntervalView } from './operating-hours.util';
import { ReplaceOperatingHoursDto } from './dto/replace-operating-hours.dto';

// Leitura só ClerkAuthGuard (item 17 da Fase 5) — mesmo padrão já usado para
// availability/booking na Fase 4: saber quando a arena abre faz parte da
// experiência pública do cliente, não exige ser ArenaMember. Escrita exige
// ArenaAccessGuard + OWNER/ADMIN, igual a CourtsController/BookingsController.
@Controller('arenas/:arenaId/operating-hours')
@UseGuards(ClerkAuthGuard)
export class OperatingHoursController {
  constructor(private readonly operatingHoursService: OperatingHoursService) {}

  @Get()
  findForArena(@Param('arenaId') arenaId: string): Promise<OperatingIntervalView[]> {
    return this.operatingHoursService.getForArena(arenaId);
  }

  @Put()
  @UseGuards(ArenaAccessGuard)
  @RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)
  replace(
    @Param('arenaId') arenaId: string,
    @Body() dto: ReplaceOperatingHoursDto,
  ): Promise<OperatingIntervalView[]> {
    return this.operatingHoursService.replaceForArena(arenaId, dto.intervals);
  }
}
