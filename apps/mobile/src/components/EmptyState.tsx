import { View, Text, StyleSheet } from 'react-native';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography } from '@/constants/theme';

// Equivalente mobile de apps/web/src/components/async-state.tsx (EmptyState).
// `actionLabel`/`onAction` são opcionais (M5, item "CTA apropriado para
// descobrir/agendar em uma arena") — quando ausentes, o comportamento é
// idêntico ao das fases anteriores (M2), nenhum uso existente quebra.
export function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <Button variant="outline" onPress={onAction} testID="empty-state-action">
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  message: {
    fontSize: typography.body.fontSize,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
});
