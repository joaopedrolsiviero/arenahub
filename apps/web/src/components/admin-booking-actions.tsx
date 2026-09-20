'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { PaymentStatusBadge } from '@/components/payment-status-badge';
import { useCancelBooking } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { ApiError } from '@/lib/api';
import { formatCurrencyBRL, formatTimeInZone } from '@/lib/format';
import type { DashboardBookingItem } from '@/lib/types';

// Mensagem por status HTTP do endpoint de cancelamento JÁ existente. O
// backend continua sendo a única autoridade (papel OWNER/ADMIN, arena
// correta, janela `startsAt`, CAS, refund) — aqui só traduzimos a resposta.
function cancelErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return 'Sua sessão expirou. Entre novamente para cancelar a reserva.';
      case 403:
        return 'Você não tem permissão para cancelar esta reserva.';
      case 404:
        return 'Reserva não encontrada — ela pode ter sido removida. Atualize a página.';
      case 400:
      case 409:
        return `${error.message} Atualize a página para ver o estado atual.`;
      default:
        return 'Não foi possível cancelar a reserva. Tente novamente em instantes.';
    }
  }
  return 'Não foi possível cancelar a reserva. Verifique sua conexão e tente novamente.';
}

/**
 * Linha de status/ação de uma reserva de CLIENTE na agenda administrativa:
 * badge do pagamento (reaproveita `PaymentStatusBadge`) e o botão "Cancelar
 * reserva". O botão é só atalho de UX — aparece para reserva CONFIRMED que
 * ainda não começou; a decisão real (papel, arena, `startsAt`, refund) é
 * sempre do backend. O frontend nunca chama nada de refund: pedir o
 * cancelamento já dispara `refundIfPaid` no servidor quando aplicável.
 */
export function AdminBookingActions({
  booking,
  arenaId,
  timezone,
  onCancelled,
}: {
  booking: DashboardBookingItem;
  arenaId: string;
  timezone: string;
  onCancelled?: (booking: DashboardBookingItem) => void;
}) {
  const cancelBooking = useCancelBooking();
  const [error, setError] = useState<string | null>(null);
  // Controlado: `AlertDialogAction` não fecha o dialog sozinho. Fecha ao
  // confirmar — o andamento aparece no botão ("Cancelando…") e um erro fica
  // visível na linha da reserva, nunca escondido atrás do overlay.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const now = useNow();

  if (booking.type !== 'CUSTOMER') return null;

  const canCancel = booking.status === 'CONFIRMED' && new Date(booking.startsAt).getTime() > now;
  const willRefund = booking.paymentStatus === 'PAID' || booking.paymentStatus === 'REFUNDING';

  async function handleCancel() {
    setConfirmOpen(false);
    if (cancelBooking.isPending) return; // evita dupla submissão
    setError(null);
    try {
      await cancelBooking.mutateAsync({
        arenaId,
        courtId: booking.courtId,
        bookingId: booking.id,
      });
      onCancelled?.(booking);
    } catch (caught) {
      setError(cancelErrorMessage(caught));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {booking.paymentStatus ? (
          <PaymentStatusBadge status={booking.paymentStatus} />
        ) : (
          <Badge variant="outline">Sem pagamento online</Badge>
        )}
        {canCancel ? (
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={cancelBooking.isPending}
                />
              }
            >
              {cancelBooking.isPending ? 'Cancelando…' : 'Cancelar reserva'}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancelar esta reserva?</AlertDialogTitle>
                <AlertDialogDescription>
                  {booking.courtName} · {formatTimeInZone(booking.startsAt, timezone)} ·{' '}
                  {booking.user?.name ?? booking.user?.email ?? 'Cliente'}. O horário será liberado e
                  esta ação não pode ser desfeita.
                  {willRefund ? (
                    <>
                      {' '}
                      A reserva foi paga: o valor de {formatCurrencyBRL(booking.total)} será
                      reembolsado integralmente ao cliente pelo sistema.
                    </>
                  ) : null}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction onClick={handleCancel}>Sim, cancelar reserva</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
