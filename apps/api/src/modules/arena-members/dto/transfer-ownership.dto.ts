import { IsNotEmpty, IsString } from 'class-validator';

// Identifica o destinatário por userId (não email) — ao contrário de
// adicionar membro, aqui o destinatário JÁ precisa ser ADMIN da mesma
// arena (item 77 do prompt), então o userId já é conhecido pelo OWNER via
// GET /members, nunca precisa de um lookup por e-mail.
export class TransferOwnershipDto {
  @IsString()
  @IsNotEmpty()
  newOwnerUserId!: string;
}
