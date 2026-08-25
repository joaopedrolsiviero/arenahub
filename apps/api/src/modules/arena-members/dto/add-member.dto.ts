import { IsEmail, IsIn, MaxLength } from 'class-validator';

// `role` só aceita 'ADMIN' (item 8: "Não permitir criação de OWNER através
// de endpoint comum de adição") — o próprio DTO já rejeita OWNER antes de
// qualquer lógica de service, e ValidationPipe (whitelist +
// forbidNonWhitelisted) rejeita qualquer campo extra (userId, arenaId, id,
// createdAt) que o item 21 lista como mass assignment a bloquear.
export class AddMemberDto {
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsIn(['ADMIN'])
  role!: 'ADMIN';
}
