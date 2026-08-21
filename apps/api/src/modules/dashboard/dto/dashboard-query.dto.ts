import { IsOptional, Matches } from 'class-validator';

// Só a data civil (não um instante ISO8601 completo) — quem decide o que
// "esse dia" significa em termos de instante UTC é o backend, no timezone da
// Arena (Fase 7, item 14: nunca o timezone do navegador). Opcional: quando
// omitida, DashboardService usa "hoje no timezone da arena" como padrão —
// ainda assim uma janela sempre limitada a um único dia, nunca "tudo".
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class DashboardQueryDto {
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'date deve estar no formato YYYY-MM-DD' })
  date?: string;
}
