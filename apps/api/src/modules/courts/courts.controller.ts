import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ArenaRole } from '@prisma/client';
import type { Court } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ArenaAccessGuard } from '../arena-members/arena-access.guard';
import { RequireArenaRole } from '../arena-members/require-arena-role.decorator';
import { CourtsService } from './courts.service';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';

// :arenaId no path é o que faz o ArenaAccessGuard funcionar aqui — mesmo
// mecanismo de autorização do ArenasController, nada duplicado.
@Controller('arenas/:arenaId/courts')
@UseGuards(ClerkAuthGuard, ArenaAccessGuard)
export class CourtsController {
  constructor(private readonly courtsService: CourtsService) {}

  @Post()
  @RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)
  create(@Param('arenaId') arenaId: string, @Body() dto: CreateCourtDto): Promise<Court> {
    return this.courtsService.create(arenaId, dto);
  }

  @Get()
  @RequireArenaRole()
  findAll(
    @Param('arenaId') arenaId: string,
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,
  ): Promise<Court[]> {
    return this.courtsService.findAllForArena(arenaId, includeInactive);
  }

  @Get(':courtId')
  @RequireArenaRole()
  findOne(@Param('arenaId') arenaId: string, @Param('courtId') courtId: string): Promise<Court> {
    return this.courtsService.findOne(arenaId, courtId);
  }

  @Patch(':courtId')
  @RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)
  update(
    @Param('arenaId') arenaId: string,
    @Param('courtId') courtId: string,
    @Body() dto: UpdateCourtDto,
  ): Promise<Court> {
    return this.courtsService.update(arenaId, courtId, dto);
  }
}
