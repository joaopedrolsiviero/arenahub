import { BadRequestException } from '@nestjs/common';
import { BookingStatus, BookingType, Sport, Weekday } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CourtsService } from '../courts/courts.service';
import { OperatingHoursService } from '../operating-hours/operating-hours.service';

describe('DashboardService', () => {
  let prisma: {
    arena: { findUniqueOrThrow: jest.Mock };
    booking: { findMany: jest.Mock };
  };
  let courtsService: { findAllForArena: jest.Mock };
  let operatingHoursService: { getForArena: jest.Mock };
  let service: DashboardService;

  const arena = { id: 'arena-1', name: 'Arena Central', timezone: 'America/Sao_Paulo' };
  const courtActive = {
    id: 'court-1',
    name: 'Quadra 1',
    sport: Sport.BEACH_VOLLEYBALL,
    isActive: true,
  };
  const courtInactive = {
    id: 'court-2',
    name: 'Quadra 2 (desativada)',
    sport: Sport.BEACH_VOLLEYBALL,
    isActive: false,
  };

  function booking(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'booking-1',
      courtId: 'court-1',
      type: BookingType.CUSTOMER,
      status: BookingStatus.CONFIRMED,
      startsAt: new Date('2026-08-20T13:00:00.000Z'),
      endsAt: new Date('2026-08-20T14:00:00.000Z'),
      total: 100,
      reason: null,
      court: { name: 'Quadra 1' },
      user: { id: 'user-1', name: 'Cliente', email: 'cliente@example.com' },
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      arena: { findUniqueOrThrow: jest.fn().mockResolvedValue(arena) },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
    };
    courtsService = {
      findAllForArena: jest.fn().mockResolvedValue([courtActive, courtInactive]),
    };
    operatingHoursService = {
      getForArena: jest.fn().mockResolvedValue([
        { id: 'oh-1', dayOfWeek: Weekday.THURSDAY, opensAt: '08:00', closesAt: '22:00' },
        { id: 'oh-2', dayOfWeek: Weekday.FRIDAY, opensAt: '08:00', closesAt: '22:00' },
      ]),
    };
    service = new DashboardService(
      prisma as unknown as PrismaService,
      courtsService as unknown as CourtsService,
      operatingHoursService as unknown as OperatingHoursService,
    );
  });

  // 2026-08-20 é uma quinta-feira.
  it('resolve a janela do dia inteiro no timezone da arena (não UTC)', async () => {
    await service.getDashboard('arena-1', '2026-08-20');

    const [[call]] = prisma.booking.findMany.mock.calls as [
      [{ where: { startsAt: { lt: Date }; endsAt: { gt: Date } } }],
    ];
    // Meia-noite em São Paulo (UTC-3) é 03:00 UTC.
    expect(call.where.endsAt.gt.toISOString()).toBe('2026-08-20T03:00:00.000Z');
    expect(call.where.startsAt.lt.toISOString()).toBe('2026-08-21T03:00:00.000Z');
  });

  it('sem "date", usa hoje no timezone da arena — não o timezone do servidor/navegador', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T23:30:00.000Z')); // 20:30 em SP
    try {
      const result = await service.getDashboard('arena-1', undefined);
      expect(result.date).toBe('2026-08-20');
    } finally {
      jest.useRealTimers();
    }
  });

  it('funciona corretamente num timezone com DST (America/New_York)', async () => {
    prisma.arena.findUniqueOrThrow.mockResolvedValue({ ...arena, timezone: 'America/New_York' });
    // Em 2026, o DST começa em 8/mar (UTC-5 -> UTC-4). 1/fev ainda é UTC-5.
    await service.getDashboard('arena-1', '2026-02-01');

    const [[call]] = prisma.booking.findMany.mock.calls as [
      [{ where: { startsAt: { lt: Date }; endsAt: { gt: Date } } }],
    ];
    expect(call.where.endsAt.gt.toISOString()).toBe('2026-02-01T05:00:00.000Z'); // UTC-5

    // 15/mar já é UTC-4 (depois da transição) — o mesmo horário local produz
    // um instante UTC diferente, provando que Luxon resolveu o offset certo
    // para cada data, não um offset fixo.
    await service.getDashboard('arena-1', '2026-03-15');
    const [[secondCall]] = prisma.booking.findMany.mock.calls.slice(-1) as [
      [{ where: { startsAt: { lt: Date }; endsAt: { gt: Date } } }],
    ];
    expect(secondCall.where.endsAt.gt.toISOString()).toBe('2026-03-15T04:00:00.000Z'); // UTC-4
  });

  it('rejeita data em formato inválido', async () => {
    await expect(service.getDashboard('arena-1', 'not-a-date')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('consulta Booking cruzando todas as quadras da arena numa única chamada (sem N+1)', async () => {
    await service.getDashboard('arena-1', '2026-08-20');

    expect(prisma.booking.findMany).toHaveBeenCalledTimes(1);
    const [[call]] = prisma.booking.findMany.mock.calls as [
      [{ where: { court: { arenaId: string } } }],
    ];
    expect(call.where.court).toEqual({ arenaId: 'arena-1' });
  });

  it('calcula o resumo diário corretamente (CUSTOMER confirmado/cancelado, BLOCK, MAINTENANCE)', async () => {
    prisma.booking.findMany.mockResolvedValue([
      booking({ id: 'b1', type: BookingType.CUSTOMER, status: BookingStatus.CONFIRMED }),
      booking({ id: 'b2', type: BookingType.CUSTOMER, status: BookingStatus.CONFIRMED }),
      booking({ id: 'b3', type: BookingType.CUSTOMER, status: BookingStatus.CANCELLED }),
      booking({ id: 'b4', type: BookingType.BLOCK, status: BookingStatus.CONFIRMED }),
      booking({ id: 'b5', type: BookingType.MAINTENANCE, status: BookingStatus.CONFIRMED }),
    ]);

    const result = await service.getDashboard('arena-1', '2026-08-20');

    expect(result.summary).toEqual({
      confirmedBookings: 2,
      cancelledBookings: 1,
      blocks: 1,
      maintenance: 1,
    });
  });

  it('agrupa a ocupação por quadra, só reservas CONFIRMED', async () => {
    prisma.booking.findMany.mockResolvedValue([
      booking({ id: 'b1', courtId: 'court-1', status: BookingStatus.CONFIRMED }),
      booking({ id: 'b2', courtId: 'court-1', status: BookingStatus.CANCELLED }),
      booking({ id: 'b3', courtId: 'court-2', status: BookingStatus.CONFIRMED }),
    ]);

    const result = await service.getDashboard('arena-1', '2026-08-20');

    const court1 = result.courts.find((c) => c.id === 'court-1');
    const court2 = result.courts.find((c) => c.id === 'court-2');
    expect(court1?.occupancy.map((b) => b.id)).toEqual(['b1']);
    expect(court2?.occupancy.map((b) => b.id)).toEqual(['b3']);
  });

  it('inclui quadras inativas, marcadas como tal, sem quebrar a resposta', async () => {
    const result = await service.getDashboard('arena-1', '2026-08-20');

    const inactive = result.courts.find((c) => c.id === 'court-2');
    expect(inactive?.isActive).toBe(false);
    expect(inactive?.occupancy).toEqual([]);
  });

  it('filtra operatingHours só para o dia da semana resolvido', async () => {
    const result = await service.getDashboard('arena-1', '2026-08-20'); // quinta

    expect(result.operatingHours).toEqual([
      { id: 'oh-1', dayOfWeek: Weekday.THURSDAY, opensAt: '08:00', closesAt: '22:00' },
    ]);
  });

  it('arena fechada no dia (sem intervalos) retorna operatingHours vazio, não inventa horário', async () => {
    operatingHoursService.getForArena.mockResolvedValue([]);

    const result = await service.getDashboard('arena-1', '2026-08-20');

    expect(result.operatingHours).toEqual([]);
  });

  it('upcomingBookings inclui todos os tipos CONFIRMED do dia, ordenados', async () => {
    prisma.booking.findMany.mockResolvedValue([
      booking({ id: 'b1', type: BookingType.CUSTOMER }),
      booking({ id: 'b2', type: BookingType.BLOCK }),
      booking({ id: 'b3', type: BookingType.CUSTOMER, status: BookingStatus.CANCELLED }),
    ]);

    const result = await service.getDashboard('arena-1', '2026-08-20');

    expect(result.upcomingBookings.map((b) => b.id)).toEqual(['b1', 'b2']);
  });
});
