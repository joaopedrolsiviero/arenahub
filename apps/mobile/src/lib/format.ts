import { DateTime } from 'luxon';

// Portado de apps/web/src/lib/format.ts — mesma lógica, mesmo motivo (M2,
// item 11): a API sempre devolve instantes absolutos (ISO 8601 em UTC); o
// timezone da ARENA (nunca o do aparelho) é quem decide como exibi-los.
// `new Date(...).toLocaleString()` nunca é usado — sempre Luxon, sempre com
// o timezone explícito vindo da própria resposta da API.

export function formatCurrencyBRL(value: string | number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number(value),
  );
}

// M4 — usado pra "expira em"/"pago em" do pagamento PIX. Mesmo formato do
// Web (apps/web/src/lib/format.ts).
export function formatDateTimeInZone(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(timezone)
    .setLocale('pt-BR')
    .toFormat("dd/MM/yyyy 'às' HH:mm");
}

export function formatTimeInZone(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone).setLocale('pt-BR').toFormat('HH:mm');
}

// Para uma data-calendário JÁ resolvida (ex: "2026-08-20", o próprio estado
// local de seleção de data) — nunca reconverte por timezone (diferente de
// formatDateInZone, que espera um INSTANTE completo em UTC): tratar
// "2026-08-20" como instante e trocar de timezone pode empurrar o dia
// exibido pra trás ou pra frente. Mesma distinção já documentada no Web
// (formatDateLabel).
export function formatDateLabel(dateStr: string): string {
  return DateTime.fromISO(dateStr).setLocale('pt-BR').toFormat('dd/MM/yyyy');
}

// M6 — "cliente desde" no perfil: diferente de formatDateInZone, não há
// timezone de ARENA nenhuma envolvida aqui (é um dado da própria conta, não
// de uma reserva) — formata no timezone local do aparelho, mesmo
// comportamento padrão do Luxon sem `.setZone(...)`.
export function formatDate(iso: string): string {
  return DateTime.fromISO(iso).setLocale('pt-BR').toFormat('dd/MM/yyyy');
}

export function formatDateInZone(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(timezone)
    .setLocale('pt-BR')
    .toFormat('dd/MM/yyyy');
}

export function formatWeekdayInZone(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone).setLocale('pt-BR').toFormat('cccc');
}

/** Data de "hoje" no timezone da arena, yyyy-MM-dd — nunca a data local do aparelho. */
export function todayInZone(timezone: string): string {
  return DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd');
}

/**
 * Converte uma data-calendário local (ex: "2026-09-07") na janela [from, to)
 * em UTC correspondente ao dia inteiro naquele timezone — o backend (via
 * horário de funcionamento) é quem decide o que dentro dessa janela está de
 * fato disponível; aqui só convertemos "o dia" pro instante UTC que ele
 * representa no timezone da arena.
 */
export function localDayWindowToUtc(
  dateStr: string,
  timezone: string,
): { from: string; to: string } {
  const startOfDay = DateTime.fromISO(dateStr, { zone: timezone }).startOf('day');
  const endOfDay = startOfDay.plus({ days: 1 });
  return { from: startOfDay.toUTC().toISO()!, to: endOfDay.toUTC().toISO()! };
}

/** dateStr (yyyy-MM-dd) +/- N dias, sempre no timezone da arena. */
export function shiftDate(dateStr: string, timezone: string, days: number): string {
  return DateTime.fromISO(dateStr, { zone: timezone }).plus({ days }).toFormat('yyyy-MM-dd');
}
