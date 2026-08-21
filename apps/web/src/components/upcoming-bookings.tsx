import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookingTypeBadge } from '@/components/booking-type-badge';
import { EmptyState } from '@/components/async-state';
import { formatCurrencyBRL, formatTimeInZone } from '@/lib/format';
import type { DashboardBookingItem } from '@/lib/types';

export function UpcomingBookings({
  bookings,
  timezone,
}: {
  bookings: DashboardBookingItem[];
  timezone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Próximas reservas</CardTitle>
      </CardHeader>
      <CardContent>
        {bookings.length === 0 ? (
          <EmptyState message="Nenhuma reserva confirmada para o dia selecionado." />
        ) : (
          <ul className="flex flex-col gap-2">
            {bookings.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
              >
                <span className="font-medium tabular-nums">
                  {formatTimeInZone(item.startsAt, timezone)}
                </span>
                <span className="flex-1 truncate">{item.courtName}</span>
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
