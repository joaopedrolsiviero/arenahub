import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { Screen } from '@/components/Screen';
import { Header } from '@/components/Header';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { LoadingState } from '@/components/LoadingState';
import { ErrorState } from '@/components/ErrorState';
import { EmptyState } from '@/components/EmptyState';
import { BookingStatusBadge } from '@/components/BookingStatusBadge';
import { PaymentStatusBadge } from '@/components/PaymentStatusBadge';
import { useMyBookings } from '@/hooks/useMyBookings';
import { useMyPaymentStatuses } from '@/hooks/usePayment';
import { formatCurrencyBRL, formatDateInZone, formatTimeInZone } from '@/lib/format';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { MyBooking } from '@/types/booking';
import type { PaymentStatus } from '@/types/payment';

type Tab = 'upcoming' | 'past' | 'cancelled';

// Mesma classificação visual do Web (apps/web/src/app/minhas-reservas/page.tsx,
// partition) — puramente de apresentação, a partir de campos que o backend já
// devolve (`status`, `startsAt`); nunca decide disponibilidade, permissão de
// cancelamento ou qualquer outra regra (isso continua só no backend). Dentro
// de "próximas", reordena pela mais próxima primeiro (o backend devolve tudo
// em startsAt desc); "histórico"/"canceladas" mantêm a ordenação do backend.
function partition(bookings: MyBooking[]): Record<Tab, MyBooking[]> {
  const now = Date.now();
  const upcoming: MyBooking[] = [];
  const past: MyBooking[] = [];
  const cancelled: MyBooking[] = [];

  for (const booking of bookings) {
    if (booking.status === 'CANCELLED') {
      cancelled.push(booking);
    } else if (new Date(booking.startsAt).getTime() >= now) {
      upcoming.push(booking);
    } else {
      past.push(booking);
    }
  }
  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { upcoming, past, cancelled };
}

const SIGN_IN_URL = `/(auth)/sign-in?redirect=${encodeURIComponent('/(tabs)/reservas')}`;

const TAB_LABEL: Record<Tab, string> = { upcoming: 'Próximas', past: 'Histórico', cancelled: 'Canceladas' };
const TAB_EMPTY_MESSAGE: Record<Tab, string> = {
  upcoming: 'Você não tem reservas futuras.',
  past: 'Nenhuma reserva no histórico.',
  cancelled: 'Nenhuma reserva cancelada.',
};

function BookingListItem({
  booking,
  paymentStatus,
}: {
  booking: MyBooking;
  paymentStatus: PaymentStatus | undefined;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ver detalhes da reserva em ${booking.court.arena.name}`}
      onPress={() => router.push(`/reservas/${booking.id}`)}
      testID={`booking-item-${booking.id}`}
    >
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.arenaName}>{booking.court.arena.name}</Text>
          <BookingStatusBadge status={booking.status} />
        </View>
        <Text style={styles.courtName}>{booking.court.name}</Text>
        <View style={styles.row}>
          <Text style={styles.dateText}>
            {formatDateInZone(booking.startsAt, booking.court.arena.timezone)} ·{' '}
            {formatTimeInZone(booking.startsAt, booking.court.arena.timezone)}–
            {formatTimeInZone(booking.endsAt, booking.court.arena.timezone)}
          </Text>
          <Text style={styles.total}>{formatCurrencyBRL(booking.total)}</Text>
        </View>
        {booking.court.arena.paymentMode === 'ONLINE' && paymentStatus ? (
          <PaymentStatusBadge status={paymentStatus} />
        ) : null}
      </Card>
    </Pressable>
  );
}

// "Minhas reservas" (M5) — GET /users/me/bookings + GET /users/me/payments
// (confirmados em my-bookings.controller.ts/my-payments.controller.ts antes
// de escrever esta tela) consultados em paralelo, uma chamada cada pra TODAS
// as reservas — nunca uma consulta de pagamento por item da lista (sem N+1).
// Autenticação segue exatamente o padrão já usado em app/(tabs)/perfil.tsx
// (M1): sessão carregando -> loading; deslogado -> CTA pra entrar; nunca um
// segundo mecanismo de auth.
export default function ReservasScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const [tab, setTab] = useState<Tab>('upcoming');

  const canQuery = isLoaded && isSignedIn === true;
  const bookingsQuery = useMyBookings(canQuery);
  const paymentStatusesQuery = useMyPaymentStatuses(canQuery);

  const groups = useMemo(() => partition(bookingsQuery.data ?? []), [bookingsQuery.data]);
  const visibleBookings = groups[tab];
  const paymentStatuses = paymentStatusesQuery.data ?? {};

  if (!isLoaded) {
    return (
      <Screen>
        <Header title="Minhas reservas" />
        <LoadingState label="Carregando sessão…" />
      </Screen>
    );
  }

  if (!isSignedIn) {
    return (
      <Screen>
        <Header title="Minhas reservas" />
        <Card style={styles.signedOutCard}>
          <Text style={styles.hint}>Entre na sua conta para ver suas reservas.</Text>
          <Button testID="bookings-sign-in" onPress={() => router.push(SIGN_IN_URL)}>
            Entrar
          </Button>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Minhas reservas" />

      {bookingsQuery.isPending ? <LoadingState label="Carregando reservas…" /> : null}

      {bookingsQuery.isError ? (
        <ErrorState
          message="Não foi possível carregar suas reservas."
          onRetry={() => bookingsQuery.refetch()}
        />
      ) : null}

      {!bookingsQuery.isPending && !bookingsQuery.isError && bookingsQuery.data ? (
        bookingsQuery.data.length === 0 ? (
          <EmptyState
            message="Você ainda não tem nenhuma reserva."
            actionLabel="Explorar arenas"
            onAction={() => router.push('/(tabs)/explorar')}
          />
        ) : (
          <>
            <View style={styles.tabs}>
              {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: tab === key }}
                  onPress={() => setTab(key)}
                  testID={`bookings-tab-${key}`}
                  style={[styles.tabButton, tab === key && styles.tabButtonActive]}
                >
                  <Text style={[styles.tabButtonText, tab === key && styles.tabButtonTextActive]}>
                    {TAB_LABEL[key]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {visibleBookings.length === 0 ? (
              <EmptyState message={TAB_EMPTY_MESSAGE[tab]} />
            ) : (
              <FlatList
                data={visibleBookings}
                keyExtractor={(booking) => booking.id}
                renderItem={({ item }) => (
                  <BookingListItem booking={item} paymentStatus={paymentStatuses[item.id]} />
                )}
                ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
              />
            )}
          </>
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  signedOutCard: { gap: spacing.sm },
  hint: { fontSize: typography.body.fontSize, color: colors.mutedForeground },
  tabs: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.muted,
  },
  tabButtonActive: { backgroundColor: colors.brand },
  tabButtonText: { fontSize: typography.label.fontSize, fontWeight: '600', color: colors.mutedForeground },
  tabButtonTextActive: { color: colors.brandForeground },
  list: { paddingBottom: spacing.xl },
  card: { gap: spacing.xs },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  arenaName: {
    flexShrink: 1,
    fontSize: typography.title.fontSize,
    fontWeight: typography.title.fontWeight,
    color: colors.foreground,
  },
  courtName: { fontSize: typography.body.fontSize, color: colors.mutedForeground },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: spacing.xs },
  dateText: { fontSize: typography.caption.fontSize, color: colors.mutedForeground },
  total: { fontSize: typography.body.fontSize, fontWeight: '700', color: colors.foreground },
});
