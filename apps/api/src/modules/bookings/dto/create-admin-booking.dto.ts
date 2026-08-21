import { IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// Usado tanto para BLOCK quanto para MAINTENANCE — o tipo é determinado pelo
// endpoint/método chamado (nunca por um campo `type` no body). Diferente do
// CUSTOMER, aqui o admin informa `endsAt` diretamente: bloqueios e
// manutenções têm duração arbitrária, não a duração fixa de slot (ver
// docs/ARCHITECTURE.md, Fase 4, itens 18-19).
export class CreateAdminBookingDto {
  @IsISO8601()
  @IsNotEmpty()
  startsAt!: string;

  @IsISO8601()
  @IsNotEmpty()
  endsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
