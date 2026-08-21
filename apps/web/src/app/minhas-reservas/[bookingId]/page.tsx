'use client';

import { Suspense, use, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMyBooking, useCancelBooking } from '@/hooks/use-api';
import { LoadingState, ErrorState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { BookingStatusBadge } from '@/components/booking-status-badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatCurrencyBRL, formatDateTimeInZone } from '@/lib/format';
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

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      {justCreated ? (
        <Alert role="status">
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

      <Card>
        <CardHeader>
          <CardTitle>{booking.court.arena.name}</CardTitle>
          <CardAction>
            <BookingStatusBadge status={booking.status} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Quadra</span>
            <span>{booking.court.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Data e horário</span>
            <span>{formatDateTimeInZone(booking.startsAt, booking.court.arena.timezone)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span>{formatCurrencyBRL(booking.total)}</span>
          </div>
        </CardContent>
        {canCancel ? (
          <CardFooter>
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              disabled={cancelBooking.isPending}
              onClick={handleCancel}
            >
              {cancelBooking.isPending ? 'Cancelando…' : 'Cancelar reserva'}
            </Button>
          </CardFooter>
        ) : null}
      </Card>

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
      <Suspense fallback={<LoadingState label="Carregando reserva…" />}>
        <BookingDetail bookingId={bookingId} />
      </Suspense>
    </RequireAuth>
  );
}
