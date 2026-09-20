import { DateTime } from 'luxon';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { BookingTypeBadge } from '@/components/booking-type-badge';
import { AdminBookingActions } from '@/components/admin-booking-actions';
import { EmptyState } from '@/components/async-state';
import { formatCurrencyBRL, formatTimeInZone } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { DashboardBookingItem, DashboardCourt, OperatingInterval } from '@/lib/types';

function minutesInZone(iso: string, timezone: string): number {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone);
  return dt.hour * 60 + dt.minute;
}

function minutesFromHHmm(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const TYPE_BAR_CLASS = {
  CUSTOMER: 'bg-brand',
  BLOCK: 'bg-foreground/25',
  MAINTENANCE: 'bg-warning',
} as const;

// Elemento mais forte do dashboard (item 21): uma barra visual da janela de
// funcionamento, com os intervalos fechados marcados (hachurado) e cada
// ocupação posicionada no tempo real — nunca depende só de cor pra
// diferenciar CUSTOMER/BLOCK/MAINTENANCE (padrão + ícone no badge abaixo).
function CourtOccupancyBar({
  court,
  operatingHours,
  timezone,
}: {
  court: DashboardCourt;
  operatingHours: OperatingInterval[];
  timezone: string;
}) {
  if (operatingHours.length === 0) {
    return (
      <div className="flex h-9 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
        Fechada neste dia
      </div>
    );
  }

  const dayStart = Math.min(...operatingHours.map((h) => minutesFromHHmm(h.opensAt)));
  const dayEnd = Math.max(...operatingHours.map((h) => minutesFromHHmm(h.closesAt)));
  const span = Math.max(dayEnd - dayStart, 1);
  const pct = (minutes: number) => `${(100 * (minutes - dayStart)) / span}%`;

  // Buracos entre intervalos de funcionamento (ex: pausa de almoço) — a
  // arena está fechada ali, diferente de "livre" (item 21/29).
  const sorted = [...operatingHours].sort(
    (a, b) => minutesFromHHmm(a.opensAt) - minutesFromHHmm(b.opensAt),
  );
  const gaps: { left: string; width: string }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const closeCurrent = minutesFromHHmm(sorted[i]!.closesAt);
    const openNext = minutesFromHHmm(sorted[i + 1]!.opensAt);
    if (openNext > closeCurrent) {
      gaps.push({ left: pct(closeCurrent), width: pct(openNext - closeCurrent + dayStart) });
    }
  }

  return (
    <div
      className="relative h-9 overflow-hidden rounded-lg bg-brand/8"
      role="img"
      aria-label={`Ocupação de ${court.name} — ver lista abaixo para detalhes`}
    >
      {gaps.map((gap, index) => (
        <div
          key={index}
          className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,var(--muted-foreground)_0,var(--muted-foreground)_1px,transparent_1px,transparent_6px)] opacity-15"
          style={{ left: gap.left, width: gap.width }}
        />
      ))}
      {court.occupancy.map((item) => {
        const start = Math.min(Math.max(minutesInZone(item.startsAt, timezone), dayStart), dayEnd);
        const end = Math.min(Math.max(minutesInZone(item.endsAt, timezone), dayStart), dayEnd);
        return (
          <div
            key={item.id}
            className={cn(
              'absolute inset-y-0.5 rounded-md',
              TYPE_BAR_CLASS[item.type],
            )}
            style={{ left: pct(start), width: pct(end - start) }}
            title={`${formatTimeInZone(item.startsAt, timezone)}–${formatTimeInZone(item.endsAt, timezone)}`}
          />
        );
      })}
    </div>
  );
}

export function BookingTimelineCard({
  arenaId,
  court,
  operatingHours,
  timezone,
  onBookingCancelled,
}: {
  arenaId: string;
  court: DashboardCourt;
  operatingHours: OperatingInterval[];
  timezone: string;
  onBookingCancelled?: (booking: DashboardBookingItem) => void;
}) {
  return (
    <Card className={!court.isActive ? 'opacity-70' : undefined}>
      <CardHeader>
        <CardTitle>{court.name}</CardTitle>
        <CardAction>
          {!court.isActive ? <Badge variant="destructive">Inativa</Badge> : null}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <CourtOccupancyBar court={court} operatingHours={operatingHours} timezone={timezone} />

        {court.occupancy.length === 0 ? (
          <EmptyState message="Sem ocupação nesta quadra no dia selecionado." />
        ) : (
          <ul className="flex flex-col gap-2">
            {court.occupancy.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="tabular font-semibold">
                    {formatTimeInZone(item.startsAt, timezone)}–
                    {formatTimeInZone(item.endsAt, timezone)}
                  </span>
                  <span className="flex-1 truncate text-muted-foreground">
                    {item.type === 'CUSTOMER'
                      ? (item.user?.name ?? item.user?.email ?? 'Cliente')
                      : (item.reason ?? '—')}
                  </span>
                  <BookingTypeBadge type={item.type} />
                  {item.type === 'CUSTOMER' ? (
                    <span className="tabular text-sm font-semibold">{formatCurrencyBRL(item.total)}</span>
                  ) : null}
                </div>
                <AdminBookingActions
                  booking={item}
                  arenaId={arenaId}
                  timezone={timezone}
                  onCancelled={onBookingCancelled}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
