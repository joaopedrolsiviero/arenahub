'use client';

import { Suspense, use, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2Icon, MapPinIcon } from 'lucide-react';
import { useMyBooking, useCancelBooking } from '@/hooks/use-api';
import { LoadingState, ErrorState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { SiteHeader } from '@/components/site-header';
import { BookingStatusBadge } from '@/components/booking-status-badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatCurrencyBRL, formatDateInZone, formatTimeInZone } from '@/lib/format';
import { ApiError } from '@/lib/api';

export function BookingDetail({ bookingId }: { bookingId: string }) {
  const searchParams = useSearchParams();
  const justCreated = searchParams.get('created') === 'true';
  const router = useRouter();

  const { data: booking, isPending, isError } = useMyBooking(bookingId);
  const cancelBooking = useCancelBooking();
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function handleCancel() {
    if (!booking) return;
    setCancelError(null);
    try {
      await cancelBooking.mutateAsync({
        arenaId: booking.court.arena.id,
        courtId: booking.court.id,
        bookingId: booking.id,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        setCancelError(error.message);
      } else {
        setCancelError('Não foi possível cancelar a reserva. Tente novamente.');
      }
    }
  }

  if (isPending) {
    return <LoadingState label="Carregando reserva…" />;
  }
  if (isError || !booking) {
    return <ErrorState message="Reserva não encontrada." />;
  }

  const canCancel = booking.status === 'CONFIRMED';
  const datePart = formatDateInZone(booking.startsAt, booking.court.arena.timezone);
  const timePart = formatTimeInZone(booking.startsAt, booking.court.arena.timezone);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 sm:px-6">
      {justCreated ? (
        <Alert role="status" className="border-brand/30 bg-brand/8">
          <CheckCircle2Icon className="text-brand" />
          <AlertTitle>Reserva confirmada!</AlertTitle>
          <AlertDescription>Sua reserva foi criada com sucesso.</AlertDescription>
        </Alert>
      ) : null}

      {cancelError ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Erro ao cancelar</AlertTitle>
          <AlertDescription>{cancelError}</AlertDescription>
        </Alert>
      ) : null}

      {/* "Ticket digital" (item 18): data/horário como o elemento mais forte
          da tela, tudo o mais é contexto de apoio. */}
      <Card className="overflow-visible border-2 border-border">
        <CardHeader className="items-center gap-1 border-b border-dashed border-border pb-5 text-center">
          <BookingStatusBadge status={booking.status} />
          <p className="tabular mt-1 text-3xl font-bold tracking-tight">{timePart}</p>
          <p className="text-sm text-muted-foreground">{datePart}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex items-start gap-2.5">
            <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-heading text-sm font-semibold">{booking.court.arena.name}</p>
              <p className="text-sm text-muted-foreground">{booking.court.name}</p>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="tabular text-base font-bold">{formatCurrencyBRL(booking.total)}</span>
          </div>
        </CardContent>
      </Card>

      {canCancel ? (
        <AlertDialog>
          <AlertDialogTrigger
            className="w-full"
            render={<Button type="button" variant="destructive" disabled={cancelBooking.isPending} />}
          >
            {cancelBooking.isPending ? 'Cancelando…' : 'Cancelar reserva'}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancelar esta reserva?</AlertDialogTitle>
              <AlertDialogDescription>
                {booking.court.name} · {booking.court.arena.name} · {timePart}, {datePart}. Essa ação não
                pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction onClick={handleCancel}>Sim, cancelar reserva</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      <Button type="button" variant="ghost" onClick={() => router.push('/minhas-reservas')}>
        Voltar para minhas reservas
      </Button>
    </div>
  );
}

export default function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = use(params);
  return (
    <RequireAuth>
      <SiteHeader />
      <Suspense fallback={<LoadingState label="Carregando reserva…" />}>
        <BookingDetail bookingId={bookingId} />
      </Suspense>
    </RequireAuth>
  );
}
