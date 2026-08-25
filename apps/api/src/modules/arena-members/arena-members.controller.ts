import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ArenaRole } from '@prisma/client';
import { type AuthenticatedUser, ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ArenaAccessGuard } from './arena-access.guard';
import { RequireArenaRole } from './require-arena-role.decorator';
import { ArenaMembersService, ArenaMemberWithUser } from './arena-members.service';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

// Fase 10 — gestão de membros/equipe. Mesma cadeia de guards de todo
// recurso aninhado em :arenaId (ClerkAuthGuard -> ArenaAccessGuard), nunca
// reimplementada aqui (item 37 do prompt da fase).
@Controller('arenas/:arenaId/members')
@UseGuards(ClerkAuthGuard, ArenaAccessGuard)
export class ArenaMembersController {
  constructor(private readonly arenaMembersService: ArenaMembersService) {}

  // Item 7: "GET members: OWNER e ADMIN" — hoje são os dois únicos papéis
  // possíveis, então `@RequireArenaRole()` vazio ("qualquer membro", mesma
  // convenção já usada em CourtsController/ArenasController) é equivalente
  // e mantém o mesmo idioma do resto do código.
  @Get()
  @RequireArenaRole()
  findAll(@Param('arenaId') arenaId: string): Promise<ArenaMemberWithUser[]> {
    return this.arenaMembersService.listMembers(arenaId);
  }

  @Post()
  @RequireArenaRole(ArenaRole.OWNER)
  create(
    @Param('arenaId') arenaId: string,
    @Body() dto: AddMemberDto,
  ): Promise<ArenaMemberWithUser> {
    return this.arenaMembersService.addMember(arenaId, dto);
  }

  @Patch(':userId')
  @RequireArenaRole(ArenaRole.OWNER)
  updateRole(
    @Param('arenaId') arenaId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<ArenaMemberWithUser> {
    return this.arenaMembersService.updateMemberRole(arenaId, userId, dto);
  }

  // `@RequireArenaRole()` (qualquer membro) em vez de OWNER — a distinção
  // fina "OWNER remove qualquer um, ADMIN só remove a si mesmo" é decidida
  // dentro do service (ver comentário em `removeMember`), porque depende do
  // :userId alvo, não só do papel de quem chama.
  @Delete(':userId')
  @RequireArenaRole()
  @HttpCode(204)
  remove(
    @Param('arenaId') arenaId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.arenaMembersService.removeMember(arenaId, userId, user.clerkId);
  }
}
