import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingStatus, BookingType, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { CourtsService } from '../courts/courts.service';
import { OperatingHoursService } from '../operating-hours/operating-hours.service';
import { OperatingInterval, weekdayFromIso } from '../operating-hours/operating-hours.util';

// Fase 12: presets mínimos pedidos pelo prompt da fase (item 10) — período
// explícito (from/to) é tratado à parte, nunca misturado com um preset na
// mesma requisição (ver AskAiDto). `thisMonth`/`lastMonth` adicionados na
// Fase 15 (Relatórios) — extensão aditiva, centralizada aqui: os presets
// anteriores continuam com o mesmo comportamento, e a IA (que valida contra
// sua própria lista fixa em AskAiPeriodDto) nem precisa saber que eles
// existem.
export type PeriodPreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth';

const MAX_EXPLICIT_RANGE_DAYS = 92;

export interface ResolvedPeriod {
  /** Instante UTC inclusivo, sempre meia-noite LOCAL da arena (nunca do servidor). */
  from: Date;
  /** Instante UTC exclusivo, sempre meia-noite LOCAL da arena. */
  to: Date;
  /** Primeiro dia civil incluído, no timezone da arena (YYYY-MM-DD). */
  fromLabel: string;
  /** Último dia civil incluído, no timezone da arena (YYYY-MM-DD) — inclusive, diferente de `to`. */
  toLabel: string;
}

export interface CourtMetric {
  courtId: string;
  courtName: string;
  confirmedBookings: number;
  cancelledBookings: number;
  /** 0-1, ou null se não há capacidade operacional mensurável no período (Fase 12, item 26). */
  occupancyRate: number | null;
  estimatedRevenue: number;
}

export interface DemandBucket {
  /** Hora local (0-23) da arena. */
  hour: number;
  count: number;
}

export interface DayBucket {
  /** YYYY-MM-DD local da arena. */
  date: string;
  count: number;
}

export interface MetricsSummary {
  customerBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  blocks: number;
  maintenance: number;
  estimatedRevenue: number;
  occupancyRate: number | null;
}

export interface DemandMetrics {
  bookingsByHour: DemandBucket[];
  peakHour: number | null;
  lowestHour: number | null;
  bookingsByDay: DayBucket[];
  busiestDay: string | null;
}

// Fase 15 (Relatórios): um ponto da série temporal — mesmas definições da
// Fase 12 (receita só CUSTOMER+CONFIRMED, ocupação null quando não há
// capacidade mensurável naquele dia específico), nunca uma fórmula nova.
export interface DailyMetric {
  /** YYYY-MM-DD local da arena. */
  date: string;
  confirmedBookings: number;
  cancelledBookings: number;
  estimatedRevenue: number;
  /** 0-1, ou null se não há horário de funcionamento configurado NESTE dia. */
  occupancyRate: number | null;
}

export interface OperationalMetrics {
  period: ResolvedPeriod;
  summary: MetricsSummary;
  courts: CourtMetric[];
  demand: DemandMetrics;
  mostOccupiedCourtName: string | null;
  leastOccupiedCourtName: string | null;
  /** Fase 15: evolução dia a dia dentro do período — mesmos números do `summary`, quebrados por data. */
  dailySeries: DailyMetric[];
}

export interface PeriodComparison {
  previous: ResolvedPeriod;
  previousSummary: MetricsSummary;
  /** Delta percentual current→previous, null quando previous é 0 (divisão indefinida — nunca inventado). */
  confirmedBookingsDeltaPct: number | null;
  /** Fase 15: mesma regra — null quando não há base de comparação. */
  cancelledBookingsDeltaPct: number | null;
  occupancyRateDeltaPct: number | null;
  revenueDeltaPct: number | null;
}

type BookingRow = {
  id: string;
  courtId: string;
  type: BookingType;
  status: BookingStatus;
  startsAt: Date;
  endsAt: Date;
  total: Prisma.Decimal;
};

// Delta percentual previous→current. `null` (nunca 0 ou Infinity) quando
// `previous` é 0 ou nulo — "aumento de X%" não tem significado sem uma base
// de comparação real (item 26: não aproximar silenciosamente).
function percentDelta(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null || previous === 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

const bookingSelect = {
  id: true,
  courtId: true,
  type: true,
  status: true,
  startsAt: true,
  endsAt: true,
  total: true,
} satisfies Prisma.BookingSelect;

/**
 * Camada de domínio para métricas operacionais (Fase 12). Calcula tudo
 * direto do PostgreSQL/Prisma, sempre filtrado por arenaId — a IA nunca vê
 * nada que não passe por aqui primeiro (ver docs/ARCHITECTURE.md, Fase 12,
 * "Decisão arquitetural chave"). Nenhum resultado é uma "estimativa de IA":
 * todo número é uma agregação determinística de dados reais.
 */
@Injectable()
export class OperationalMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courtsService: CourtsService,
    private readonly operatingHoursService: OperatingHoursService,
  ) {}

  resolvePeriod(
    timezone: string,
    input: { preset?: PeriodPreset; from?: string; to?: string } | undefined,
  ): ResolvedPeriod {
    const now = DateTime.now().setZone(timezone);
    const startOfToday = now.startOf('day');

    if (input?.from || input?.to) {
      if (!input.from || !input.to) {
        throw new BadRequestException('period.from e period.to devem ser informados juntos.');
      }
      if (input.preset) {
        throw new BadRequestException('Use period.preset OU period.from/period.to, nunca os dois.');
      }
      const fromDt = DateTime.fromISO(input.from, { zone: timezone }).startOf('day');
      const toDt = DateTime.fromISO(input.to, { zone: timezone }).startOf('day');
      if (!fromDt.isValid || !toDt.isValid) {
        throw new BadRequestException('period.from/period.to inválidos (esperado YYYY-MM-DD).');
      }
      if (toDt < fromDt) {
        throw new BadRequestException('period.to deve ser igual ou posterior a period.from.');
      }
      const rangeDays = toDt.diff(fromDt, 'days').days + 1;
      if (rangeDays > MAX_EXPLICIT_RANGE_DAYS) {
        throw new BadRequestException(
          `Período máximo permitido é de ${MAX_EXPLICIT_RANGE_DAYS} dias.`,
        );
      }
      return this.toResolvedPeriod(fromDt, toDt.plus({ days: 1 }));
    }

    const preset = input?.preset ?? 'last7days';
    switch (preset) {
      case 'today':
        return this.toResolvedPeriod(startOfToday, startOfToday.plus({ days: 1 }));
      case 'yesterday':
        return this.toResolvedPeriod(startOfToday.minus({ days: 1 }), startOfToday);
      case 'last7days':
        return this.toResolvedPeriod(
          startOfToday.minus({ days: 6 }),
          startOfToday.plus({ days: 1 }),
        );
      case 'last30days':
        return this.toResolvedPeriod(
          startOfToday.minus({ days: 29 }),
          startOfToday.plus({ days: 1 }),
        );
      case 'thisWeek': {
        const start = now.startOf('week');
        return this.toResolvedPeriod(start, start.plus({ weeks: 1 }));
      }
      case 'lastWeek': {
        const start = now.startOf('week').minus({ weeks: 1 });
        return this.toResolvedPeriod(start, start.plus({ weeks: 1 }));
      }
      case 'thisMonth': {
        const start = now.startOf('month');
        return this.toResolvedPeriod(start, start.plus({ months: 1 }));
      }
      case 'lastMonth': {
        const start = now.startOf('month').minus({ months: 1 });
        return this.toResolvedPeriod(start, start.plus({ months: 1 }));
      }
      default:
        throw new BadRequestException(`period.preset inválido: ${String(preset)}`);
    }
  }

  /** Período imediatamente anterior, com a mesma duração (Fase 12, item 27 — comparações). */
  previousPeriod(period: ResolvedPeriod, timezone: string): ResolvedPeriod {
    const fromDt = DateTime.fromJSDate(period.from, { zone: timezone });
    const toDt = DateTime.fromJSDate(period.to, { zone: timezone });
    const durationMs = toDt.toMillis() - fromDt.toMillis();
    const previousTo = fromDt;
    const previousFrom = DateTime.fromMillis(fromDt.toMillis() - durationMs, { zone: timezone });
    return this.toResolvedPeriod(previousFrom, previousTo);
  }

  async getMetrics(arenaId: string, period: ResolvedPeriod): Promise<OperationalMetrics> {
    const arena = await this.prisma.arena.findUniqueOrThrow({
      where: { id: arenaId },
      select: { timezone: true },
    });

    const [activeCourts, intervals, bookings] = await Promise.all([
      this.courtsService.findAllForArena(arenaId, false),
      this.operatingHoursService.getRawIntervalsForArena(arenaId),
      this.prisma.booking.findMany({
        where: { court: { arenaId }, startsAt: { lt: period.to }, endsAt: { gt: period.from } },
        select: bookingSelect,
        orderBy: { startsAt: 'asc' },
      }),
    ]);

    const activeCourtIds = new Set(activeCourts.map((court) => court.id));

    const operationalMinutesPerCourt = this.operationalMinutes(arena.timezone, intervals, period);

    const byCourtId = new Map<string, BookingRow[]>();
    for (const booking of bookings) {
      const list = byCourtId.get(booking.courtId) ?? [];
      list.push(booking);
      byCourtId.set(booking.courtId, list);
    }

    const courtMetrics: CourtMetric[] = activeCourts.map((court) =>
      this.buildCourtMetric(
        court.id,
        court.name,
        byCourtId.get(court.id) ?? [],
        operationalMinutesPerCourt,
      ),
    );

    const summary = this.buildSummary(bookings, activeCourtIds, operationalMinutesPerCourt);
    const demand = this.buildDemand(arena.timezone, bookings, intervals, period);
    const dailySeries = this.buildDailySeries(
      arena.timezone,
      bookings,
      activeCourtIds,
      intervals,
      period,
    );

    const rankable = courtMetrics.filter((c) => c.occupancyRate !== null);
    const mostOccupied = rankable.length
      ? [...rankable].sort((a, b) => (b.occupancyRate ?? 0) - (a.occupancyRate ?? 0))[0]
      : undefined;
    const leastOccupied = rankable.length
      ? [...rankable].sort((a, b) => (a.occupancyRate ?? 0) - (b.occupancyRate ?? 0))[0]
      : undefined;

    return {
      period,
      summary,
      courts: courtMetrics,
      demand,
      mostOccupiedCourtName: mostOccupied?.courtName ?? null,
      leastOccupiedCourtName: leastOccupied?.courtName ?? null,
      dailySeries,
    };
  }

  /**
   * Compara o período atual com o imediatamente anterior (Fase 12, item 27)
   * — o backend calcula os deltas prontos; a IA nunca precisa (nem deve)
   * fazer essa conta sozinha a partir de texto bruto.
   */
  buildComparison(current: OperationalMetrics, previous: OperationalMetrics): PeriodComparison {
    return {
      previous: previous.period,
      previousSummary: previous.summary,
      confirmedBookingsDeltaPct: percentDelta(
        previous.summary.confirmedBookings,
        current.summary.confirmedBookings,
      ),
      cancelledBookingsDeltaPct: percentDelta(
        previous.summary.cancelledBookings,
        current.summary.cancelledBookings,
      ),
      occupancyRateDeltaPct: percentDelta(
        previous.summary.occupancyRate,
        current.summary.occupancyRate,
      ),
      revenueDeltaPct: percentDelta(
        previous.summary.estimatedRevenue,
        current.summary.estimatedRevenue,
      ),
    };
  }

  private toResolvedPeriod(from: DateTime, to: DateTime): ResolvedPeriod {
    return {
      from: from.toUTC().toJSDate(),
      to: to.toUTC().toJSDate(),
      fromLabel: from.toFormat('yyyy-MM-dd'),
      toLabel: to.minus({ days: 1 }).toFormat('yyyy-MM-dd'),
    };
  }

  /**
   * Minutos operacionais totais no período, POR QUADRA ATIVA — horário de
   * funcionamento é da Arena, não da Court (Fase 5), então o total é igual
   * para todas as quadras ativas. Soma a duração dos intervalos configurados
   * para cada dia da semana que aparece no período (item 26 do prompt da
   * fase: nunca aproximar silenciosamente). Implementado como a soma do mapa
   * por-dia (Fase 15) — mesmo cálculo de sempre, só reaproveitado em vez de
   * duplicado.
   */
  private operationalMinutes(
    timezone: string,
    intervals: OperatingInterval[],
    period: ResolvedPeriod,
  ): number {
    let total = 0;
    for (const minutes of this.operationalMinutesByDay(timezone, intervals, period).values()) {
      total += minutes;
    }
    return total;
  }

  /**
   * Fase 15: o mesmo cálculo acima, mas por dia — necessário pra série
   * temporal (`dailySeries`), onde a ocupação de CADA dia precisa do próprio
   * denominador (dias sem nenhum intervalo configurado têm 0 minutos, o que
   * vira `occupancyRate: null` naquele ponto da série, nunca `0%` forjado).
   */
  private operationalMinutesByDay(
    timezone: string,
    intervals: OperatingInterval[],
    period: ResolvedPeriod,
  ): Map<string, number> {
    const result = new Map<string, number>();
    let day = DateTime.fromJSDate(period.from, { zone: timezone }).startOf('day');
    const end = DateTime.fromJSDate(period.to, { zone: timezone });
    while (day < end) {
      const weekday = weekdayFromIso(day.weekday);
      let minutes = 0;
      for (const interval of intervals) {
        if (interval.dayOfWeek === weekday) {
          minutes += interval.closesAt - interval.opensAt;
        }
      }
      result.set(day.toFormat('yyyy-MM-dd'), minutes);
      day = day.plus({ days: 1 });
    }
    return result;
  }

  private buildCourtMetric(
    courtId: string,
    courtName: string,
    bookings: BookingRow[],
    operationalMinutes: number,
  ): CourtMetric {
    const confirmedCustomer = bookings.filter(
      (b) => b.type === BookingType.CUSTOMER && b.status === BookingStatus.CONFIRMED,
    );
    const cancelledCustomer = bookings.filter(
      (b) => b.type === BookingType.CUSTOMER && b.status === BookingStatus.CANCELLED,
    );

    // Duração real (endsAt-startsAt) de cada reserva confirmada — nunca
    // slotDuration nominal, para tolerar eventuais reservas de duração
    // diferente no histórico. Sem overnight (Fase 5), então nunca cruza a
    // fronteira de um dia — não precisa de recorte contra o período.
    const occupiedMinutes = confirmedCustomer.reduce(
      (sum, b) => sum + (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000,
      0,
    );

    const estimatedRevenue = confirmedCustomer.reduce((sum, b) => sum + Number(b.total), 0);

    return {
      courtId,
      courtName,
      confirmedBookings: confirmedCustomer.length,
      cancelledBookings: cancelledCustomer.length,
      occupancyRate: operationalMinutes > 0 ? occupiedMinutes / operationalMinutes : null,
      estimatedRevenue,
    };
  }

  private buildSummary(
    bookings: BookingRow[],
    activeCourtIds: Set<string>,
    operationalMinutesPerCourt: number,
  ): MetricsSummary {
    // Só reservas de quadras ATIVAS entram no resumo — uma quadra inativa
    // não representa capacidade operacional real (mesmo critério do
    // AvailabilityService, Fase 4/5).
    const activeBookings = bookings.filter((b) => activeCourtIds.has(b.courtId));

    const confirmedCustomer = activeBookings.filter(
      (b) => b.type === BookingType.CUSTOMER && b.status === BookingStatus.CONFIRMED,
    );
    const cancelledCustomer = activeBookings.filter(
      (b) => b.type === BookingType.CUSTOMER && b.status === BookingStatus.CANCELLED,
    );
    const blocks = activeBookings.filter(
      (b) => b.type === BookingType.BLOCK && b.status === BookingStatus.CONFIRMED,
    );
    const maintenance = activeBookings.filter(
      (b) => b.type === BookingType.MAINTENANCE && b.status === BookingStatus.CONFIRMED,
    );

    const totalOperationalMinutes = operationalMinutesPerCourt * activeCourtIds.size;
    const totalOccupiedMinutes = confirmedCustomer.reduce(
      (sum, b) => sum + (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000,
      0,
    );

    return {
      customerBookings: confirmedCustomer.length + cancelledCustomer.length,
      confirmedBookings: confirmedCustomer.length,
      cancelledBookings: cancelledCustomer.length,
      blocks: blocks.length,
      maintenance: maintenance.length,
      estimatedRevenue: confirmedCustomer.reduce((sum, b) => sum + Number(b.total), 0),
      occupancyRate:
        totalOperationalMinutes > 0 ? totalOccupiedMinutes / totalOperationalMinutes : null,
    };
  }

  private buildDemand(
    timezone: string,
    bookings: BookingRow[],
    intervals: OperatingInterval[],
    period: ResolvedPeriod,
  ): DemandMetrics {
    // Só as horas que caem em algum intervalo de funcionamento configurado
    // para algum dia do período entram nos buckets — "horário de menor
    // demanda" inclui horas com zero reservas (é justamente o dado útil
    // pra "existe horário vazio pra promoção?", item do prompt da fase),
    // mas nunca uma hora em que a arena nem abre.
    const candidateHours = new Set<number>();
    let day = DateTime.fromJSDate(period.from, { zone: timezone }).startOf('day');
    const end = DateTime.fromJSDate(period.to, { zone: timezone });
    const daysInPeriod: string[] = [];
    while (day < end) {
      daysInPeriod.push(day.toFormat('yyyy-MM-dd'));
      const weekday = weekdayFromIso(day.weekday);
      for (const interval of intervals) {
        if (interval.dayOfWeek === weekday) {
          const startHour = Math.floor(interval.opensAt / 60);
          const endHour = Math.ceil(interval.closesAt / 60);
          for (let h = startHour; h < endHour; h++) {
            candidateHours.add(h);
          }
        }
      }
      day = day.plus({ days: 1 });
    }

    const hourCounts = new Map<number, number>();
    for (const hour of candidateHours) {
      hourCounts.set(hour, 0);
    }
    const dayCounts = new Map<string, number>();
    for (const dateLabel of daysInPeriod) {
      dayCounts.set(dateLabel, 0);
    }

    for (const booking of bookings) {
      if (booking.type !== BookingType.CUSTOMER || booking.status !== BookingStatus.CONFIRMED) {
        continue;
      }
      const local = DateTime.fromJSDate(booking.startsAt, { zone: timezone });
      const hour = local.hour;
      if (hourCounts.has(hour)) {
        hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
      }
      const dateLabel = local.toFormat('yyyy-MM-dd');
      if (dayCounts.has(dateLabel)) {
        dayCounts.set(dateLabel, (dayCounts.get(dateLabel) ?? 0) + 1);
      }
    }

    const bookingsByHour = [...hourCounts.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour);
    const bookingsByDay = [...dayCounts.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const peakHour = bookingsByHour.length
      ? [...bookingsByHour].sort((a, b) => b.count - a.count || a.hour - b.hour)[0]!.hour
      : null;
    const lowestHour = bookingsByHour.length
      ? [...bookingsByHour].sort((a, b) => a.count - b.count || a.hour - b.hour)[0]!.hour
      : null;
    const busiestDay = bookingsByDay.length
      ? [...bookingsByDay].sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))[0]!
          .date
      : null;

    return { bookingsByHour, peakHour, lowestHour, bookingsByDay, busiestDay };
  }

  /**
   * Fase 15 (Relatórios): evolução dia a dia dentro do período — as MESMAS
   * regras de `buildSummary`/`buildCourtMetric` (receita só CUSTOMER+
   * CONFIRMED, ocupação = minutos ocupados ÷ minutos operacionais só de
   * quadras ativas, `null` — nunca `0` — quando não há horário configurado
   * naquele dia específico), só que uma linha por dia em vez de agregado no
   * período inteiro.
   */
  private buildDailySeries(
    timezone: string,
    bookings: BookingRow[],
    activeCourtIds: Set<string>,
    intervals: OperatingInterval[],
    period: ResolvedPeriod,
  ): DailyMetric[] {
    const minutesByDay = this.operationalMinutesByDay(timezone, intervals, period);

    type DayAccumulator = {
      confirmed: number;
      cancelled: number;
      revenue: number;
      occupiedMinutes: number;
    };
    const byDay = new Map<string, DayAccumulator>();
    for (const date of minutesByDay.keys()) {
      byDay.set(date, { confirmed: 0, cancelled: 0, revenue: 0, occupiedMinutes: 0 });
    }

    for (const booking of bookings) {
      if (booking.type !== BookingType.CUSTOMER || !activeCourtIds.has(booking.courtId)) {
        continue;
      }
      // Sem overnight (Fase 5) — startsAt/endsAt sempre no mesmo dia civil,
      // então o dia local de startsAt já identifica a linha certa.
      const dateLabel = DateTime.fromJSDate(booking.startsAt, { zone: timezone }).toFormat(
        'yyyy-MM-dd',
      );
      const accumulator = byDay.get(dateLabel);
      if (!accumulator) continue;

      if (booking.status === BookingStatus.CONFIRMED) {
        accumulator.confirmed += 1;
        accumulator.revenue += Number(booking.total);
        accumulator.occupiedMinutes +=
          (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000;
      } else if (booking.status === BookingStatus.CANCELLED) {
        accumulator.cancelled += 1;
      }
    }

    return [...minutesByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, operationalMinutesThatDay]) => {
        const accumulator = byDay.get(date)!;
        const operationalMinutesAllCourts = operationalMinutesThatDay * activeCourtIds.size;
        return {
          date,
          confirmedBookings: accumulator.confirmed,
          cancelledBookings: accumulator.cancelled,
          estimatedRevenue: accumulator.revenue,
          occupancyRate:
            operationalMinutesAllCourts > 0
              ? accumulator.occupiedMinutes / operationalMinutesAllCourts
              : null,
        };
      });
  }
}
