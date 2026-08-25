import { ReportsService } from './reports.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OperationalMetrics,
  OperationalMetricsService,
  PeriodComparison,
  ResolvedPeriod,
} from '../ai/operational-metrics.service';

describe('ReportsService', () => {
  let prisma: { arena: { findUniqueOrThrow: jest.Mock } };
  let metricsService: {
    resolvePeriod: jest.Mock;
    previousPeriod: jest.Mock;
    getMetrics: jest.Mock;
    buildComparison: jest.Mock;
  };
  let service: ReportsService;

  const arena = { timezone: 'America/Sao_Paulo' };

  const currentPeriod: ResolvedPeriod = {
    from: new Date('2026-08-14T03:00:00.000Z'),
    to: new Date('2026-08-21T03:00:00.000Z'),
    fromLabel: '2026-08-14',
    toLabel: '2026-08-20',
  };
  const previousPeriod: ResolvedPeriod = {
    from: new Date('2026-08-07T03:00:00.000Z'),
    to: new Date('2026-08-14T03:00:00.000Z'),
    fromLabel: '2026-08-07',
    toLabel: '2026-08-13',
  };

  function metrics(overrides: Partial<OperationalMetrics> = {}): OperationalMetrics {
    return {
      period: currentPeriod,
      summary: {
        customerBookings: 10,
        confirmedBookings: 8,
        cancelledBookings: 2,
        blocks: 0,
        maintenance: 0,
        estimatedRevenue: 800,
        occupancyRate: 0.4,
      },
      courts: [
        {
          courtId: 'court-1',
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
        lowestHour: 10,
        bookingsByDay: [
          { date: '2026-08-14', count: 5 },
          { date: '2026-08-15', count: 0 },
          { date: '2026-08-16', count: 3 },
        ],
        busiestDay: '2026-08-14',
      },
      mostOccupiedCourtName: 'Quadra 1',
      leastOccupiedCourtName: 'Quadra 1',
      dailySeries: [
        {
          date: '2026-08-14',
          confirmedBookings: 5,
          cancelledBookings: 1,
          estimatedRevenue: 500,
          occupancyRate: 0.5,
        },
      ],
      ...overrides,
    };
  }

  function comparison(overrides: Partial<PeriodComparison> = {}): PeriodComparison {
    return {
      previous: previousPeriod,
      previousSummary: metrics().summary,
      confirmedBookingsDeltaPct: 25,
      cancelledBookingsDeltaPct: -10,
      occupancyRateDeltaPct: 5,
      revenueDeltaPct: 15,
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = { arena: { findUniqueOrThrow: jest.fn().mockResolvedValue(arena) } };
    metricsService = {
      resolvePeriod: jest.fn().mockReturnValue(currentPeriod),
      previousPeriod: jest.fn().mockReturnValue(previousPeriod),
      getMetrics: jest.fn(),
      buildComparison: jest.fn().mockReturnValue(comparison()),
    };
    service = new ReportsService(
      prisma as unknown as PrismaService,
      metricsService as unknown as OperationalMetricsService,
    );
  });

  it('busca a arena por id e resolve o período a partir do timezone dela, nunca de um timezone fixo', async () => {
    metricsService.getMetrics.mockResolvedValue(metrics());

    await service.getReport('arena-1', { preset: 'last7days' });

    expect(prisma.arena.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'arena-1' },
      select: { timezone: true },
    });
    expect(metricsService.resolvePeriod).toHaveBeenCalledWith('America/Sao_Paulo', {
      preset: 'last7days',
    });
  });

  it('busca métricas do período atual e do anterior via OperationalMetricsService, nunca com uma query própria', async () => {
    metricsService.getMetrics.mockResolvedValue(metrics());

    await service.getReport('arena-1', {});

    expect(metricsService.getMetrics).toHaveBeenCalledWith('arena-1', currentPeriod);
    expect(metricsService.getMetrics).toHaveBeenCalledWith('arena-1', previousPeriod);
    expect(metricsService.getMetrics).toHaveBeenCalledTimes(2);
  });

  it('reshape do summary usa exatamente os campos de OperationalMetrics.summary, sem recalcular nada', async () => {
    metricsService.getMetrics.mockResolvedValue(metrics());

    const result = await service.getReport('arena-1', {});

    expect(result.summary).toEqual({
      revenue: 800,
      bookings: 10,
      confirmedBookings: 8,
      cancelledBookings: 2,
      occupancyRate: 0.4,
    });
  });

  it('reshape da comparação usa exatamente os deltas de buildComparison — inclui cancelledBookingsDeltaPct (Fase 15)', async () => {
    metricsService.getMetrics.mockResolvedValue(metrics());
    metricsService.buildComparison.mockReturnValue(comparison({ cancelledBookingsDeltaPct: null }));

    const result = await service.getReport('arena-1', {});

    expect(result.comparison).toEqual({
      revenueDeltaPct: 15,
      confirmedBookingsDeltaPct: 25,
      cancelledBookingsDeltaPct: null,
      occupancyRateDeltaPct: 5,
    });
  });

  it('reshape da série diária preserva a mesma definição de receita/ocupação de dailySeries, sem recalcular', async () => {
    metricsService.getMetrics.mockResolvedValue(
      metrics({
        dailySeries: [
          {
            date: '2026-08-14',
            confirmedBookings: 5,
            cancelledBookings: 1,
            estimatedRevenue: 500,
            occupancyRate: null,
          },
        ],
      }),
    );

    const result = await service.getReport('arena-1', {});

    expect(result.series).toEqual([
      {
        date: '2026-08-14',
        revenue: 500,
        confirmedBookings: 5,
        cancelledBookings: 1,
        occupancyRate: null,
      },
    ]);
  });

  it('reshape de courts renomeia courtName->name e estimatedRevenue->revenue, sem alterar os valores', async () => {
    metricsService.getMetrics.mockResolvedValue(metrics());

    const result = await service.getReport('arena-1', {});

    expect(result.courts).toEqual([
      {
        name: 'Quadra 1',
        confirmedBookings: 5,
        cancelledBookings: 1,
        revenue: 500,
        occupancyRate: 0.5,
      },
    ]);
  });

  it('demand é um reshape direto de metrics.demand, incluindo peakHour/lowestHour null quando não há dados', async () => {
    metricsService.getMetrics.mockResolvedValue(
      metrics({
        demand: {
          bookingsByHour: [],
          peakHour: null,
          lowestHour: null,
          bookingsByDay: [],
          busiestDay: null,
        },
      }),
    );

    const result = await service.getReport('arena-1', {});

    expect(result.demand).toEqual({ bookingsByHour: [], peakHour: null, lowestHour: null });
  });

  it('busiestDays é derivado de demand.bookingsByDay: exclui dias com 0 reservas, ordena desc, limita a 5', async () => {
    metricsService.getMetrics.mockResolvedValue(
      metrics({
        demand: {
          bookingsByHour: [],
          peakHour: null,
          lowestHour: null,
          bookingsByDay: [
            { date: '2026-08-14', count: 5 },
            { date: '2026-08-15', count: 0 },
            { date: '2026-08-16', count: 8 },
            { date: '2026-08-17', count: 2 },
          ],
          busiestDay: '2026-08-16',
        },
      }),
    );

    const result = await service.getReport('arena-1', {});

    expect(result.busiestDays).toEqual([
      { date: '2026-08-16', count: 8 },
      { date: '2026-08-14', count: 5 },
      { date: '2026-08-17', count: 2 },
    ]);
  });

  it('period/previousPeriod expostos como {from,to} vêm das labels de cada ResolvedPeriod, não recalculados', async () => {
    metricsService.getMetrics
      .mockResolvedValueOnce(metrics({ period: currentPeriod }))
      .mockResolvedValueOnce(metrics({ period: previousPeriod }));

    const result = await service.getReport('arena-1', {});

    expect(result.period).toEqual({ from: '2026-08-14', to: '2026-08-20' });
    expect(result.previousPeriod).toEqual({ from: '2026-08-07', to: '2026-08-13' });
  });

  it('mostOccupiedCourtName/leastOccupiedCourtName são repassados sem alteração', async () => {
    metricsService.getMetrics.mockResolvedValue(
      metrics({ mostOccupiedCourtName: 'Quadra 1', leastOccupiedCourtName: 'Quadra 2' }),
    );

    const result = await service.getReport('arena-1', {});

    expect(result.mostOccupiedCourtName).toBe('Quadra 1');
    expect(result.leastOccupiedCourtName).toBe('Quadra 2');
  });
});
