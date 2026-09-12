import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { InvitationTokenController } from './invitation-token.controller';
import { InvitationEmailService } from './email/invitation-email.service';
import { ResendInvitationEmailService } from './email/resend-invitation-email.service';

@Module({
  imports: [AuthModule, UsersModule, ArenaMembersModule],
  controllers: [InvitationsController, InvitationTokenController],
  providers: [
    InvitationsService,
    // Fase de fechamento de convites (2026-09) — único adapter real
    // registrado (mesmo padrão de AiModule/WhatsAppModule/PaymentsModule):
    // sem RESEND_API_KEY configurada, degrada pro mesmo comportamento do
    // antigo ConsoleInvitationEmailService (ver resend-invitation-email.service.ts).
    // Testes e2e/unitários continuam trocando por um fake via
    // `.overrideProvider(InvitationEmailService)`, nunca em produção.
    { provide: InvitationEmailService, useClass: ResendInvitationEmailService },
  ],
})
export class InvitationsModule {}
