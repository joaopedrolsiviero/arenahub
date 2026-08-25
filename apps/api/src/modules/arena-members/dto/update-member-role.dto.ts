import { IsIn } from 'class-validator';

// Mesma regra do AddMemberDto: único valor aceito é 'ADMIN' (item 12 — OWNER
// nunca é um destino válido através deste endpoint).
export class UpdateMemberRoleDto {
  @IsIn(['ADMIN'])
  role!: 'ADMIN';
}
