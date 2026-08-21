import { IsISO8601, IsNotEmpty } from 'class-validator';

// Só `startsAt` — duração, tipo, usuário, total e status são sempre
// determinados pelo backend (ver docs/ARCHITECTURE.md, Fase 4, item 27). O
// cliente nunca envia `endsAt`, `userId`, `type`, `status` ou `total`.
export class CreateCustomerBookingDto {
  @IsISO8601()
  @IsNotEmpty()
  startsAt!: string;
}
