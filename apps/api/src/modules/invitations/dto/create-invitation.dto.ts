import { IsEmail, IsIn, MaxLength } from 'class-validator';

// Mesma regra do AddMemberDto da Fase 10: `role` só aceita 'ADMIN' (item 7 —
// convite com OWNER é rejeitado mesmo que o cliente tente enviar).
export class CreateInvitationDto {
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsIn(['ADMIN'])
  role!: 'ADMIN';
}
