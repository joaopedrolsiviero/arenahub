import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArenaRole } from '@prisma/client';
import { type AuthenticatedUser, ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ArenaAccessGuard } from '../arena-members/arena-access.guard';
import { RequireArenaRole } from '../arena-members/require-arena-role.decorator';
import { InvitationsService, InvitationSummary } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';

// Convites são sempre gerenciados no contexto de UMA arena (item 5 do
// prompt: nunca uma rota global de convites) — mesma cadeia de guards de
// todo recurso aninhado em :arenaId (item 107).
@Controller('arenas/:arenaId/invitations')
@UseGuards(ClerkAuthGuard, ArenaAccessGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  // Fase 18 (item 4): criação de convite dispara e-mail real (Fase 11) —
  // limite dedicado evita que um OWNER comprometido/script vire uma máquina
  // de spam de e-mail a partir da própria infraestrutura da ArenaHub.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @RequireArenaRole(ArenaRole.OWNER)
  create(
    @Param('arenaId') arenaId: string,
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvitationSummary> {
    return this.invitationsService.createInvitation(arenaId, dto, user.clerkId);
  }

  @Get()
  @RequireArenaRole(ArenaRole.OWNER)
  findAll(@Param('arenaId') arenaId: string): Promise<InvitationSummary[]> {
    return this.invitationsService.listInvitations(arenaId);
  }

  @Delete(':invitationId')
  @RequireArenaRole(ArenaRole.OWNER)
  @HttpCode(204)
  revoke(
    @Param('arenaId') arenaId: string,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    return this.invitationsService.revokeInvitation(arenaId, invitationId);
  }

  // Fase 18 (item 4): "resend" é o vetor de spam de e-mail mais óbvio
  // (reenviar pro MESMO destinatário repetidamente) — limite mais apertado
  // que o de criação.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':invitationId/resend')
  @RequireArenaRole(ArenaRole.OWNER)
  resend(
    @Param('arenaId') arenaId: string,
    @Param('invitationId') invitationId: string,
  ): Promise<InvitationSummary> {
    return this.invitationsService.resendInvitation(arenaId, invitationId);
  }
}
