'use client';

import { DateTime } from 'luxon';
import { useMyBookings, useMyPaymentStatuses } from '@/hooks/use-api';
import { BookingCard } from '@/components/booking-card';
import { SiteHeader } from '@/components/site-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MyBooking, PaymentStatus } from '@/lib/types';

function partition(bookings: MyBooking[]) {
  const now = DateTime.utc();
  const upcoming: MyBooking[] = [];
  const past: MyBooking[] = [];
  const cancelled: MyBooking[] = [];

  for (const booking of bookings) {
    if (booking.status === 'CANCELLED') {
      cancelled.push(booking);
      continue;
    }
    if (DateTime.fromISO(booking.startsAt, { zone: 'utc' }) >= now) {
      upcoming.push(booking);
    } else {
      past.push(booking);
    }
  }
  // Mais próxima primeiro — é ela que ganha destaque visual (item 17).
  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { upcoming, past, cancelled };
}

function BookingList({
  bookings,
  paymentStatuses,
  emptyMessage,
  highlightFirst = false,
}: {
  bookings: MyBooking[];
  paymentStatuses: Record<string, PaymentStatus>;
  emptyMessage: string;
  highlightFirst?: boolean;
}) {
  if (bookings.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {bookings.map((booking, index) => (
        <BookingCard
          key={booking.id}
          booking={booking}
          paymentStatus={paymentStatuses[booking.id]}
          highlight={highlightFirst && index === 0}
        />
      ))}
    </div>
  );
}

function MyBookingsList() {
  const { data: bookings, isPending, isError } = useMyBookings();
  // Consultado em paralelo, nunca bloqueia a lista de reservas — se essa
  // chamada ainda não voltou, os badges de pagamento simplesmente aparecem
  // um instante depois (mapa vazio até lá), a lista em si não espera.
  const { data: paymentStatuses } = useMyPaymentStatuses();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 sm:px-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Minhas reservas</h1>

      {isPending ? <LoadingState label="Carregando reservas…" /> : null}
      {isError ? <ErrorState message="Não foi possível carregar suas reservas." /> : null}

      {bookings ? (
        (() => {
          const { upcoming, past, cancelled } = partition(bookings);
          return (
            <Tabs defaultValue="upcoming">
              <TabsList>
                <TabsTrigger value="upcoming">Próximas</TabsTrigger>
                <TabsTrigger value="past">Histórico</TabsTrigger>
                <TabsTrigger value="cancelled">Canceladas</TabsTrigger>
              </TabsList>
              <TabsContent value="upcoming">
                <BookingList
                  bookings={upcoming}
                  paymentStatuses={paymentStatuses ?? {}}
                  emptyMessage="Você não tem reservas futuras."
                  highlightFirst
                />
              </TabsContent>
              <TabsContent value="past">
                <BookingList
                  bookings={past}
                  paymentStatuses={paymentStatuses ?? {}}
                  emptyMessage="Nenhuma reserva no histórico."
                />
              </TabsContent>
              <TabsContent value="cancelled">
                <BookingList
                  bookings={cancelled}
                  paymentStatuses={paymentStatuses ?? {}}
                  emptyMessage="Nenhuma reserva cancelada."
                />
              </TabsContent>
            </Tabs>
          );
        })()
      ) : null}
    </div>
  );
}

export default function MyBookingsPage() {
  return (
    <RequireAuth>
      <SiteHeader />
      <MyBookingsList />
    </RequireAuth>
  );
}
