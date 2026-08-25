import { BadRequestException } from '@nestjs/common';
import { BookingStatus, BookingType, Sport, Weekday } from '@prisma/client';
import { OperationalMetricsService } from './operational-metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CourtsService } from '../courts/courts.service';
import { OperatingHoursService } from '../operating-hours/operating-hours.service';

describe('OperationalMetricsService', () => {
  let prisma: {
    arena: { findUniqueOrThrow: jest.Mock };
    booking: { findMany: jest.Mock };
  };
  let courtsService: { findAllForArena: jest.Mock };
  let operatingHoursService: { getRawIntervalsForArena: jest.Mock };
  let service: OperationalMetricsService;

  const arena = { id: 'arena-1', timezone: 'America/Sao_Paulo' };
  const courtActive1 = {
    id: 'court-1',
    name: 'Quadra 1',
    sport: Sport.BEACH_VOLLEYBALL,
    isActive: true,
  };
  const courtActive2 = {
    id: 'court-2',
    name: 'Quadra 2',
    sport: Sport.BEACH_VOLLEYBALL,
    isActive: true,
  };

  function booking(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'booking-1',
      courtId: 'court-1',
      type: BookingType.CUSTOMER,
      status: BookingStatus.CONFIRMED,
      startsAt: new Date('2026-08-20T13:00:00.000Z'), // 10:00 em São Paulo
      endsAt: new Date('2026-08-20T14:00:00.000Z'), // 11:00 em São Paulo
      total: 100,
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      arena: { findUniqueOrThrow: jest.fn().mockResolvedValue(arena) },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
    };
    courtsService = { findAllForArena: jest.fn().mockResolvedValue([courtActive1, courtActive2]) };
    operatingHoursService = {
      // 2026-08-20 é quinta-feira — aberta 08:00-22:00 (14h = 840min) para
      // toda a semana, pra simplificar as contas dos testes.
      getRawIntervalsForArena: jest.fn().mockResolvedValue([
        { dayOfWeek: Weekday.MONDAY, opensAt: 8 * 60, closesAt: 22 * 60 },
        { dayOfWeek: Weekday.TUESDAY, opensAt: 8 * 60, closesAt: 22 * 60 },
        { dayOfWeek: Weekday.WEDNESDAY, opensAt: 8 * 60, closesAt: 22 * 60 },
        { dayOfWeek: Weekday.THURSDAY, opensAt: 8 * 60, closesAt: 22 * 60 },
        { dayOfWeek: Weekday.FRIDAY, opensAt: 8 * 60, closesAt: 22 * 60 },
        { dayOfWeek: Weekday.SATURDAY, opensAt: 8 * 60, closesAt: 22 * 60 },
        { dayOfWeek: Weekday.SUNDAY, opensAt: 8 * 60, closesAt: 22 * 60 },
      ]),
    };
    service = new OperationalMetricsService(
      prisma as unknown as PrismaService,
      courtsService as unknown as CourtsService,
      operatingHoursService as unknown as OperatingHoursService,
    );
  });

  describe('resolvePeriod', () => {
    it('"today" resolve a meia-noite local em São Paulo, não UTC', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-20T23:30:00.000Z')); // 20:30 em SP
      try {
        const period = service.resolvePeriod('America/Sao_Paulo', { preset: 'today' });
        expect(period.fromLabel).toBe('2026-08-20');
        expect(period.toLabel).toBe('2026-08-20');
        expect(period.from.toISOString()).toBe('2026-08-20T03:00:00.000Z');
        expect(period.to.toISOString()).toBe('2026-08-21T03:00:00.000Z');
      } finally {
        jest.useRealTimers();
      }
    });

    it('"last7days" inclui hoje e os 6 dias anteriores (7 dias no total)', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-20T15:00:00.000Z'));
      try {
        const period = service.resolvePeriod('America/Sao_Paulo', { preset: 'last7days' });
        expect(period.fromLabel).toBe('2026-08-14');
        expect(period.toLabel).toBe('2026-08-20');
      } finally {
        jest.useRealTimers();
      }
    });

    it('sem period, usa last7days como padrão', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-20T15:00:00.000Z'));
      try {
        const period = service.resolvePeriod('America/Sao_Paulo', undefined);
        expect(period.fromLabel).toBe('2026-08-14');
        expect(period.toLabel).toBe('2026-08-20');
      } finally {
        jest.useRealTimers();
      }
    });

    it('period explícito (from/to) resolve corretamente', () => {
      const period = service.resolvePeriod('America/Sao_Paulo', {
        from: '2026-08-01',
        to: '2026-08-10',
      });
      expect(period.fromLabel).toBe('2026-08-01');
      expect(period.toLabel).toBe('2026-08-10');
    });

    it('rejeita from sem to (e vice-versa)', () => {
      expect(() => service.resolvePeriod('America/Sao_Paulo', { from: '2026-08-01' })).toThrow(
        BadRequestException,
      );
      expect(() => service.resolvePeriod('America/Sao_Paulo', { to: '2026-08-01' })).toThrow(
        BadRequestException,
      );
    });

    it('rejeita preset combinado com from/to', () => {
      expect(() =>
        service.resolvePeriod('America/Sao_Paulo', {
          preset: 'today',
          from: '2026-08-01',
          to: '2026-08-02',
        }),
      ).toThrow(BadRequestException);
    });

    it('rejeita to anterior a from', () => {
      expect(() =>
        service.resolvePeriod('America/Sao_Paulo', { from: '2026-08-10', to: '2026-08-01' }),
      ).toThrow(BadRequestException);
    });

    it('rejeita período explícito maior que o máximo permitido', () => {
      expect(() =>
        service.resolvePeriod('America/Sao_Paulo', { from: '2026-01-01', to: '2026-12-31' }),
      ).toThrow(BadRequestException);
    });

    it('resolve corretamente num timezone com DST (America/New_York, transição de 2026-03-08)', () => {
      // Em 2026, DST em NY começa em 8/mar (UTC-5 -> UTC-4).
      const before = service.resolvePeriod('America/New_York', {
        from: '2026-02-01',
        to: '2026-02-01',
      });
      expect(before.from.toISOString()).toBe('2026-02-01T05:00:00.000Z'); // UTC-5

      const after = service.resolvePeriod('America/New_York', {
        from: '2026-03-15',
        to: '2026-03-15',
      });
      expect(after.from.toISOString()).toBe('2026-03-15T04:00:00.000Z'); // UTC-4, não UTC-5 fixo
    });
  });

  describe('previousPeriod', () => {
    it('devolve o período imediatamente anterior, com a mesma duração', () => {
      const current = service.resolvePeriod('America/Sao_Paulo', {
        from: '2026-08-14',
        to: '2026-08-20',
      });
      const previous = service.previousPeriod(current, 'America/Sao_Paulo');
      expect(previous.fromLabel).toBe('2026-08-07');
      expect(previous.toLabel).toBe('2026-08-13');
    });
  });

  // Um único dia civil (2026-08-20, quinta) em São Paulo (UTC-3) — meia-noite
  // local é 03:00 UTC (mesma convenção do dashboard.service.spec.ts).
  const singleDaySP = {
    from: new Date('2026-08-20T03:00:00.000Z'),
    to: new Date('2026-08-21T03:00:00.000Z'),
    fromLabel: '2026-08-20',
    toLabel: '2026-08-20',
  };

  describe('getMetrics — resumo', () => {
    const period = singleDaySP;

    it('consulta Booking cruzando todas as quadras da arena numa única chamada (sem N+1)', async () => {
      await service.getMetrics('arena-1', period);
      expect(prisma.booking.findMany).toHaveBeenCalledTimes(1);
      const [[call]] = prisma.booking.findMany.mock.calls as [
        [{ where: { court: { arenaId: string } } }],
      ];
      expect(call.where.court).toEqual({ arenaId: 'arena-1' });
    });

    it('separa CUSTOMER confirmado/cancelado, BLOCK e MAINTENANCE', async () => {
      prisma.booking.findMany.mockResolvedValue([
        booking({ id: 'b1', type: BookingType.CUSTOMER, status: BookingStatus.CONFIRMED }),
        booking({ id: 'b2', type: BookingType.CUSTOMER, status: BookingStatus.CONFIRMED }),
        booking({ id: 'b3', type: BookingType.CUSTOMER, status: BookingStatus.CANCELLED }),
        booking({ id: 'b4', type: BookingType.BLOCK, status: BookingStatus.CONFIRMED }),
        booking({ id: 'b5', type: BookingType.MAINTENANCE, status: BookingStatus.CONFIRMED }),
      ]);

      const result = await service.getMetrics('arena-1', period);

      expect(result.summary.confirmedBookings).toBe(2);
      expect(result.summary.cancelledBookings).toBe(1);
      expect(result.summary.blocks).toBe(1);
      expect(result.summary.maintenance).toBe(1);
      expect(result.summary.customerBookings).toBe(3);
    });

    it('receita estimada soma só total de CUSTOMER+CONFIRMED — nunca BLOCK/MAINTENANCE/CANCELLED', async () => {
      prisma.booking.findMany.mockResolvedValue([
        booking({
          id: 'b1',
          type: BookingType.CUSTOMER,
          status: BookingStatus.CONFIRMED,
          total: 100,
        }),
        booking({
          id: 'b2',
          type: BookingType.CUSTOMER,
          status: BookingStatus.CONFIRMED,
          total: 50,
        }),
        booking({
          id: 'b3',
          type: BookingType.CUSTOMER,
          status: BookingStatus.CANCELLED,
          total: 100,
        }),
        booking({ id: 'b4', type: BookingType.BLOCK, status: BookingStatus.CONFIRMED, total: 0 }),
        booking({
          id: 'b5',
          type: BookingType.MAINTENANCE,
          status: BookingStatus.CONFIRMED,
          total: 0,
        }),
      ]);

      const result = await service.getMetrics('arena-1', period);

      expect(result.summary.estimatedRevenue).toBe(150);
    });

    it('quadra inativa não conta na capacidade nem na receita do resumo', async () => {
      courtsService.findAllForArena.mockResolvedValue([courtActive1]); // court-2 não é ativa
      prisma.booking.findMany.mockResolvedValue([
        booking({ id: 'b1', courtId: 'court-1', total: 100 }),
        booking({ id: 'b2', courtId: 'court-2', total: 999 }), // quadra inativa
      ]);

      const result = await service.getMetrics('arena-1', period);

      expect(result.summary.estimatedRevenue).toBe(100);
      expect(result.courts.map((c) => c.courtId)).toEqual(['court-1']);
    });

    it('ocupação null quando não há horário de funcionamento configurado (nunca 0 forjado)', async () => {
      operatingHoursService.getRawIntervalsForArena.mockResolvedValue([]);
      prisma.booking.findMany.mockResolvedValue([booking()]);

      const result = await service.getMetrics('arena-1', period);

      expect(result.summary.occupancyRate).toBeNull();
      expect(result.courts.every((c) => c.occupancyRate === null)).toBe(true);
    });

    it('calcula ocupação por quadra corretamente (minutos ocupados / minutos operacionais)', async () => {
      // Quinta 08:00-22:00 = 840 minutos operacionais por quadra no dia.
      // court-1: uma reserva de 60 minutos confirmada.
      prisma.booking.findMany.mockResolvedValue([
        booking({ id: 'b1', courtId: 'court-1', status: BookingStatus.CONFIRMED }),
      ]);

      const result = await service.getMetrics('arena-1', period);

      const court1 = result.courts.find((c) => c.courtId === 'court-1');
      expect(court1?.occupancyRate).toBeCloseTo(60 / 840, 5);
      const court2 = result.courts.find((c) => c.courtId === 'court-2');
      expect(court2?.occupancyRate).toBe(0);
    });

    it('identifica a quadra mais e menos ocupada', async () => {
      prisma.booking.findMany.mockResolvedValue([
        booking({ id: 'b1', courtId: 'court-1', status: BookingStatus.CONFIRMED }),
        booking({
          id: 'b2',
          courtId: 'court-2',
          status: BookingStatus.CONFIRMED,
          startsAt: new Date('2026-08-20T13:00:00.000Z'),
          endsAt: new Date('2026-08-20T15:00:00.000Z'), // 2h, o dobro de court-1
        }),
      ]);

      const result = await service.getMetrics('arena-1', period);

      expect(result.mostOccupiedCourtName).toBe('Quadra 2');
      expect(result.leastOccupiedCourtName).toBe('Quadra 1');
    });
  });

  describe('getMetrics — demanda', () => {
    const period = singleDaySP;

    it('identifica hora de pico e hora de menor demanda dentro do horário de funcionamento', async () => {
      prisma.booking.findMany.mockResolvedValue([
        // 10:00 local (13:00 UTC) — 2 reservas.
        booking({
          id: 'b1',
          startsAt: new Date('2026-08-20T13:00:00.000Z'),
          endsAt: new Date('2026-08-20T14:00:00.000Z'),
        }),
        booking({
          id: 'b2',
          courtId: 'court-2',
          startsAt: new Date('2026-08-20T13:00:00.000Z'),
          endsAt: new Date('2026-08-20T14:00:00.000Z'),
        }),
        // 18:00 local (21:00 UTC) — 1 reserva.
        booking({
          id: 'b3',
          startsAt: new Date('2026-08-20T21:00:00.000Z'),
          endsAt: new Date('2026-08-20T22:00:00.000Z'),
        }),
      ]);

      const result = await service.getMetrics('arena-1', period);

      expect(result.demand.peakHour).toBe(10);
      // 08:00 é um horário aberto sem nenhuma reserva — é o de menor demanda.
      expect(result.demand.lowestHour).toBe(8);
    });

    it('busiestDay reflete o dia com mais reservas CUSTOMER confirmadas no período', async () => {
      const twoDayPeriod = {
        from: new Date('2026-08-20T03:00:00.000Z'),
        to: new Date('2026-08-22T03:00:00.000Z'),
        fromLabel: '2026-08-20',
        toLabel: '2026-08-21',
      };
      prisma.booking.findMany.mockResolvedValue([
        booking({
          id: 'b1',
          startsAt: new Date('2026-08-20T13:00:00.000Z'),
          endsAt: new Date('2026-08-20T14:00:00.000Z'),
        }),
        booking({
          id: 'b2',
          startsAt: new Date('2026-08-21T13:00:00.000Z'),
          endsAt: new Date('2026-08-21T14:00:00.000Z'),
        }),
        booking({
          id: 'b3',
          courtId: 'court-2',
          startsAt: new Date('2026-08-21T15:00:00.000Z'),
          endsAt: new Date('2026-08-21T16:00:00.000Z'),
        }),
      ]);

      const result = await service.getMetrics('arena-1', twoDayPeriod);

      expect(result.demand.busiestDay).toBe('2026-08-21');
    });
  });

  describe('buildComparison', () => {
    it('calcula deltas percentuais current vs. previous', async () => {
      const period = singleDaySP;
      prisma.booking.findMany.mockResolvedValueOnce([booking({ id: 'b1' }), booking({ id: 'b2' })]);
      const current = await service.getMetrics('arena-1', period);

      prisma.booking.findMany.mockResolvedValueOnce([booking({ id: 'b3' })]);
      const previous = await service.getMetrics('arena-1', period);

      const comparison = service.buildComparison(current, previous);
      expect(comparison.confirmedBookingsDeltaPct).toBeCloseTo(100, 5); // 1 -> 2 reservas
    });

    it('delta é null quando o período anterior não tem base de comparação (0)', async () => {
      const period = singleDaySP;
      prisma.booking.findMany.mockResolvedValueOnce([booking({ id: 'b1' })]);
      const current = await service.getMetrics('arena-1', period);

      prisma.booking.findMany.mockResolvedValueOnce([]);
      const previous = await service.getMetrics('arena-1', period);

      const comparison = service.buildComparison(current, previous);
      expect(comparison.confirmedBookingsDeltaPct).toBeNull();
    });
  });
});
