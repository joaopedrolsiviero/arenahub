import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ArenaRole } from '@prisma/client';
import { type AuthenticatedUser, ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ArenaAccessGuard } from '../arena-members/arena-access.guard';
import { RequireArenaRole } from '../arena-members/require-arena-role.decorator';
import {
  ArenaDetail,
  ArenaDiscoveryDetail,
  ArenaDiscoverySummary,
  ArenaFields,
  ArenasService,
  ArenaSummary,
} from './arenas.service';
import { CreateArenaDto } from './dto/create-arena.dto';
import { UpdateArenaDto } from './dto/update-arena.dto';

@Controller('arenas')
export class ArenasController {
  constructor(private readonly arenasService: ArenasService) {}

  @Post()
  @UseGuards(ClerkAuthGuard)
  create(
    @Body() dto: CreateArenaDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ArenaSummary> {
    return this.arenasService.create(dto, user.clerkId);
  }

  @Get()
  @UseGuards(ClerkAuthGuard)
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<ArenaSummary[]> {
    return this.arenasService.findAllForUser(user.clerkId);
  }

  // Descoberta pública (Fase 6, reaberta de verdade na Fase 29) — precisa vir
  // ANTES de `:arenaId` na declaração, senão o Nest resolveria "discover"
  // como valor do parâmetro `:arenaId` da rota administrativa abaixo. SEM
  // NENHUM guard — decisão explícita da Fase 29: um visitante sem conta
  // precisa conseguir navegar arena → quadra → data → horário → resumo antes
  // de autenticar (login só é exigido pra criar a Booking, em
  // BookingsController). Antes desta fase exigia ClerkAuthGuard (qualquer
  // usuário logado, não só membro da arena); a fronteira de autorização real
  // agora é "toda escrita exige login", nunca "toda leitura pública exige
  // login". Throttle por IP em AvailabilityController continua protegendo
  // contra varredura em massa, já que não há mais identidade autenticada
  // pra usar como chave.
  @Get('discover')
  discoverAll(): Promise<ArenaDiscoverySummary[]> {
    return this.arenasService.discoverAll();
  }

  @Get('discover/:arenaId')
  discoverOne(@Param('arenaId') arenaId: string): Promise<ArenaDiscoveryDetail> {
    return this.arenasService.discoverOne(arenaId);
  }

  // Fase 32 — URL pública canônica da arena passa a ser `/arenas/:slug`
  // (`slug` já existia no schema, nunca tinha rota própria). Mesmo shape de
  // resposta de `discoverOne`, sem guard (mesma decisão da Fase 29: leitura
  // pública). Segmento extra (`slug/`) evita qualquer ambiguidade com
  // `discover/:arenaId` acima — contagem de segmentos diferente, nunca
  // colide na resolução de rota do Nest.
  @Get('discover/slug/:slug')
  discoverBySlug(@Param('slug') slug: string): Promise<ArenaDiscoveryDetail> {
    return this.arenasService.discoverBySlug(slug);
  }

  @Get(':arenaId')
  @UseGuards(ClerkAuthGuard, ArenaAccessGuard)
  @RequireArenaRole()
  findOne(@Param('arenaId') arenaId: string): Promise<ArenaDetail> {
    return this.arenasService.findOne(arenaId);
  }

  @Patch(':arenaId')
  @UseGuards(ClerkAuthGuard, ArenaAccessGuard)
  @RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)
  update(@Param('arenaId') arenaId: string, @Body() dto: UpdateArenaDto): Promise<ArenaFields> {
    return this.arenasService.update(arenaId, dto);
  }
}
