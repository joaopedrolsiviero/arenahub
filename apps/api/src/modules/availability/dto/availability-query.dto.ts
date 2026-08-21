import { IsISO8601 } from 'class-validator';

// Mesmo contrato de BookingWindowQueryDto (from/to obrigatórios). Duplicado
// deliberadamente em vez de compartilhado entre os dois módulos — são seis
// linhas, e packages/shared tem escopo restrito por decisão da Fase 1.
export class AvailabilityQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}
