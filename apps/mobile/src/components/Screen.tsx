import { type ReactNode } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@/constants/theme';

// Fundação de toda tela (item 20 do prompt) — respeita safe area (notch/home
// indicator/status bar) e aplica o background de marca, pra nenhuma tela
// precisar repetir isso. Padding horizontal consistente; `contentStyle`
// permite uma tela específica ajustar layout (ex: sem padding, scroll) sem
// duplicar o componente.
export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={[styles.content, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
});
