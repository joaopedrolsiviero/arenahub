'use client';

import { Suspense, use, useState } from 'react';
import { useArenaReport, useDashboard, useMyAdminArenas } from '@/hooks/use-api';
import { DashboardHeader } from '@/components/dashboard-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RequireAuth } from '@/components/require-auth';
import { cn } from '@/lib/utils';
import { formatCurrencyBRL, formatDateLabel, formatDeltaPct, formatPercent } from '@/lib/format';
import type { ReportDemand, ReportPeriodPreset, ReportResponse, ReportSeriesPoint } from '@/lib/types';

const PERIOD_OPTIONS: { value: ReportPeriodPreset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last7days', label: 'Últimos 7 dias' },
  { value: 'last30days', label: 'Últimos 30 dias' },
  { value: 'thisWeek', label: 'Esta semana' },
  { value: 'lastWeek', label: 'Semana passada' },
  { value: 'thisMonth', label: 'Este mês' },
  { value: 'lastMonth', label: 'Mês passado' },
];

function SummaryCard({
  title,
  value,
  delta,
}: {
  title: string;
  value: string;
  delta: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{delta}</p>
      </CardContent>
    </Card>
  );
}

type SeriesValueKey = 'revenue' | 'confirmedBookings' | 'cancelledBookings' | 'occupancyRate';

// Visualização própria em SVG/CSS (sem lib de gráficos — volume de dados
// baixo, no máximo 92 barras, e assim evitamos uma dependência nova só pra
// isso). Cada gráfico vem acompanhado de uma tabela textual equivalente,
// pra nunca depender só da barra pra entender o dado (item de acessibilidade
// do prompt da fase).
function DailySeriesChart({
  title,
  series,
  valueKey,
  formatValue,
  barColorClass,
}: {
  title: string;
  series: ReportSeriesPoint[];
  valueKey: SeriesValueKey;
  formatValue: (value: number) => string;
  barColorClass: string;
}) {
  const numericValues = series
    .map((point) => point[valueKey])
    .filter((value): value is number => value !== null);
  const max = numericValues.length > 0 ? Math.max(...numericValues, 0.0001) : 1;

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="flex h-28 items-end gap-1" aria-hidden="true">
        {series.map((point) => {
          const raw = point[valueKey];
          const isNull = raw === null;
          const heightPct = isNull ? 0 : Math.max((raw / max) * 100, raw > 0 ? 4 : 1);
          return (
            <div key={point.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div
                title={isNull ? `${point.date}: sem expediente configurado` : `${point.date}: ${formatValue(raw)}`}
                className={cn(
                  'w-full rounded-t-sm',
                  isNull ? 'h-1 self-end bg-muted-foreground/25' : barColorClass,
                )}
                style={isNull ? undefined : { height: `${heightPct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">{title}, por dia</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="pr-3 font-medium">
                Data
              </th>
              <th scope="col" className="font-medium">
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.date}>
                <td className="pr-3 py-0.5">{formatDateLabel(point.date)}</td>
                <td className="py-0.5">
                  {point[valueKey] === null ? 'Sem expediente configurado' : formatValue(point[valueKey] as number)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DemandChart({ demand }: { demand: ReportDemand }) {
  const max = Math.max(...demand.bookingsByHour.map((h) => h.count), 1);

  if (demand.bookingsByHour.length === 0) {
    return <EmptyState message="Nenhum horário de funcionamento configurado neste período." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-28 items-end gap-1" aria-hidden="true">
        {demand.bookingsByHour.map((hourBucket) => (
          <div
            key={hourBucket.hour}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1"
          >
            <div
              title={`${hourBucket.hour}h: ${hourBucket.count} reserva(s)`}
              className={cn(
                'w-full rounded-t-sm',
                hourBucket.hour === demand.peakHour
                  ? 'bg-brand'
                  : hourBucket.hour === demand.lowestHour
                    ? 'bg-muted-foreground/30'
                    : 'bg-brand/40',
              )}
              style={{ height: `${Math.max((hourBucket.count / max) * 100, hourBucket.count > 0 ? 6 : 2)}%` }}
            />
            <span className="text-[10px] text-muted-foreground">{hourBucket.hour}h</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Reservas confirmadas por horário</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="pr-3 font-medium">
                Horário
              </th>
              <th scope="col" className="font-medium">
                Reservas
              </th>
            </tr>
          </thead>
          <tbody>
            {demand.bookingsByHour.map((hourBucket) => (
              <tr key={hourBucket.hour}>
                <td className="pr-3 py-0.5">{hourBucket.hour}h</td>
                <td className="py-0.5">{hourBucket.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Horário de pico: {demand.peakHour !== null ? `${demand.peakHour}h` : 'sem dados'} · Menor
        demanda: {demand.lowestHour !== null ? `${demand.lowestHour}h` : 'sem dados'}
      </p>
    </div>
  );
}

function ReportContent({ report }: { report: ReportResponse }) {
  return (
    <div className="flex flex-col gap-5">
      {report.summary.bookings === 0 ? (
        <EmptyState message="Nenhuma reserva neste período — os números abaixo refletem isso." />
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Receita estimada"
          value={formatCurrencyBRL(report.summary.revenue)}
          delta={formatDeltaPct(report.comparison.revenueDeltaPct)}
        />
        <SummaryCard
          title="Reservas confirmadas"
          value={String(report.summary.confirmedBookings)}
          delta={formatDeltaPct(report.comparison.confirmedBookingsDeltaPct)}
        />
        <SummaryCard
          title="Cancelamentos"
          value={String(report.summary.cancelledBookings)}
          delta={formatDeltaPct(report.comparison.cancelledBookingsDeltaPct)}
        />
        <SummaryCard
          title="Ocupação"
          value={formatPercent(report.summary.occupancyRate)}
          delta={formatDeltaPct(report.comparison.occupancyRateDeltaPct)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Evolução diária</CardTitle>
          <CardDescription>
            {formatDateLabel(report.period.from)} até {formatDateLabel(report.period.to)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <DailySeriesChart
            title="Receita"
            series={report.series}
            valueKey="revenue"
            formatValue={formatCurrencyBRL}
            barColorClass="bg-brand"
          />
          <DailySeriesChart
            title="Reservas confirmadas"
            series={report.series}
            valueKey="confirmedBookings"
            formatValue={(value) => String(value)}
            barColorClass="bg-brand/70"
          />
          <DailySeriesChart
            title="Cancelamentos"
            series={report.series}
            valueKey="cancelledBookings"
            formatValue={(value) => String(value)}
            barColorClass="bg-destructive/70"
          />
          <DailySeriesChart
            title="Ocupação"
            series={report.series}
            valueKey="occupancyRate"
            formatValue={(value) => formatPercent(value)}
            barColorClass="bg-brand/50"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Desempenho por quadra</CardTitle>
          {report.mostOccupiedCourtName || report.leastOccupiedCourtName ? (
            <CardDescription>
              {report.mostOccupiedCourtName ? `Mais ocupada: ${report.mostOccupiedCourtName}` : null}
              {report.mostOccupiedCourtName && report.leastOccupiedCourtName ? ' · ' : null}
              {report.leastOccupiedCourtName ? `Menos ocupada: ${report.leastOccupiedCourtName}` : null}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          {report.courts.length === 0 ? (
            <EmptyState message="Nenhuma quadra ativa nesta arena." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Quadra
                    </th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Ocupação
                    </th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Confirmadas
                    </th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Canceladas
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Receita
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.courts.map((court) => (
                    <tr key={court.name} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-medium">{court.name}</td>
                      <td className="py-1.5 pr-3">{formatPercent(court.occupancyRate)}</td>
                      <td className="py-1.5 pr-3">{court.confirmedBookings}</td>
                      <td className="py-1.5 pr-3">{court.cancelledBookings}</td>
                      <td className="py-1.5">{formatCurrencyBRL(court.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demanda por horário</CardTitle>
          <CardDescription>Reservas confirmadas dentro do horário de funcionamento.</CardDescription>
        </CardHeader>
        <CardContent>
          <DemandChart demand={report.demand} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dias mais movimentados</CardTitle>
        </CardHeader>
        <CardContent>
          {report.busiestDays.length === 0 ? (
            <EmptyState message="Nenhum dia com reservas confirmadas neste período." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {report.busiestDays.map((day) => (
                <li key={day.date} className="flex items-center justify-between text-sm">
                  <span>{formatDateLabel(day.date)}</span>
                  <span className="tabular font-medium">
                    {day.count} {day.count === 1 ? 'reserva' : 'reservas'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ReportsView({ arenaId }: { arenaId: string }) {
  const { data: adminArenas } = useMyAdminArenas();
  const { data: dashboard } = useDashboard(arenaId, undefined);

  const [periodSelection, setPeriodSelection] = useState<ReportPeriodPreset | 'custom'>('last7days');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const isCustomPeriod = periodSelection === 'custom';
  const customPeriodReady = !isCustomPeriod || (!!customFrom && !!customTo);

  const { data, isPending, isError } = useArenaReport(customPeriodReady ? arenaId : undefined, {
    ...(isCustomPeriod ? { from: customFrom, to: customTo } : { preset: periodSelection }),
  });

  return (
    <>
      <DashboardHeader
        arenaId={arenaId}
        arenaName={dashboard?.arena.name ?? ''}
        adminArenas={adminArenas ?? []}
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div>
          <h2 className="font-heading text-xl font-bold">Relatórios</h2>
          <p className="text-sm text-muted-foreground">
            Receita, ocupação, reservas e demanda desta arena, com comparação ao período anterior.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-period">Período</Label>
            <select
              id="report-period"
              value={periodSelection}
              onChange={(event) => setPeriodSelection(event.target.value as ReportPeriodPreset | 'custom')}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="custom">Período personalizado</option>
            </select>
          </div>

          {isCustomPeriod ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="report-from">De</Label>
                <Input
                  id="report-from"
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="report-to">Até</Label>
                <Input
                  id="report-to"
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </div>
            </>
          ) : null}
        </div>

        {isPending && customPeriodReady ? <LoadingState label="Carregando relatório…" /> : null}
        {isError ? <ErrorState message="Não foi possível carregar o relatório." /> : null}
        {isCustomPeriod && !customPeriodReady ? (
          <EmptyState message="Escolha as duas datas do período personalizado." />
        ) : null}

        {data ? <ReportContent report={data} /> : null}
      </div>
    </>
  );
}

export default function RelatoriosPage({ params }: { params: Promise<{ arenaId: string }> }) {
  const { arenaId } = use(params);
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState label="Carregando…" />}>
        <ReportsView arenaId={arenaId} />
      </Suspense>
    </RequireAuth>
  );
}
