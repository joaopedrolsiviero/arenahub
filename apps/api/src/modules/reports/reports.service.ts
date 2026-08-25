import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationalMetricsService } from '../ai/operational-metrics.service';
import { ReportsQueryDto } from './dto/reports-query.dto';

export interface ReportSummary {
  revenue: number;
  bookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  /** 0-1, ou null quando não há capacidade operacional mensurável no período. */
  occupancyRate: number | null;
}

export interface ReportComparison {
  revenueDeltaPct: number | null;
  confirmedBookingsDeltaPct: number | null;
  cancelledBookingsDeltaPct: number | null;
  occupancyRateDeltaPct: number | null;
}

export interface ReportSeriesPoint {
  date: string;
  revenue: number;
  confirmedBookings: number;
  cancelledBookings: number;
  occupancyRate: number | null;
}

export interface ReportCourtPerformance {
  name: string;
  confirmedBookings: number;
  cancelledBookings: number;
  revenue: number;
  occupancyRate: number | null;
}

export interface ReportDemand {
  bookingsByHour: { hour: number; count: number }[];
  peakHour: number | null;
  lowestHour: number | null;
}

export interface ReportResponse {
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  summary: ReportSummary;
  comparison: ReportComparison;
  series: ReportSeriesPoint[];
  courts: ReportCourtPerformance[];
  mostOccupiedCourtName: string | null;
  leastOccupiedCourtName: string | null;
  demand: ReportDemand;
  busiestDays: { date: string; count: number }[];
}

/**
 * Fase 15 — Relatórios: camada FINA de orquestração/apresentação sobre
 * `OperationalMetricsService`, a mesma fonte de verdade já usada pela IA
 * (Fase 12). Este service não recalcula receita, ocupação, demanda ou
 * comparação — só resolve o período, chama `OperationalMetricsService` (que
 * já busca tudo do Postgres numa única passada, sem N+1) e reformata o
 * resultado pro formato de resposta desta API. Qualquer mudança na
 * DEFINIÇÃO de uma métrica (o que conta como receita, como ocupação é
 * calculada, etc.) acontece em `OperationalMetricsService`, nunca aqui —
 * garantindo que IA e Relatórios nunca divirjam.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: OperationalMetricsService,
  ) {}

  async getReport(arenaId: string, query: ReportsQueryDto): Promise<ReportResponse> {
    const arena = await this.prisma.arena.findUniqueOrThrow({
      where: { id: arenaId },
      select: { timezone: true },
    });

    const period = this.metricsService.resolvePeriod(arena.timezone, query);
    const previousPeriod = this.metricsService.previousPeriod(period, arena.timezone);

    const [metrics, previousMetrics] = await Promise.all([
      this.metricsService.getMetrics(arenaId, period),
      this.metricsService.getMetrics(arenaId, previousPeriod),
    ]);

    const comparison = this.metricsService.buildComparison(metrics, previousMetrics);

    // Top 5 dias mais movimentados — reshape puro de `demand.bookingsByDay`
    // (já calculado por OperationalMetricsService), nunca uma nova consulta.
    const busiestDays = [...metrics.demand.bookingsByDay]
      .filter((d) => d.count > 0)
      .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))
      .slice(0, 5);

    return {
      period: { from: metrics.period.fromLabel, to: metrics.period.toLabel },
      previousPeriod: {
        from: previousMetrics.period.fromLabel,
        to: previousMetrics.period.toLabel,
      },
      summary: {
        revenue: metrics.summary.estimatedRevenue,
        bookings: metrics.summary.customerBookings,
        confirmedBookings: metrics.summary.confirmedBookings,
        cancelledBookings: metrics.summary.cancelledBookings,
        occupancyRate: metrics.summary.occupancyRate,
      },
      comparison: {
        revenueDeltaPct: comparison.revenueDeltaPct,
        confirmedBookingsDeltaPct: comparison.confirmedBookingsDeltaPct,
        cancelledBookingsDeltaPct: comparison.cancelledBookingsDeltaPct,
        occupancyRateDeltaPct: comparison.occupancyRateDeltaPct,
      },
      series: metrics.dailySeries.map((point) => ({
        date: point.date,
        revenue: point.estimatedRevenue,
        confirmedBookings: point.confirmedBookings,
        cancelledBookings: point.cancelledBookings,
        occupancyRate: point.occupancyRate,
      })),
      courts: metrics.courts.map((court) => ({
        name: court.courtName,
        confirmedBookings: court.confirmedBookings,
        cancelledBookings: court.cancelledBookings,
        revenue: court.estimatedRevenue,
        occupancyRate: court.occupancyRate,
      })),
      mostOccupiedCourtName: metrics.mostOccupiedCourtName,
      leastOccupiedCourtName: metrics.leastOccupiedCourtName,
      demand: {
        bookingsByHour: metrics.demand.bookingsByHour,
        peakHour: metrics.demand.peakHour,
        lowestHour: metrics.demand.lowestHour,
      },
      busiestDays,
    };
  }
}
