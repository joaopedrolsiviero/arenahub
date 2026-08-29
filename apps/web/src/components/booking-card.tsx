import Link from 'next/link';
import { ChevronRightIcon } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardFooter,
} from '@/components/ui/card';
import { BookingStatusBadge } from '@/components/booking-status-badge';
import { PaymentStatusBadge } from '@/components/payment-status-badge';
import { formatCurrencyBRL, formatDateInZone, formatTimeInZone } from '@/lib/format';
import type { MyBooking, PaymentStatus } from '@/lib/types';

// Fase 26, item 17: "Reserva" (BookingStatus) e "Pagamento" (PaymentStatus)
// são conceitos independentes — os dois badges aparecem lado a lado, nunca
// um substituindo o outro. `paymentStatus` vem de uma consulta separada
// (`useMyPaymentStatuses`, uma chamada só pra todas as reservas da lista);
// `undefined` significa "nenhuma tentativa de pagamento ainda" — omite o
// badge em vez de inventar um estado que não existe.
export function BookingCard({
  booking,
  paymentStatus,
  highlight = false,
}: {
  booking: MyBooking;
  paymentStatus?: PaymentStatus;
  highlight?: boolean;
}) {
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
          <CardAction className="flex flex-col items-end gap-1">
            <BookingStatusBadge status={booking.status} />
            {paymentStatus ? <PaymentStatusBadge status={paymentStatus} /> : null}
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
        {/* Fase 29 — pista explícita de clicabilidade: hover só existe em
            desktop, e num celular (sem hover) o card inteiro sendo um link
            não era óbvio por si só. */}
        <CardFooter className="justify-end gap-0.5 text-xs font-medium text-muted-foreground">
          Ver detalhes
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        </CardFooter>
      </Card>
    </Link>
  );
}
