import { View, Text, StyleSheet } from 'react-native';
import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/constants/theme';

// Equivalente mobile de apps/web/src/components/async-state.tsx
// (ErrorState) — com `onRetry` opcional porque, diferente do Web, a M2
// pede explicitamente um botão "Tentar novamente" que refaça a consulta de
// verdade (nunca só recarregar a tela inteira).
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Button variant="outline" onPress={onRetry} testID="error-retry">
          Tentar novamente
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  message: {
    fontSize: typography.body.fontSize,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
});
