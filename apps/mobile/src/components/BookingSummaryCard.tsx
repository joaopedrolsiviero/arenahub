import { Link } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { formatCurrencyBRL, formatDateLabel, formatTimeInZone } from '@/lib/format';
import { colors, spacing, typography } from '@/constants/theme';
import type { CourtPublic } from '@/types/arena';

function Row({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, emphasis && styles.rowValueEmphasis]}>{value}</Text>
    </View>
  );
}

// Espelha BookingSummaryCard do Web (apps/web/src/components/booking-summary-card.tsx)
// — mesmo cálculo (pricePerSlot × quantidade de horários, sempre uma
// ESTIMATIVA de exibição, nunca o valor final: quem decide o total real é
// sempre o Booking devolvido pelo POST, M3 item 21/22) e mesma troca de
// botão por link quando `signInHref` está presente (visitante sem conta
// chega até aqui, mas confirmar continua exigindo login).
export function BookingSummaryCard({
  arenaName,
  court,
  date,
  startTimes,
  timezone,
  isSubmitting,
  onConfirm,
  signInHref,
}: {
  arenaName: string;
  court: CourtPublic;
  date: string;
  startTimes: string[];
  timezone: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  signInHref?: string;
}) {
  const total = Number(court.pricePerSlot) * startTimes.length;
  const horariosLabel = startTimes
    .map((iso) => formatTimeInZone(iso, timezone))
    .sort()
    .join(', ');

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Resumo da reserva</Text>
      <Text style={styles.arenaName}>{arenaName}</Text>
      <Row label="Quadra" value={court.name} />
      <Row label="Data" value={formatDateLabel(date)} />
      <Row label={startTimes.length > 1 ? 'Horários' : 'Horário'} value={horariosLabel} />
      <View style={styles.divider} />
      <Row label="Total" value={formatCurrencyBRL(total)} emphasis />

      {signInHref ? (
        <Link href={signInHref} asChild>
          <Button testID="summary-sign-in">Entrar para confirmar reserva</Button>
        </Link>
      ) : (
        <Button onPress={onConfirm} disabled={isSubmitting} testID="summary-confirm">
          {isSubmitting ? 'Confirmando…' : 'Confirmar reserva'}
        </Button>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  title: { fontSize: typography.title.fontSize, fontWeight: typography.title.fontWeight, color: colors.foreground },
  arenaName: { fontSize: typography.caption.fontSize, color: colors.mutedForeground, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  rowLabel: { fontSize: typography.caption.fontSize, color: colors.mutedForeground },
  rowValue: { fontSize: typography.body.fontSize, fontWeight: '600', color: colors.foreground },
  rowValueEmphasis: { fontSize: typography.title.fontSize, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
});
