import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { PaymentStatus } from '@/types/payment';

// Equivalente mobile de apps/web/src/components/payment-status-badge.tsx —
// mesmos 7 estados, mesmas labels em português, mesmo princípio (ícone +
// label). REFUNDED nunca reaproveita o visual de PAID — "reembolsado"
// precisa ser inconfundível com "pago" numa leitura rápida da lista.
const CONFIG: Record<PaymentStatus, { icon: keyof typeof Ionicons.glyphMap; label: string; tone: 'success' | 'warning' | 'destructive' | 'muted' }> = {
  PAID: { icon: 'checkmark-circle', label: 'Pago', tone: 'success' },
  PENDING: { icon: 'time-outline', label: 'Aguardando pagamento', tone: 'warning' },
  FAILED: { icon: 'close-circle', label: 'Pagamento recusado', tone: 'destructive' },
  EXPIRED: { icon: 'close-circle', label: 'Expirado', tone: 'destructive' },
  CANCELLED: { icon: 'close-circle', label: 'Cancelado', tone: 'muted' },
  REFUNDING: { icon: 'time-outline', label: 'Reembolso em processamento', tone: 'warning' },
  REFUNDED: { icon: 'arrow-undo', label: 'Reembolsado', tone: 'muted' },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const config = CONFIG[status];
  return (
    <View style={[styles.badge, toneStyles[config.tone]]}>
      <Ionicons name={config.icon} size={13} color={toneTextColor[config.tone]} />
      <Text style={[styles.label, { color: toneTextColor[config.tone] }]}>{config.label}</Text>
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
});

const toneStyles = StyleSheet.create({
  success: { backgroundColor: colors.success },
  warning: { backgroundColor: colors.warning },
  destructive: { backgroundColor: colors.destructive },
  muted: { backgroundColor: colors.muted },
});

const toneTextColor = {
  success: colors.successForeground,
  warning: colors.warningForeground,
  destructive: colors.destructiveForeground,
  muted: colors.mutedForeground,
} as const;
