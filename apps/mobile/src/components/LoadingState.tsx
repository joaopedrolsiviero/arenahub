import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';

// Equivalente mobile de apps/web/src/components/async-state.tsx
// (LoadingState) — estado explícito e distinto de erro/vazio, mesmo
// princípio do Web (nunca um "carregando" genérico misturado com outros
// estados). ErrorState/EmptyState entram junto com as telas que realmente
// buscam dado (fases seguintes) — nenhuma delas é necessária ainda.
export function LoadingState({ label }: { label: string }) {
  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.brand} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: {
    fontSize: typography.body.fontSize,
    color: colors.mutedForeground,
  },
});
