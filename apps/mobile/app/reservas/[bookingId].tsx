import { useEffect, useState, useSyncExternalStore } from 'react';
import { Modal, Text, View, StyleSheet } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { LoadingState } from '@/components/LoadingState';
import { ErrorState } from '@/components/ErrorState';
import { BookingStatusBadge } from '@/components/BookingStatusBadge';
import { PaymentStatusBadge } from '@/components/PaymentStatusBadge';
import { useMyBooking } from '@/hooks/useMyBookings';
import { useCancelBooking } from '@/hooks/useCancelBooking';
import { usePayment } from '@/hooks/usePayment';
import { formatCurrencyBRL, formatDateInZone, formatTimeInZone } from '@/lib/format';
import { ApiError } from '@/api/client';
import { colors, radius, spacing, typography } from '@/constants/theme';

function signInUrl(bookingId: string): string {
  return `/(auth)/sign-in?redirect=${encodeURIComponent(`/reservas/${bookingId}`)}`;
}

// Date.now() é impura — chamá-la direto no corpo do componente viola a regra
// de pureza de render do React (react-hooks/purity), mesmo sem o problema de
// SSR/hidratação que o Web precisa reconciliar (ver comentário equivalente
// em apps/web/.../[bookingId]/page.tsx, useNow). useSyncExternalStore é a
// forma oficial de ler essa fonte externa impura durante o render sem violar
// a regra; sem getServerSnapshot aqui porque não há SSR neste app.
let cachedNow = Date.now();
function subscribeToClock(callback: () => void): () => void {
  const interval = setInterval(() => {
    cachedNow = Date.now();
    callback();
  }, 30_000);
  return () => clearInterval(interval);
}
function getClockSnapshot(): number {
  return cachedNow;
}
function useNow(): number {
  return useSyncExternalStore(subscribeToClock, getClockSnapshot);
}

/**
 * Detalhe de "minha reserva" + cancelamento (M5). Contrato confirmado lendo
 * my-bookings.controller.ts / bookings.service.ts / bookings.controller.ts
 * antes de escrever esta tela:
 *
 * - GET /users/me/bookings/:bookingId — 404 (nunca 403) quando a reserva não
 *   existe OU não é do usuário logado; o cliente nunca distingue os dois
 *   casos, o que já resolve IDOR sem checagem extra aqui (item "segurança").
 * - POST /arenas/:arenaId/courts/:courtId/bookings/:bookingId/cancel — SEM
 *   Idempotency-Key (cancelamento é idempotente pela própria máquina de
 *   estados, não pelo mecanismo formal de idempotência); devolve um
 *   `Booking` cru (sem court/arena) — por isso o resultado da mutation NUNCA
 *   é usado para atualizar a tela diretamente, só as invalidações de query
 *   (useCancelBooking) fazem a tela refletir o estado real pós-cancelamento.
 * - Reembolso (`PaymentsService.refundIfPaid`) é best-effort e não bloqueia
 *   a resposta do cancelamento — REFUNDING/REFUNDED só aparecem depois que a
 *   query de pagamento for revalidada/repollada, nunca prometido no instante
 *   do cancelamento em si.
 */
export default function ReservaDetalheScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { isLoaded, isSignedIn } = useAuth();

  // Efeito sobre um sistema externo (navegação) — nunca ajuste de estado
  // React, por isso vive em useEffect (mesma distinção já usada em
  // arena/[slug]/[courtId].tsx: side effect em sistema externo vs. estado
  // derivado durante o render).
  useEffect(() => {
    if (isLoaded && !isSignedIn && bookingId) {
      router.replace(signInUrl(bookingId));
    }
  }, [isLoaded, isSignedIn, bookingId]);

  const canQuery = isLoaded && isSignedIn === true;
  const bookingQuery = useMyBooking(bookingId, canQuery);
  const paymentQuery = usePayment(canQuery ? bookingId : undefined);
  const cancelBooking = useCancelBooking();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const now = useNow();

  // Sessão expirou DEPOIS do carregamento inicial (ex: token revogado) —
  // mesmo tratamento de 401 do resto do app (M1-M4), nunca um segundo
  // mecanismo de autenticação.
  useEffect(() => {
    if (bookingQuery.error instanceof ApiError && bookingQuery.error.status === 401 && bookingId) {
      router.replace(signInUrl(bookingId));
    }
  }, [bookingQuery.error, bookingId]);

  async function handleCancel() {
    if (!bookingQuery.data) return;
    setConfirmVisible(false);
    setCancelError(null);
    try {
      await cancelBooking.mutateAsync({
        arenaId: bookingQuery.data.court.arena.id,
        courtId: bookingQuery.data.court.id,
        bookingId: bookingQuery.data.id,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace(signInUrl(bookingQuery.data.id));
      } else if (error instanceof ApiError && error.status === 403) {
        setCancelError('Você não tem permissão para cancelar esta reserva.');
      } else if (error instanceof ApiError && error.status === 404) {
        setCancelError('Reserva não encontrada.');
      } else if (error instanceof ApiError && error.status === 400) {
        setCancelError('Esta reserva já começou ou já foi concluída e não pode mais ser cancelada.');
      } else if (error instanceof ApiError && error.status === 429) {
        setCancelError('Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.');
      } else {
        // Rede/timeout/5xx — nunca considera o cancelamento bem-sucedido sem
        // confirmação do backend (M5); relê o estado real em vez de supor
        // qualquer resultado. Cancelar é idempotente (BookingsService.cancel),
        // então tentar de novo depois de um refetch nunca duplica nada.
        await bookingQuery.refetch();
        setCancelError(
          'Não foi possível confirmar o cancelamento. Verifique o status da reserva abaixo antes de tentar de novo.',
        );
      }
    }
  }

  function goToPayment() {
    if (!bookingQuery.data) return;
    const booking = bookingQuery.data;
    router.push({
      pathname: '/pagamento/[bookingId]',
      params: {
        bookingId: booking.id,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        total: booking.total,
        arenaName: booking.court.arena.name,
        courtName: booking.court.name,
        timezone: booking.court.arena.timezone,
      },
    });
  }

  if (!isLoaded || !canQuery || bookingQuery.isPending) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '' }} />
        <LoadingState label={!isLoaded || !canQuery ? 'Carregando sessão…' : 'Carregando reserva…'} />
      </Screen>
    );
  }

  if (bookingQuery.isError || !bookingQuery.data) {
    const notFound = bookingQuery.error instanceof ApiError && bookingQuery.error.status === 404;
    return (
      <Screen>
        <Stack.Screen options={{ title: '' }} />
        <ErrorState
          message="Reserva não encontrada."
          onRetry={notFound ? undefined : () => bookingQuery.refetch()}
        />
      </Screen>
    );
  }

  const booking = bookingQuery.data;
  const isOnline = booking.court.arena.paymentMode === 'ONLINE';
  const payment = isOnline ? paymentQuery.data : undefined;

  // Autoridade sobre "pode cancelar?" continua sendo só o backend
  // (BookingsService.cancel rejeita com 400 de qualquer forma) — este
  // cálculo é só um atalho de UX pra não oferecer um botão que o backend
  // certamente vai recusar.
  const hasStarted = now >= new Date(booking.startsAt).getTime();
  const canCancel = booking.status === 'CONFIRMED' && !hasStarted;
  const cancelBlockedByTime = booking.status === 'CONFIRMED' && hasStarted;

  let payLabel: string | null = null;
  if (isOnline && booking.status === 'CONFIRMED') {
    if (!payment) payLabel = 'Pagar agora';
    else if (payment.status === 'PENDING') payLabel = 'Ver PIX gerado';
    else if (payment.status === 'FAILED' || payment.status === 'EXPIRED') payLabel = 'Tentar pagamento novamente';
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: '' }} />
      <View style={styles.content}>
        <Card style={styles.ticketCard}>
          <View style={styles.ticketHeader}>
            <BookingStatusBadge status={booking.status} />
            <Text style={styles.time}>{formatTimeInZone(booking.startsAt, booking.court.arena.timezone)}</Text>
            <Text style={styles.date}>{formatDateInZone(booking.startsAt, booking.court.arena.timezone)}</Text>
          </View>
          <View style={styles.divider} />
          <Text style={styles.arenaName}>{booking.court.arena.name}</Text>
          <Text style={styles.courtName}>{booking.court.name}</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Total</Text>
            <Text style={styles.rowValue}>{formatCurrencyBRL(booking.total)}</Text>
          </View>
        </Card>

        <Card style={styles.paymentCard}>
          <Text style={styles.sectionTitle}>Pagamento</Text>
          {!isOnline ? (
            <Text style={styles.hint} testID="in-person-notice">
              Esta arena usa pagamento presencial — combine a forma de pagamento diretamente com o
              responsável pela quadra. Nenhuma cobrança é feita pelo ArenaHub.
            </Text>
          ) : (
            <>
              {paymentQuery.isPending ? <LoadingState label="Carregando pagamento…" /> : null}
              {!paymentQuery.isPending && !payment ? (
                <Text style={styles.hint}>Esta reserva ainda não foi paga.</Text>
              ) : null}
              {payment ? (
                <View style={styles.row}>
                  <PaymentStatusBadge status={payment.status} />
                  <Text style={styles.rowValue}>{formatCurrencyBRL(payment.amount)}</Text>
                </View>
              ) : null}
            </>
          )}
          {payLabel ? (
            <Button variant="outline" onPress={goToPayment} testID="go-to-payment">
              {payLabel}
            </Button>
          ) : null}
        </Card>

        {cancelError ? (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.errorText}>{cancelError}</Text>
          </View>
        ) : null}

        {canCancel ? (
          <Button
            variant="outline"
            onPress={() => setConfirmVisible(true)}
            disabled={cancelBooking.isPending}
            testID="cancel-booking"
          >
            {cancelBooking.isPending ? 'Cancelando…' : 'Cancelar reserva'}
          </Button>
        ) : cancelBlockedByTime ? (
          <Text style={styles.hint}>Esta reserva já começou e não pode mais ser cancelada.</Text>
        ) : null}

        <Button variant="ghost" onPress={() => router.replace('/(tabs)/reservas')} testID="back-to-my-bookings">
          Voltar para minhas reservas
        </Button>
      </View>

      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Card style={styles.modalCard}>
            <Text style={styles.modalTitle}>Cancelar esta reserva?</Text>
            <Text style={styles.modalMessage}>
              {booking.court.name} · {booking.court.arena.name} ·{' '}
              {formatTimeInZone(booking.startsAt, booking.court.arena.timezone)},{' '}
              {formatDateInZone(booking.startsAt, booking.court.arena.timezone)}. Essa ação não pode ser
              desfeita.
              {payment?.status === 'PAID'
                ? ` Esta reserva foi paga. O valor de ${formatCurrencyBRL(payment.amount)} será reembolsado integralmente.`
                : ''}
            </Text>
            <View style={styles.modalActions}>
              <Button variant="ghost" onPress={() => setConfirmVisible(false)} testID="cancel-dialog-dismiss">
                Voltar
              </Button>
              <Button onPress={handleCancel} disabled={cancelBooking.isPending} testID="cancel-dialog-confirm">
                {cancelBooking.isPending ? 'Cancelando…' : 'Sim, cancelar reserva'}
              </Button>
            </View>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xl },
  ticketCard: { gap: spacing.xs },
  ticketHeader: { alignItems: 'center', gap: 2, paddingBottom: spacing.sm },
  time: { fontSize: 32, fontWeight: '700', color: colors.foreground, marginTop: spacing.xs },
  date: { fontSize: typography.body.fontSize, color: colors.mutedForeground },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  arenaName: { fontSize: typography.title.fontSize, fontWeight: typography.title.fontWeight, color: colors.foreground },
  courtName: { fontSize: typography.body.fontSize, color: colors.mutedForeground },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  rowLabel: { fontSize: typography.caption.fontSize, color: colors.mutedForeground },
  rowValue: { fontSize: typography.body.fontSize, fontWeight: '700', color: colors.foreground },
  paymentCard: { gap: spacing.sm, alignItems: 'stretch' },
  sectionTitle: { fontSize: typography.label.fontSize, fontWeight: '700', color: colors.foreground },
  hint: { fontSize: typography.body.fontSize, color: colors.mutedForeground },
  errorBanner: { backgroundColor: colors.destructive, borderRadius: radius.lg, padding: spacing.md },
  errorText: { color: colors.destructiveForeground, fontSize: typography.body.fontSize },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17,20,26,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: { gap: spacing.md, width: '100%' },
  modalTitle: { fontSize: typography.title.fontSize, fontWeight: typography.title.fontWeight, color: colors.foreground },
  modalMessage: { fontSize: typography.body.fontSize, color: colors.mutedForeground },
  modalActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
});
