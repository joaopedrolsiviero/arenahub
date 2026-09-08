import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { BookingStatus } from '@/types/booking';

// Equivalente mobile de apps/web/src/components/booking-status-badge.tsx —
// mesmo princípio (ícone + label sempre juntos, nunca só cor). `BookingStatus`
// do backend só tem CONFIRMED/CANCELLED (confirmado em bookings.service.ts);
// nenhum outro valor é tratado aqui.
export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const isCancelled = status === 'CANCELLED';
  return (
    <View style={[styles.badge, isCancelled ? styles.destructive : styles.success]}>
      <Ionicons
        name={isCancelled ? 'close-circle' : 'checkmark-circle'}
        size={13}
        color={isCancelled ? colors.destructiveForeground : colors.successForeground}
      />
      <Text style={[styles.label, isCancelled ? styles.destructiveText : styles.successText]}>
        {isCancelled ? 'Cancelada' : 'Confirmada'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  label: { fontSize: typography.caption.fontSize, fontWeight: '700' },
  success: { backgroundColor: colors.success },
  successText: { color: colors.successForeground },
  destructive: { backgroundColor: colors.destructive },
  destructiveText: { color: colors.destructiveForeground },
});
