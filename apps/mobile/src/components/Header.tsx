import { View, Text, StyleSheet } from 'react-native';
import { Brand } from '@/components/Brand';
import { colors, spacing, typography } from '@/constants/theme';

// Cabeçalho reaproveitado pelas quatro abas — marca sempre visível (mesmo
// papel do <SiteHeader> do Web), com um título específico da tela abaixo.
export function Header({ title }: { title?: string }) {
  return (
    <View style={styles.container}>
      <Brand variant="full" height={28} />
      {title ? <Text style={styles.title}>{title}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.title.fontSize,
    fontWeight: typography.title.fontWeight,
    color: colors.foreground,
  },
});
