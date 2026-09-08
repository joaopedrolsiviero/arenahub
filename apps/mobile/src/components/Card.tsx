import { type ReactNode } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '@/constants/theme';

// Superfície elevada padrão (mesmo papel do <Card> do Web) — fundo branco
// sobre o off-white de `Screen`, borda sutil em vez de sombra pesada, mesma
// composição "elevação por contraste" do design system do Web.
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
});
