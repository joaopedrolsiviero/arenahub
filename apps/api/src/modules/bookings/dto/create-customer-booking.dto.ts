import { ArrayMaxSize, ArrayUnique, IsISO8601, IsNotEmpty, IsOptional } from 'class-validator';

// Só `startsAt` (+ `additionalStartTimes` opcional) — duração, tipo,
// usuário, total e status são sempre determinados pelo backend (ver
// docs/ARCHITECTURE.md, Fase 4, item 27). O cliente nunca envia `endsAt`,
// `userId`, `type`, `status` ou `total`.
export class CreateCustomerBookingDto {
  @IsISO8601()
  @IsNotEmpty()
  startsAt!: string;

  // Seleção de múltiplos horários numa única reserva — opcional e vazio
  // por padrão, o que preserva 100% o contrato antigo (uma chamada sem
  // este campo cria exatamente UM Booking, exatamente como antes desta
  // fase; usado pelo WhatsApp — ConversationService — que nunca envia
  // este campo). Quando presente, `startsAt` + `additionalStartTimes`
  // formam o conjunto completo de horários pedidos nesta reserva.
  // Limite de 47 (mais que suficiente pra qualquer grade real de um dia,
  // mesmo com slots de 30min) — defesa contra abuso, nunca um limite de
  // negócio real.
  @IsOptional()
  @ArrayMaxSize(47)
  @ArrayUnique()
  @IsISO8601({}, { each: true })
  additionalStartTimes?: string[];
}
