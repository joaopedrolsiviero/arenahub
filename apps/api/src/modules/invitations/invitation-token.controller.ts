import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { type AuthenticatedUser, ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { InvitationsService, PublicInvitation } from './invitations.service';

// Rotas identificadas pelo TOKEN do convite, não por :arenaId — o usuário
// convidado pode nem saber o id da arena, e o GET precisa funcionar ANTES
// do login (item 25). Nunca usa ArenaAccessGuard: quem aceita ainda não é
// ArenaMember, é exatamente isso que o accept resolve.
@Controller('invitations')
export class InvitationTokenController {
  constructor(private readonly invitationsService: InvitationsService) {}

  // Público — sem ClerkAuthGuard (item 25: mostrar o convite antes do
  // login). Só retorna dados seguros (item 73/37): nunca membros, nunca
  // tokenHash, nunca dados administrativos da arena.
  @Get(':token')
  getByToken(@Param('token') token: string): Promise<PublicInvitation> {
    return this.invitationsService.getPublicByToken(token);
  }

  @Post(':token/accept')
  @UseGuards(ClerkAuthGuard)
  @HttpCode(204)
  accept(@Param('token') token: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.invitationsService.acceptInvitation(token, user.clerkId);
  }
}
