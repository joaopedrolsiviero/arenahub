import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { AvailabilityResult, AvailabilityService } from './availability.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';

// Só leitura, nunca cria Booking (docs/ARCHITECTURE.md, Fase 4, item 61).
// Mesmo acesso da criação de CUSTOMER: qualquer usuário autenticado, sem
// exigir ArenaAccessGuard/ArenaMember.
//
// Fase 18 (item 4): limite mais generoso que os outros — é uma rota
// legitimamente poliada com frequência pelo frontend (calendário de
// disponibilidade), mas ainda finita, para impedir varredura maciça de
// agenda de todas as arenas por um script.
@Throttle({ default: { limit: 200, ttl: 60_000 } })
@Controller('arenas/:arenaId/courts/:courtId/availability')
@UseGuards(ClerkAuthGuard)
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get()
  getAvailability(
    @Param('arenaId') arenaId: string,
    @Param('courtId') courtId: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityResult> {
    return this.availabilityService.getAvailability(
      arenaId,
      courtId,
      new Date(query.from),
      new Date(query.to),
    );
  }
}
