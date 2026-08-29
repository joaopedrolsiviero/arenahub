import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AvailabilityResult, AvailabilityService } from './availability.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';

// Só leitura, nunca cria Booking (docs/ARCHITECTURE.md, Fase 4, item 61).
// SEM NENHUM guard (Fase 29) — um visitante sem conta precisa conseguir ver
// disponibilidade real antes de autenticar (login só é exigido pra criar a
// Booking, em BookingsController). Antes exigia ClerkAuthGuard (qualquer
// usuário logado); a proteção contra varredura em massa agora depende só do
// throttle por IP abaixo, já que não há mais identidade autenticada pra
// usar como chave.
//
// Fase 18 (item 4): limite mais generoso que os outros — é uma rota
// legitimamente poliada com frequência pelo frontend (calendário de
// disponibilidade), mas ainda finita, para impedir varredura maciça de
// agenda de todas as arenas por um script.
@Throttle({ default: { limit: 200, ttl: 60_000 } })
@Controller('arenas/:arenaId/courts/:courtId/availability')
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
