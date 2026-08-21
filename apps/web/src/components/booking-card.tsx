import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card';
import { BookingStatusBadge } from '@/components/booking-status-badge';
import { formatCurrencyBRL, formatDateTimeInZone } from '@/lib/format';
import type { MyBooking } from '@/lib/types';

export function BookingCard({ booking }: { booking: MyBooking }) {
  return (
    <Link href={`/minhas-reservas/${booking.id}`} className="block">
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle>{booking.court.arena.name}</CardTitle>
          <CardDescription>{booking.court.name}</CardDescription>
          <CardAction>
            <BookingStatusBadge status={booking.status} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-sm">
          <span>{formatDateTimeInZone(booking.startsAt, booking.court.arena.timezone)}</span>
          <span className="font-medium">{formatCurrencyBRL(booking.total)}</span>
        </CardContent>
      </Card>
    </Link>
  );
}
