import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Weekday } from '@prisma/client';

export interface OperatingInterval {
  dayOfWeek: Weekday;
  /** Minutos desde a meia-noite LOCAL do dia (0-1439). */
  opensAt: number;
  /** Minutos desde a meia-noite LOCAL do dia (1-1439, sempre > opensAt). */
  closesAt: number;
}

// ISO 8601: DateTime.weekday do Luxon é 1 (segunda) .. 7 (domingo) — nunca
// espalhar essa conversão pelo código (item 34 da Fase 5).
const WEEKDAY_BY_ISO: readonly Weekday[] = [
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
  Weekday.SUNDAY,
];

export function weekdayFromIso(isoWeekday: number): Weekday {
  const weekday = WEEKDAY_BY_ISO[isoWeekday - 1];
  if (!weekday) {
    throw new Error(`isoWeekday inválido: ${isoWeekday}`);
  }
  return weekday;
}

const MINUTES_PER_DAY = 24 * 60;

// A API troca "HH:mm" (contrato amigável, nunca um inteiro de minutos cru)
// — a conversão para/de minutos-desde-meia-noite fica só aqui.
export function parseHHMM(value: string): number {
  const [hoursRaw, minutesRaw] = value.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  return hours * 60 + minutes;
}

export function formatHHMM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export interface OperatingIntervalView {
  id: string;
  dayOfWeek: Weekday;
  opensAt: string;
  closesAt: string;
}

export function toIntervalView(row: {
  id: string;
  dayOfWeek: Weekday;
  opensAt: number;
  closesAt: number;
}): OperatingIntervalView {
  return {
    id: row.id,
    dayOfWeek: row.dayOfWeek,
    opensAt: formatHHMM(row.opensAt),
    closesAt: formatHHMM(row.closesAt),
  };
}

// Um intervalo "contém" uma ocupação (já com o buffer somado ao fim) se ela
// cabe inteira entre a abertura e o fechamento — a mesma fórmula é usada
// tanto para validar um Booking específico (isWithinOperatingHours) quanto
// para decidir se um slot gerado por AvailabilityService fica disponível
// (item 41: nunca duas implementações da mesma regra).
export function intervalContains(
  interval: OperatingInterval,
  startMinutes: number,
  occupiedEndMinutes: number,
): boolean {
  return interval.opensAt <= startMinutes && occupiedEndMinutes <= interval.closesAt;
}

/**
 * Verifica se um Booking candidato (instantes reais, já com buffer) respeita
 * o horário de funcionamento da arena. Overnight não é suportado (Fase 5,
 * item 12): se a ocupação (incluindo buffer) atravessa a meia-noite local,
 * ela nunca pode estar contida num único intervalo do mesmo dia — retorna
 * false diretamente, sem precisar de um caso especial.
 */
export function isWithinOperatingHours(
  intervals: OperatingInterval[],
  timezone: string,
  startsAt: Date,
  endsAt: Date,
  bufferMinutes: number,
): boolean {
  const localStart = DateTime.fromJSDate(startsAt, { zone: timezone });
  const localOccupiedEnd = DateTime.fromJSDate(endsAt, { zone: timezone }).plus({
    minutes: bufferMinutes,
  });

  if (!localOccupiedEnd.hasSame(localStart, 'day')) {
    return false;
  }

  const dayOfWeek = weekdayFromIso(localStart.weekday);
  const startMinutes = localStart.hour * 60 + localStart.minute;
  const occupiedEndMinutes = localOccupiedEnd.hour * 60 + localOccupiedEnd.minute;

  return intervals.some(
    (interval) =>
      interval.dayOfWeek === dayOfWeek &&
      intervalContains(interval, startMinutes, occupiedEndMinutes),
  );
}

// Validação da CONFIGURAÇÃO em si (não de um Booking específico): usada por
// OperatingHoursService antes de persistir uma substituição completa da
// semana (item 16 — tudo ou nada, nunca metade da semana inconsistente).
export function assertValidIntervals(intervals: OperatingInterval[]): void {
  for (const interval of intervals) {
    if (
      !Number.isInteger(interval.opensAt) ||
      interval.opensAt < 0 ||
      interval.opensAt >= MINUTES_PER_DAY
    ) {
      throw new BadRequestException(
        `opensAt inválido (${interval.opensAt}) para ${interval.dayOfWeek}: deve estar entre 0 e 1439.`,
      );
    }
    if (
      !Number.isInteger(interval.closesAt) ||
      interval.closesAt <= 0 ||
      interval.closesAt >= MINUTES_PER_DAY
    ) {
      throw new BadRequestException(
        `closesAt inválido (${interval.closesAt}) para ${interval.dayOfWeek}: deve estar entre 1 e 1439.`,
      );
    }
    if (interval.closesAt <= interval.opensAt) {
      throw new BadRequestException(
        `Intervalo inválido em ${interval.dayOfWeek}: closesAt deve ser posterior a opensAt ` +
          '(overnight não é suportado nesta fase — o intervalo precisa estar contido no mesmo dia civil).',
      );
    }
  }

  const byDay = new Map<Weekday, OperatingInterval[]>();
  for (const interval of intervals) {
    const list = byDay.get(interval.dayOfWeek) ?? [];
    list.push(interval);
    byDay.set(interval.dayOfWeek, list);
  }

  for (const [dayOfWeek, dayIntervals] of byDay) {
    const sorted = [...dayIntervals].sort((a, b) => a.opensAt - b.opensAt);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous && current && current.opensAt < previous.closesAt) {
        throw new BadRequestException(`Intervalos sobrepostos em ${dayOfWeek}.`);
      }
    }
  }
}
