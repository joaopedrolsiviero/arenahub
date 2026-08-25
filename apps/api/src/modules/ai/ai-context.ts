import { OperationalMetrics, PeriodComparison } from './operational-metrics.service';

// Objeto estruturado enviado ao LLM (Fase 12, item 12) — nunca o banco
// inteiro, nunca PII (nome/e-mail/telefone/ClerkId de cliente), nunca ID
// interno (cuid) de nada. Só nomes de exibição (arena, quadra) e números já
// agregados pelo backend — o modelo interpreta, nunca calcula por conta
// própria (item 8/37 do prompt da fase).
export interface AiContext {
  arena: { name: string; timezone: string };
  period: { from: string; to: string };
  summary: {
    customerBookings: number;
    confirmedBookings: number;
    cancelledBookings: number;
    blocks: number;
    maintenance: number;
    estimatedRevenueBRL: number;
    occupancyRatePct: number | null;
  };
  courts: {
    name: string;
    confirmedBookings: number;
    cancelledBookings: number;
    occupancyRatePct: number | null;
    estimatedRevenueBRL: number;
  }[];
  demand: {
    peakHour: string | null;
    lowestHour: string | null;
    busiestDay: string | null;
    bookingsByHour: { hour: string; count: number }[];
  };
  mostOccupiedCourt: string | null;
  leastOccupiedCourt: string | null;
  comparisonToPreviousPeriod: {
    previousPeriod: { from: string; to: string };
    confirmedBookings: number;
    occupancyRatePct: number | null;
    estimatedRevenueBRL: number;
    confirmedBookingsDeltaPct: number | null;
    occupancyRateDeltaPct: number | null;
    revenueDeltaPct: number | null;
  };
}

function roundPct(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatHour(hour: number | null): string | null {
  return hour === null ? null : `${String(hour).padStart(2, '0')}:00`;
}

export function buildAiContext(
  arena: { name: string; timezone: string },
  metrics: OperationalMetrics,
  comparison: PeriodComparison,
): AiContext {
  return {
    arena,
    period: { from: metrics.period.fromLabel, to: metrics.period.toLabel },
    summary: {
      customerBookings: metrics.summary.customerBookings,
      confirmedBookings: metrics.summary.confirmedBookings,
      cancelledBookings: metrics.summary.cancelledBookings,
      blocks: metrics.summary.blocks,
      maintenance: metrics.summary.maintenance,
      estimatedRevenueBRL: roundMoney(metrics.summary.estimatedRevenue),
      occupancyRatePct: roundPct(
        metrics.summary.occupancyRate === null ? null : metrics.summary.occupancyRate * 100,
      ),
    },
    courts: metrics.courts.map((court) => ({
      name: court.courtName,
      confirmedBookings: court.confirmedBookings,
      cancelledBookings: court.cancelledBookings,
      occupancyRatePct: roundPct(court.occupancyRate === null ? null : court.occupancyRate * 100),
      estimatedRevenueBRL: roundMoney(court.estimatedRevenue),
    })),
    demand: {
      peakHour: formatHour(metrics.demand.peakHour),
      lowestHour: formatHour(metrics.demand.lowestHour),
      busiestDay: metrics.demand.busiestDay,
      bookingsByHour: metrics.demand.bookingsByHour.map((b) => ({
        hour: formatHour(b.hour)!,
        count: b.count,
      })),
    },
    mostOccupiedCourt: metrics.mostOccupiedCourtName,
    leastOccupiedCourt: metrics.leastOccupiedCourtName,
    comparisonToPreviousPeriod: {
      previousPeriod: { from: comparison.previous.fromLabel, to: comparison.previous.toLabel },
      confirmedBookings: comparison.previousSummary.confirmedBookings,
      occupancyRatePct: roundPct(
        comparison.previousSummary.occupancyRate === null
          ? null
          : comparison.previousSummary.occupancyRate * 100,
      ),
      estimatedRevenueBRL: roundMoney(comparison.previousSummary.estimatedRevenue),
      confirmedBookingsDeltaPct: roundPct(comparison.confirmedBookingsDeltaPct),
      occupancyRateDeltaPct: roundPct(comparison.occupancyRateDeltaPct),
      revenueDeltaPct: roundPct(comparison.revenueDeltaPct),
    },
  };
}
