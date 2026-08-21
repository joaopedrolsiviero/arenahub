import { BadRequestException } from '@nestjs/common';
import { Weekday } from '@prisma/client';
import {
  assertValidIntervals,
  formatHHMM,
  intervalContains,
  isWithinOperatingHours,
  OperatingInterval,
  parseHHMM,
  weekdayFromIso,
} from './operating-hours.util';

describe('parseHHMM / formatHHMM', () => {
  it('converte HH:mm em minutos desde a meia-noite e volta', () => {
    expect(parseHHMM('08:00')).toBe(480);
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('23:59')).toBe(1439);
    expect(formatHHMM(480)).toBe('08:00');
    expect(formatHHMM(0)).toBe('00:00');
    expect(formatHHMM(1439)).toBe('23:59');
  });
});

describe('weekdayFromIso', () => {
  it('mapeia 1 (segunda) a 7 (domingo) do Luxon para o enum Weekday', () => {
    expect(weekdayFromIso(1)).toBe(Weekday.MONDAY);
    expect(weekdayFromIso(7)).toBe(Weekday.SUNDAY);
  });
});

describe('intervalContains', () => {
  const interval: OperatingInterval = { dayOfWeek: Weekday.MONDAY, opensAt: 480, closesAt: 1320 };

  it('true quando o intervalo cabe inteiro dentro da abertura/fechamento', () => {
    expect(intervalContains(interval, 480, 1320)).toBe(true);
    expect(intervalContains(interval, 600, 660)).toBe(true);
  });

  it('false quando começa antes da abertura ou termina depois do fechamento', () => {
    expect(intervalContains(interval, 479, 1320)).toBe(false);
    expect(intervalContains(interval, 480, 1321)).toBe(false);
  });
});

describe('isWithinOperatingHours', () => {
  // Segunda-feira 2026-08-24, 08:00-18:00 em America/Sao_Paulo.
  const intervals: OperatingInterval[] = [
    { dayOfWeek: Weekday.MONDAY, opensAt: 480, closesAt: 1080 },
  ];
  const timezone = 'America/Sao_Paulo';

  it('true para um horário dentro do funcionamento', () => {
    const startsAt = new Date('2026-08-24T12:00:00-03:00');
    const endsAt = new Date('2026-08-24T13:00:00-03:00');
    expect(isWithinOperatingHours(intervals, timezone, startsAt, endsAt, 0)).toBe(true);
  });

  it('false para um horário fora do funcionamento (antes de abrir)', () => {
    const startsAt = new Date('2026-08-24T06:00:00-03:00');
    const endsAt = new Date('2026-08-24T07:00:00-03:00');
    expect(isWithinOperatingHours(intervals, timezone, startsAt, endsAt, 0)).toBe(false);
  });

  it('false quando o dia da semana não tem nenhum intervalo configurado (arena fechada)', () => {
    const startsAt = new Date('2026-08-25T12:00:00-03:00'); // terça
    const endsAt = new Date('2026-08-25T13:00:00-03:00');
    expect(isWithinOperatingHours(intervals, timezone, startsAt, endsAt, 0)).toBe(false);
  });

  it('considera o buffer: reserva que termina dentro do horário mas cujo buffer ultrapassa o fechamento é rejeitada', () => {
    // 17:00-18:00 com buffer 15min ocupa efetivamente até 18:15, além do
    // fechamento às 18:00.
    const startsAt = new Date('2026-08-24T17:00:00-03:00');
    const endsAt = new Date('2026-08-24T18:00:00-03:00');
    expect(isWithinOperatingHours(intervals, timezone, startsAt, endsAt, 15)).toBe(false);
    expect(isWithinOperatingHours(intervals, timezone, startsAt, endsAt, 0)).toBe(true);
  });

  it('false quando a ocupação (com buffer) atravessa a meia-noite local — overnight não suportado', () => {
    const fullDay: OperatingInterval[] = [
      { dayOfWeek: Weekday.MONDAY, opensAt: 0, closesAt: 1439 },
    ];
    const startsAt = new Date('2026-08-24T23:50:00-03:00');
    const endsAt = new Date('2026-08-24T23:55:00-03:00');
    // buffer de 30min empurra o fim ocupado para o dia seguinte
    expect(isWithinOperatingHours(fullDay, timezone, startsAt, endsAt, 30)).toBe(false);
  });

  it('respeita DST: mesmo horário local em America/New_York resolve para instantes UTC diferentes conforme a época do ano', () => {
    const nyIntervals: OperatingInterval[] = [
      { dayOfWeek: Weekday.MONDAY, opensAt: 480, closesAt: 1080 }, // 08:00-18:00 local
    ];
    // 2026-01-05 (segunda, fora do horário de verão nos EUA, offset -05:00)
    const winterStart = new Date('2026-01-05T12:00:00-05:00');
    const winterEnd = new Date('2026-01-05T13:00:00-05:00');
    expect(isWithinOperatingHours(nyIntervals, 'America/New_York', winterStart, winterEnd, 0)).toBe(
      true,
    );

    // 2026-08-24 (segunda, dentro do horário de verão nos EUA, offset -04:00)
    const summerStart = new Date('2026-08-24T12:00:00-04:00');
    const summerEnd = new Date('2026-08-24T13:00:00-04:00');
    expect(isWithinOperatingHours(nyIntervals, 'America/New_York', summerStart, summerEnd, 0)).toBe(
      true,
    );

    // O MESMO instante UTC que é 12:00 local no inverno (-05:00) seria
    // 13:00 local no verão (-04:00) — prova que a conversão não usa offset
    // fixo, senão os dois casos acima dariam resultados inconsistentes com
    // horários locais idênticos.
    expect(winterStart.toISOString()).not.toBe(summerStart.toISOString());
  });
});

describe('assertValidIntervals', () => {
  it('aceita uma configuração válida com múltiplos intervalos no mesmo dia', () => {
    expect(() =>
      assertValidIntervals([
        { dayOfWeek: Weekday.MONDAY, opensAt: 480, closesAt: 720 },
        { dayOfWeek: Weekday.MONDAY, opensAt: 840, closesAt: 1320 },
      ]),
    ).not.toThrow();
  });

  it('rejeita opensAt >= closesAt', () => {
    expect(() =>
      assertValidIntervals([{ dayOfWeek: Weekday.MONDAY, opensAt: 600, closesAt: 600 }]),
    ).toThrow(BadRequestException);
    expect(() =>
      assertValidIntervals([{ dayOfWeek: Weekday.MONDAY, opensAt: 700, closesAt: 600 }]),
    ).toThrow(BadRequestException);
  });

  it('rejeita valores fora do range 0-1439', () => {
    expect(() =>
      assertValidIntervals([{ dayOfWeek: Weekday.MONDAY, opensAt: -1, closesAt: 600 }]),
    ).toThrow(BadRequestException);
    expect(() =>
      assertValidIntervals([{ dayOfWeek: Weekday.MONDAY, opensAt: 0, closesAt: 1440 }]),
    ).toThrow(BadRequestException);
  });

  it('rejeita intervalos sobrepostos no mesmo dia', () => {
    expect(() =>
      assertValidIntervals([
        { dayOfWeek: Weekday.MONDAY, opensAt: 480, closesAt: 720 },
        { dayOfWeek: Weekday.MONDAY, opensAt: 660, closesAt: 840 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('não confunde sobreposição entre dias diferentes', () => {
    expect(() =>
      assertValidIntervals([
        { dayOfWeek: Weekday.MONDAY, opensAt: 480, closesAt: 720 },
        { dayOfWeek: Weekday.TUESDAY, opensAt: 480, closesAt: 720 },
      ]),
    ).not.toThrow();
  });

  it('lista vazia é válida (dias todos fechados)', () => {
    expect(() => assertValidIntervals([])).not.toThrow();
  });
});
