import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { formatCurrencyBRL, formatDateInZone, formatTimeInZone } from '@/lib/format';
import { colors, spacing, typography } from '@/constants/theme';
import type { BookingStatus } from '@/types/booking';

const STATUS_LABEL: Record<BookingStatus, string> = {
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
};

// Tela de sucesso (M3, item 25) — mostra exatamente o que o POST
// .../bookings devolveu, nunca uma segunda consulta nem dado inventado
// (item 27/28: o response real vira params de rota ao navegar pra cá, ver
// handleConfirm em arena/[slug]/[courtId].tsx).
//
// M4, item 7/21 — a partir desta fase, só é alcançada quando
// `arena.paymentMode === 'IN_PERSON'` (ONLINE vai para /pagamento/[bookingId]
// em vez desta tela). `POST .../payments` NUNCA é chamado a partir daqui —
// nem importado, nem referenciado.
export default function ReservaConfirmadaScreen() {
  const { bookingId, status, startsAt, endsAt, total, count, arenaName, courtName, timezone, paymentMode } =
    useLocalSearchParams<{
      bookingId: string;
      status: BookingStatus;
      startsAt: string;
      endsAt: string;
      total: string;
      count: string;
      arenaName: string;
      courtName: string;
      timezone: string;
      paymentMode?: 'IN_PERSON';
    }>();

  const extraCount = Number(count) - 1;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Reserva confirmada', headerBackVisible: false }} />
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="checkmark-circle" size={56} color={colors.brand} />
        </View>
        <Text style={styles.title}>Reserva realizada!</Text>

        <Card style={styles.card}>
          <Text style={styles.arenaName}>{arenaName}</Text>
          <Text style={styles.courtName}>{courtName}</Text>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Data</Text>
            <Text style={styles.rowValue}>{formatDateInZone(startsAt, timezone)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Horário</Text>
            <Text style={styles.rowValue}>
              {formatTimeInZone(startsAt, timezone)}–{formatTimeInZone(endsAt, timezone)}
            </Text>
          </View>
          {extraCount > 0 ? (
            <Text style={styles.extraHint}>
              + {extraCount} {extraCount === 1 ? 'outra reserva criada' : 'outras reservas criadas'} pra
              esta seleção — todas em &quot;Minhas reservas&quot;.
            </Text>
          ) : null}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Status</Text>
            <Text style={styles.rowValue}>{STATUS_LABEL[status] ?? status}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Total</Text>
            <Text style={[styles.rowValue, styles.total]}>{formatCurrencyBRL(total)}</Text>
          </View>
          <Text style={styles.bookingId}>Reserva {bookingId}</Text>
        </Card>

        {paymentMode === 'IN_PERSON' ? (
          <Card style={styles.inPersonCard}>
            <Ionicons name="cash-outline" size={20} color={colors.mutedForeground} />
            <Text style={styles.inPersonText} testID="in-person-notice">
              O pagamento será realizado presencialmente na arena.
            </Text>
          </Card>
        ) : null}

        <Button onPress={() => router.replace('/(tabs)/reservas')} testID="see-my-bookings">
          Ver minhas reservas
        </Button>
        <Button variant="ghost" onPress={() => router.replace('/(tabs)')} testID="back-home">
          Voltar ao início
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: spacing.lg },
  iconWrap: { alignItems: 'center' },
  title: {
    fontSize: typography.heading.fontSize,
    fontWeight: typography.heading.fontWeight,
    color: colors.foreground,
    textAlign: 'center',
  },
  card: { gap: spacing.xs },
  arenaName: { fontSize: typography.caption.fontSize, color: colors.mutedForeground },
  courtName: { fontSize: typography.title.fontSize, fontWeight: typography.title.fontWeight, color: colors.foreground },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rowLabel: { fontSize: typography.caption.fontSize, color: colors.mutedForeground },
  rowValue: { fontSize: typography.body.fontSize, fontWeight: '600', color: colors.foreground },
  total: { fontSize: typography.title.fontSize, fontWeight: '700' },
  extraHint: { fontSize: typography.caption.fontSize, color: colors.mutedForeground, marginTop: spacing.xs },
  inPersonCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  inPersonText: { flex: 1, fontSize: typography.caption.fontSize, color: colors.mutedForeground },
  bookingId: {
    fontSize: typography.caption.fontSize,
    color: colors.mutedForeground,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
