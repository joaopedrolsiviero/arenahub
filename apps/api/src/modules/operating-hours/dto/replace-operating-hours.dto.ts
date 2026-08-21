import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, Matches, ValidateNested } from 'class-validator';
import { Weekday } from '@prisma/client';

// HH:mm, 00:00-23:59 — nunca minutos crus no contrato da API (formato
// amigável, convertido para Int internamente por OperatingHoursService).
const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class OperatingIntervalDto {
  @IsEnum(Weekday)
  dayOfWeek!: Weekday;

  @Matches(HHMM_PATTERN, { message: 'opensAt deve estar no formato HH:mm (00:00-23:59)' })
  opensAt!: string;

  @Matches(HHMM_PATTERN, { message: 'closesAt deve estar no formato HH:mm (00:00-23:59)' })
  closesAt!: string;
}

// Substituição completa da semana (item 15 da Fase 5) — um dia sem nenhum
// intervalo na lista fica fechado. Limite de 100 só como defesa contra
// payload absurdo, nunca deveria ser atingido em uso real (no máximo alguns
// intervalos por dia × 7 dias).
export class ReplaceOperatingHoursDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OperatingIntervalDto)
  intervals!: OperatingIntervalDto[];
}
