import { buildAiContext } from './ai-context';
import { OperationalMetrics, PeriodComparison } from './operational-metrics.service';

function fakeMetrics(overrides: Partial<OperationalMetrics> = {}): OperationalMetrics {
  return {
    period: { from: new Date(), to: new Date(), fromLabel: '2026-08-14', toLabel: '2026-08-20' },
    summary: {
      customerBookings: 10,
      confirmedBookings: 8,
      cancelledBookings: 2,
      blocks: 1,
      maintenance: 0,
      estimatedRevenue: 800,
      occupancyRate: 0.4321,
    },
    courts: [
      {
        courtId: 'court-internal-cuid-1',
        courtName: 'Quadra 1',
        confirmedBookings: 5,
        cancelledBookings: 1,
        occupancyRate: 0.5,
        estimatedRevenue: 500,
      },
    ],
    demand: {
      bookingsByHour: [{ hour: 10, count: 3 }],
      peakHour: 10,
      lowestHour: 8,
      bookingsByDay: [],
      busiestDay: '2026-08-18',
    },
    mostOccupiedCourtName: 'Quadra 1',
    leastOccupiedCourtName: 'Quadra 1',
    ...overrides,
  };
}

function fakeComparison(overrides: Partial<PeriodComparison> = {}): PeriodComparison {
  return {
    previous: { from: new Date(), to: new Date(), fromLabel: '2026-08-07', toLabel: '2026-08-13' },
    previousSummary: {
      customerBookings: 8,
      confirmedBookings: 6,
      cancelledBookings: 2,
      blocks: 0,
      maintenance: 0,
      estimatedRevenue: 600,
      occupancyRate: 0.3,
    },
    confirmedBookingsDeltaPct: 33.33,
    occupancyRateDeltaPct: 44.03,
    revenueDeltaPct: 33.33,
    ...overrides,
  };
}

describe('buildAiContext', () => {
  it('nunca inclui o courtId interno (cuid) — só o nome de exibição', () => {
    const context = buildAiContext(
      { name: 'Arena Central', timezone: 'America/Sao_Paulo' },
      fakeMetrics(),
      fakeComparison(),
    );

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('court-internal-cuid-1');
    expect(context.courts[0]).not.toHaveProperty('courtId');
    expect(context.courts[0]?.name).toBe('Quadra 1');
  });

  it('nunca inclui campos de PII (nome/e-mail/telefone/clerkId de cliente)', () => {
    const context = buildAiContext(
      { name: 'Arena Central', timezone: 'America/Sao_Paulo' },
      fakeMetrics(),
      fakeComparison(),
    );

    const serialized = JSON.stringify(context).toLowerCase();
    for (const forbidden of ['email', 'clerkid', 'phone', 'telefone', '@example.com']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('só contém dados da arena passada — nunca de outra arena (isolamento estrutural)', () => {
    const context = buildAiContext(
      { name: 'Arena A', timezone: 'America/Sao_Paulo' },
      fakeMetrics(),
      fakeComparison(),
    );

    expect(context.arena.name).toBe('Arena A');
    expect(JSON.stringify(context)).not.toContain('Arena B');
  });

  it('arredonda percentuais e valores monetários para exibição', () => {
    const context = buildAiContext(
      { name: 'Arena Central', timezone: 'America/Sao_Paulo' },
      fakeMetrics(),
      fakeComparison(),
    );

    expect(context.summary.occupancyRatePct).toBe(43.2);
    expect(context.summary.estimatedRevenueBRL).toBe(800);
  });

  it('preserva null de ocupação (nunca inventa 0 quando não há capacidade mensurável)', () => {
    const context = buildAiContext(
      { name: 'Arena Central', timezone: 'America/Sao_Paulo' },
      fakeMetrics({ summary: { ...fakeMetrics().summary, occupancyRate: null } }),
      fakeComparison(),
    );

    expect(context.summary.occupancyRatePct).toBeNull();
  });

  it('inclui período, comparação e horário de pico/menor demanda formatados', () => {
    const context = buildAiContext(
      { name: 'Arena Central', timezone: 'America/Sao_Paulo' },
      fakeMetrics(),
      fakeComparison(),
    );

    expect(context.period).toEqual({ from: '2026-08-14', to: '2026-08-20' });
    expect(context.demand.peakHour).toBe('10:00');
    expect(context.demand.lowestHour).toBe('08:00');
    expect(context.comparisonToPreviousPeriod.previousPeriod).toEqual({
      from: '2026-08-07',
      to: '2026-08-13',
    });
    expect(context.comparisonToPreviousPeriod.confirmedBookingsDeltaPct).toBe(33.3);
  });
});
