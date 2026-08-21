import {
  formatCurrencyBRL,
  formatDateTimeInZone,
  formatTimeInZone,
  localDayWindowToUtc,
  todayInZone,
} from './format';

describe('formatCurrencyBRL', () => {
  it('formata string do Decimal do Prisma como moeda BRL', () => {
    expect(formatCurrencyBRL('100')).toBe('R$ 100,00');
    expect(formatCurrencyBRL('99.90')).toBe('R$ 99,90');
  });
});

describe('formatTimeInZone / formatDateTimeInZone', () => {
  it('converte um instante UTC para o horário local da arena', () => {
    // 13:00 UTC = 10:00 em America/Sao_Paulo (UTC-3, sem horário de verão).
    expect(formatTimeInZone('2026-09-07T13:00:00.000Z', 'America/Sao_Paulo')).toBe('10:00');
  });

  it('respeita timezones diferentes para o mesmo instante', () => {
    expect(formatTimeInZone('2026-09-07T13:00:00.000Z', 'America/New_York')).not.toBe(
      formatTimeInZone('2026-09-07T13:00:00.000Z', 'America/Sao_Paulo'),
    );
  });

  it('formata data e hora juntas no padrão pt-BR', () => {
    expect(formatDateTimeInZone('2026-09-07T13:00:00.000Z', 'America/Sao_Paulo')).toBe(
      '07/09/2026 às 10:00',
    );
  });
});

describe('localDayWindowToUtc', () => {
  it('converte um dia local inteiro na janela UTC correta', () => {
    const { from, to } = localDayWindowToUtc('2026-09-07', 'America/Sao_Paulo');
    // Meia-noite em São Paulo (UTC-3) é 03:00 UTC.
    expect(from).toBe('2026-09-07T03:00:00.000Z');
    expect(to).toBe('2026-09-08T03:00:00.000Z');
  });

  it('produz uma janela diferente para outro timezone no mesmo dia', () => {
    const spWindow = localDayWindowToUtc('2026-09-07', 'America/Sao_Paulo');
    const nyWindow = localDayWindowToUtc('2026-09-07', 'America/New_York');
    expect(spWindow.from).not.toBe(nyWindow.from);
  });
});

describe('todayInZone', () => {
  it('retorna uma data no formato yyyy-MM-dd', () => {
    expect(todayInZone('America/Sao_Paulo')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
