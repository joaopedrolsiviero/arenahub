import { DateTime } from 'luxon';

// Decimal do Prisma chega como string — nunca converter para float antes de
// formatar (item 74 da Fase 6). Também aceita `number` para métricas já
// agregadas pelo backend (ex: `CustomerSummary.totalRevenue`, Fase 14 — um
// `Number` genuíno computado no service, não um Decimal column repassado).
export function formatCurrencyBRL(value: string | number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(value),
  );
}

// Sempre recebe o timezone retornado pela API — nunca assume o timezone do
// navegador é o mesmo da arena (itens 14/75-77 da Fase 6).
export function formatDateTimeInZone(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(timezone)
    .setLocale('pt-BR')
    .toFormat("dd/MM/yyyy 'às' HH:mm");
}

export function formatTimeInZone(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone).setLocale('pt-BR').toFormat('HH:mm');
}

export function formatDateInZone(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(timezone)
    .setLocale('pt-BR')
    .toFormat('dd/MM/yyyy');
}

// Para um rótulo de dia civil já resolvido pelo backend (ex: "2026-08-20",
// devolvido por OperationalMetricsService) — nunca reconverte por timezone
// (diferente de formatDateInZone, que espera um instante UTC completo):
// tratar "2026-08-20" como um instante e depois trocar de timezone mudaria
// o dia exibido para trás em timezones negativos. Aqui é só uma
// data-calendário sendo formatada, não um instante sendo convertido.
export function formatDateLabel(dateStr: string): string {
  return DateTime.fromISO(dateStr).setLocale('pt-BR').toFormat('dd/MM/yyyy');
}

export function formatWeekdayInZone(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(timezone)
    .setLocale('pt-BR')
    .toFormat('cccc');
}

/** Data de "hoje" no timezone da arena, no formato yyyy-MM-dd (para <input type="date">). */
export function todayInZone(timezone: string): string {
  return DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd');
}

/**
 * Converte uma data local (valor de <input type="date">, ex: "2026-09-07")
 * na janela [from, to) em UTC correspondente ao dia inteiro naquele
 * timezone — é o backend (via operating hours) quem decide o que dentro
 * dessa janela está de fato disponível; aqui só convertemos o "dia" para o
 * instante UTC que ele representa.
 */
export function localDayWindowToUtc(
  dateStr: string,
  timezone: string,
): { from: string; to: string } {
  const startOfDay = DateTime.fromISO(dateStr, { zone: timezone }).startOf('day');
  const endOfDay = startOfDay.plus({ days: 1 });
  return { from: startOfDay.toUTC().toISO()!, to: endOfDay.toUTC().toISO()! };
}
