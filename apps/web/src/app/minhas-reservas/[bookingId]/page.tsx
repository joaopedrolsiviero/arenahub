'use client';

import { Suspense, use, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2Icon, MapPinIcon } from 'lucide-react';
import { useMyBooking, useCancelBooking, useBookingPayment, useCreateBookingPayment } from '@/hooks/use-api';
import { LoadingState, ErrorState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { SiteHeader } from '@/components/site-header';
import { BookingStatusBadge } from '@/components/booking-status-badge';
import { PaymentStatusBadge } from '@/components/payment-status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { formatCurrencyBRL, formatDateInZone, formatDateTimeInZone, formatTimeInZone } from '@/lib/format';
import { ApiError } from '@/lib/api';
import type { MyBooking } from '@/lib/types';

// Fase 17 — seção financeira de "minhas reservas". Nunca permite editar
// valor/status: o valor exibido é sempre `payment.amount` (vindo do
// backend, que por sua vez o congela a partir de `Booking.total` — nunca um
// campo editável aqui), e o status exibido é sempre `payment.status` —
// nenhum estado local finge que um pagamento foi concluído (item 13 do
// prompt da fase: "o frontend deve sempre refletir o estado retornado pelo
// backend").
function PaymentSection({ booking }: { booking: MyBooking }) {
  const { data: payment, isPending, isError } = useBookingPayment(booking.id);
  const createPayment = useCreateBookingPayment(booking.id);
  const [payError, setPayError] = useState<string | null>(null);

  async function handlePay() {
    setPayError(null);
    try {
      // Chave nova a cada clique — o backend já resolve pra mesma tentativa
      // ATIVA quando existir uma (nunca duas cobranças em paralelo, ver
      // PaymentsService), então não há necessidade de persistir a chave
      // entre cliques só para evitar duplicidade.
      await createPayment.mutateAsync(crypto.randomUUID());
    } catch (error) {
      setPayError(
        error instanceof ApiError ? error.message : 'Não foi possível iniciar o pagamento. Tente novamente.',
      );
    }
  }

  // Reserva cancelada e nunca chegou a ter nenhum pagamento — nada
  // financeiro a mostrar.
  if (!isPending && !payment && booking.status === 'CANCELLED') {
    return null;
  }

  const canPay =
    booking.status === 'CONFIRMED' && (!payment || payment.status === 'FAILED' || payment.status === 'EXPIRED');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pagamento</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isPending ? <LoadingState label="Carregando pagamento…" /> : null}
        {isError ? <ErrorState message="Não foi possível carregar o pagamento." /> : null}

        {payError ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Erro</AlertTitle>
            <AlertDescription>{payError}</AlertDescription>
          </Alert>
        ) : null}

        {!isPending && !payment ? (
          <p className="text-sm text-muted-foreground">Esta reserva ainda não foi paga.</p>
        ) : null}

        {payment ? (
          <>
            <div className="flex items-center justify-between">
              <PaymentStatusBadge status={payment.status} />
              <span className="tabular text-base font-bold">{formatCurrencyBRL(payment.amount)}</span>
            </div>

            {payment.status === 'PENDING' && payment.pixCopyPaste ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pix-copy-paste">Código PIX copia e cola</Label>
                <Input
                  id="pix-copy-paste"
                  readOnly
                  value={payment.pixCopyPaste}
                  onFocus={(event) => event.target.select()}
                  className="font-mono text-xs"
                />
                {payment.expiresAt ? (
                  <p className="text-xs text-muted-foreground">
                    Expira em {formatDateTimeInZone(payment.expiresAt, booking.court.arena.timezone)}
                  </p>
                ) : null}
              </div>
            ) : null}

            {payment.status === 'PAID' && payment.paidAt ? (
              <p className="text-sm text-muted-foreground">
                Pago em {formatDateTimeInZone(payment.paidAt, booking.court.arena.timezone)}
              </p>
            ) : null}

            {payment.status === 'FAILED' && payment.failureReason ? (
              <p className="text-sm text-muted-foreground">
                Não foi possível concluir o pagamento anterior.
              </p>
            ) : null}

            {payment.status === 'CANCELLED' ? (
              <p className="text-sm text-muted-foreground">
                Esta tentativa de pagamento foi cancelada porque a reserva foi cancelada.
              </p>
            ) : null}
          </>
        ) : null}

        {canPay ? (
          <Button type="button" onClick={handlePay} disabled={createPayment.isPending}>
            {createPayment.isPending
              ? 'Iniciando pagamento…'
              : payment
                ? 'Tentar pagar novamente'
                : 'Pagar com PIX'}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

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

      <PaymentSection booking={booking} />

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
