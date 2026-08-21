import { IsISO8601 } from 'class-validator';

// from/to obrigatórios (docs/ARCHITECTURE.md, Fase 4, item 31) — nunca lista
// o histórico inteiro de uma quadra por padrão.
export class BookingWindowQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}
