import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { BookingTypeBadge } from '@/components/booking-type-badge';
import { EmptyState } from '@/components/async-state';
import { formatCurrencyBRL, formatTimeInZone } from '@/lib/format';
import type { DashboardCourt } from '@/lib/types';

export function BookingTimelineCard({
  court,
  timezone,
}: {
  court: DashboardCourt;
  timezone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{court.name}</CardTitle>
        <CardAction>
          {!court.isActive ? <Badge variant="destructive">Inativa</Badge> : null}
        </CardAction>
      </CardHeader>
      <CardContent>
        {court.occupancy.length === 0 ? (
          <EmptyState message="Sem ocupação nesta quadra no dia selecionado." />
        ) : (
          <ul className="flex flex-col gap-2">
            {court.occupancy.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
              >
                <span className="font-medium tabular-nums">
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
                  <span className="tabular-nums">{formatCurrencyBRL(item.total)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
