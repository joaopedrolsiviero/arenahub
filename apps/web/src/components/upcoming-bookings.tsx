import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookingTypeBadge } from '@/components/booking-type-badge';
import { AdminBookingActions } from '@/components/admin-booking-actions';
import { EmptyState } from '@/components/async-state';
import { formatCurrencyBRL, formatTimeInZone } from '@/lib/format';
import type { DashboardBookingItem } from '@/lib/types';

export function UpcomingBookings({
  arenaId,
  bookings,
  timezone,
  onBookingCancelled,
}: {
  arenaId: string;
  bookings: DashboardBookingItem[];
  timezone: string;
  onBookingCancelled?: (booking: DashboardBookingItem) => void;
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
                className="flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="tabular font-semibold">{formatTimeInZone(item.startsAt, timezone)}</span>
                  <span className="flex-1 truncate font-medium">{item.courtName}</span>
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
