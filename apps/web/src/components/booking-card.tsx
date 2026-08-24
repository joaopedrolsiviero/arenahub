import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card';
import { BookingStatusBadge } from '@/components/booking-status-badge';
import { formatCurrencyBRL, formatDateInZone, formatTimeInZone } from '@/lib/format';
import type { MyBooking } from '@/lib/types';

export function BookingCard({ booking, highlight = false }: { booking: MyBooking; highlight?: boolean }) {
  return (
    <Link href={`/minhas-reservas/${booking.id}`} className="group block">
      <Card
        className={
          highlight
            ? 'h-full border-2 border-brand/40 transition-all group-hover:-translate-y-0.5'
            : 'h-full transition-all group-hover:-translate-y-0.5'
        }
      >
        <CardHeader>
          <CardTitle>{booking.court.arena.name}</CardTitle>
          <CardDescription>{booking.court.name}</CardDescription>
          <CardAction>
            <BookingStatusBadge status={booking.status} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex items-end justify-between">
          <div>
            <p className="tabular text-lg font-bold leading-none">
              {formatTimeInZone(booking.startsAt, booking.court.arena.timezone)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDateInZone(booking.startsAt, booking.court.arena.timezone)}
            </p>
          </div>
          <span className="tabular text-sm font-semibold text-muted-foreground">
            {formatCurrencyBRL(booking.total)}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
