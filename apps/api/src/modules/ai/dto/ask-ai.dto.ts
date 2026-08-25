import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { PeriodPreset } from '../operational-metrics.service';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRESETS: PeriodPreset[] = [
  'today',
  'yesterday',
  'last7days',
  'last30days',
  'thisWeek',
  'lastWeek',
];

// Ou `preset`, ou `from`+`to` — nunca os dois (validado em
// OperationalMetricsService.resolvePeriod, que é quem realmente entende a
// regra de negócio da combinação). Aqui só a forma de cada campo.
export class AskAiPeriodDto {
  @IsOptional()
  @IsIn(PRESETS, { message: `preset deve ser um de: ${PRESETS.join(', ')}` })
  preset?: PeriodPreset;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from deve estar no formato YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to deve estar no formato YYYY-MM-DD' })
  to?: string;
}

// Fase 12, item 16: limite de tamanho da pergunta. 500 caracteres é
// generoso para uma pergunta em linguagem natural (várias frases) e barato
// o bastante para não virar vetor de custo — mesma lógica de "controle de
// custo no nível da aplicação" do item 17, sem precisar de rate limiting
// persistente nesta fase.
const QUESTION_MAX_LENGTH = 500;

export class AskAiDto {
  @IsString()
  @IsNotEmpty({ message: 'question não pode ser vazia.' })
  @MaxLength(QUESTION_MAX_LENGTH, {
    message: `question deve ter no máximo ${QUESTION_MAX_LENGTH} caracteres.`,
  })
  question!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AskAiPeriodDto)
  period?: AskAiPeriodDto;
}
