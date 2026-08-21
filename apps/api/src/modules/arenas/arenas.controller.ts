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
@UseGuards(ClerkAuthGuard)
export class ArenasController {
  constructor(private readonly arenasService: ArenasService) {}

  @Post()
  create(
    @Body() dto: CreateArenaDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ArenaSummary> {
    return this.arenasService.create(dto, user.clerkId);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<ArenaSummary[]> {
    return this.arenasService.findAllForUser(user.clerkId);
  }

  // Descoberta pública (Fase 6) — precisa vir ANTES de `:arenaId` na
  // declaração, senão o Nest resolveria "discover" como valor do parâmetro
  // `:arenaId` da rota administrativa abaixo. Só ClerkAuthGuard: não exige
  // ArenaMember (mesmo padrão de availability/CUSTOMER desde a Fase 4) —
  // `GET /arenas` continua sendo "minhas arenas", sem mudança de semântica.
  @Get('discover')
  discoverAll(): Promise<ArenaDiscoverySummary[]> {
    return this.arenasService.discoverAll();
  }

  @Get('discover/:arenaId')
  discoverOne(@Param('arenaId') arenaId: string): Promise<ArenaDiscoveryDetail> {
    return this.arenasService.discoverOne(arenaId);
  }

  @Get(':arenaId')
  @UseGuards(ArenaAccessGuard)
  @RequireArenaRole()
  findOne(@Param('arenaId') arenaId: string): Promise<ArenaDetail> {
    return this.arenasService.findOne(arenaId);
  }

  @Patch(':arenaId')
  @UseGuards(ArenaAccessGuard)
  @RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)
  update(@Param('arenaId') arenaId: string, @Body() dto: UpdateArenaDto): Promise<ArenaFields> {
    return this.arenasService.update(arenaId, dto);
  }
}
