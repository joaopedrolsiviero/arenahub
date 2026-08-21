import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingStatus, BookingType, Prisma, Sport } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { CourtsService } from '../courts/courts.service';
import { OperatingHoursService } from '../operating-hours/operating-hours.service';
import { OperatingIntervalView, weekdayFromIso } from '../operating-hours/operating-hours.util';

// Item minimamente necessário para operar o dia — nunca a entidade Prisma
// crua (item 60 da Fase 7). `user`/`reason` seguem o mesmo padrão de
// exposição já usado pela visão administrativa de Booking (Fase 4,
// BookingDetailed) — este endpoint já é OWNER/ADMIN-only via
// ArenaAccessGuard, então não há dado novo sendo exposto, só reorganizado.
export interface DashboardBookingItem {
  id: string;
  courtId: string;
  courtName: string;
  type: BookingType;
  status: BookingStatus;
  startsAt: Date;
  endsAt: Date;
  total: Prisma.Decimal;
  reason: string | null;
  user: { id: string; name: string | null; email: string } | null;
}

export interface DashboardCourt {
  id: string;
  name: string;
  sport: Sport;
  isActive: boolean;
  // Só CONFIRMED (um CANCELLED não ocupa a quadra — item 20 da Fase 7),
  // ordenado por startsAt. Não é um grid sintético de slots (isso
  // continua exclusivo do AvailabilityService, item 24) — é a lista real
  // de ocupações do dia, uma "timeline" por quadra.
  occupancy: DashboardBookingItem[];
}

export interface DashboardSummary {
  confirmedBookings: number;
  cancelledBookings: number;
  blocks: number;
  maintenance: number;
}

export interface DashboardResponse {
  arena: { id: string; name: string; timezone: string };
  date: string;
  // Intervalos configurados só para o dia selecionado (não a semana
  // inteira — item 16 da Fase 7, "não retornar dados desnecessários").
  // Lista vazia significa arena fechada nesse dia (item 27).
  operatingHours: OperatingIntervalView[];
  summary: DashboardSummary;
  courts: DashboardCourt[];
  upcomingBookings: DashboardBookingItem[];
}

const bookingSelect = {
  id: true,
  courtId: true,
  type: true,
  status: true,
  startsAt: true,
  endsAt: true,
  total: true,
  reason: true,
  court: { select: { name: true } },
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.BookingSelect;

type RawBooking = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

function toDashboardBookingItem(booking: RawBooking): DashboardBookingItem {
  return {
    id: booking.id,
    courtId: booking.courtId,
    courtName: booking.court.name,
    type: booking.type,
    status: booking.status,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    total: booking.total,
    reason: booking.reason,
    user: booking.user,
  };
}

/**
 * Visão operacional agregada da arena para um dia (Fase 7). Não é um
 * segundo domínio: só reorganiza Arena/Court/ArenaOperatingHours/Booking já
 * existentes para responder "como está minha arena hoje?" numa única
 * chamada, sem N+1 — uma consulta de Booking cruzando TODAS as quadras da
 * arena (`court: { arenaId }`), nunca uma consulta por quadra (item 17).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courtsService: CourtsService,
    private readonly operatingHoursService: OperatingHoursService,
  ) {}

  async getDashboard(arenaId: string, date: string | undefined): Promise<DashboardResponse> {
    // A cadeia de acesso (arena existe + usuário é OWNER/ADMIN) já foi
    // validada pelo ArenaAccessGuard antes de chegar aqui — mesmo padrão de
    // "findUniqueOrThrow" usado por AvailabilityService (item que a Fase 5
    // já estabeleceu).
    const arena = await this.prisma.arena.findUniqueOrThrow({
      where: { id: arenaId },
      select: { id: true, name: true, timezone: true },
    });

    const { dateStr, from, to, weekday } = this.resolveDateWindow(arena.timezone, date);

    const [allIntervals, courts, bookings] = await Promise.all([
      this.operatingHoursService.getForArena(arenaId),
      this.courtsService.findAllForArena(arenaId, true),
      this.prisma.booking.findMany({
        where: { court: { arenaId }, startsAt: { lt: to }, endsAt: { gt: from } },
        select: bookingSelect,
        orderBy: { startsAt: 'asc' },
      }),
    ]);

    const operatingHours = allIntervals.filter((interval) => interval.dayOfWeek === weekday);

    const items = bookings.map(toDashboardBookingItem);
    const confirmed = items.filter((item) => item.status === BookingStatus.CONFIRMED);

    const occupancyByCourtId = new Map<string, DashboardBookingItem[]>();
    for (const item of confirmed) {
      const list = occupancyByCourtId.get(item.courtId) ?? [];
      list.push(item);
      occupancyByCourtId.set(item.courtId, list);
    }

    const dashboardCourts: DashboardCourt[] = courts.map((court) => ({
      id: court.id,
      name: court.name,
      sport: court.sport,
      isActive: court.isActive,
      occupancy: occupancyByCourtId.get(court.id) ?? [],
    }));

    const summary: DashboardSummary = {
      confirmedBookings: confirmed.filter((item) => item.type === BookingType.CUSTOMER).length,
      cancelledBookings: items.filter(
        (item) => item.type === BookingType.CUSTOMER && item.status === BookingStatus.CANCELLED,
      ).length,
      blocks: confirmed.filter((item) => item.type === BookingType.BLOCK).length,
      maintenance: confirmed.filter((item) => item.type === BookingType.MAINTENANCE).length,
    };

    return {
      arena,
      date: dateStr,
      operatingHours,
      summary,
      courts: dashboardCourts,
      upcomingBookings: confirmed,
    };
  }

  private resolveDateWindow(
    timezone: string,
    date: string | undefined,
  ): { dateStr: string; from: Date; to: Date; weekday: ReturnType<typeof weekdayFromIso> } {
    const base = date
      ? DateTime.fromISO(date, { zone: timezone })
      : DateTime.now().setZone(timezone);

    if (!base.isValid) {
      throw new BadRequestException('Data inválida.');
    }

    const startOfDay = base.startOf('day');
    const endOfDay = startOfDay.plus({ days: 1 });

    return {
      dateStr: startOfDay.toFormat('yyyy-MM-dd'),
      from: startOfDay.toUTC().toJSDate(),
      to: endOfDay.toUTC().toJSDate(),
      weekday: weekdayFromIso(startOfDay.weekday),
    };
  }
}
