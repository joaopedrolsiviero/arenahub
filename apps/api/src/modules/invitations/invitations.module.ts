import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { InvitationTokenController } from './invitation-token.controller';
import {
  ConsoleInvitationEmailService,
  InvitationEmailService,
} from './email/invitation-email.service';

@Module({
  imports: [AuthModule, UsersModule, ArenaMembersModule],
  controllers: [InvitationsController, InvitationTokenController],
  providers: [
    InvitationsService,
    { provide: InvitationEmailService, useClass: ConsoleInvitationEmailService },
  ],
})
export class InvitationsModule {}
