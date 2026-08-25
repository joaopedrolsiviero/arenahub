import { IsIn, IsOptional, Matches } from 'class-validator';
import type { PeriodPreset } from '../../ai/operational-metrics.service';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Fase 15: todos os presets que OperationalMetricsService.resolvePeriod
// entende — inclui thisMonth/lastMonth (adicionados nesta fase) além dos
// já usados pela IA desde a Fase 12. Query params GET (não aninhados sob
// "period" como no corpo do POST da IA) — mesmo motivo de sempre: sem
// suporte fácil a objeto aninhado em query string sem serialização própria.
const PRESETS: PeriodPreset[] = [
  'today',
  'yesterday',
  'last7days',
  'last30days',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
];

export class ReportsQueryDto {
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
