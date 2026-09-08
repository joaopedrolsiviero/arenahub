import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/constants/theme';

// Início — valida navegação (item 21 do prompt), nunca busca de arenas
// (isso é a Fase M2). Mesmo texto de valor do Web (page.tsx da home
// pública), sem repetir os cards de destaque — a fundação só precisa
// provar que a identidade e o caminho até Explorar funcionam.
export default function HomeScreen() {
  return (
    <Screen>
      <Header />
      <View style={styles.content}>
        <Text style={styles.title}>Reserve sua quadra em segundos.</Text>
        <Text style={styles.body}>
          Encontre arenas perto de você, veja horários disponíveis de verdade e garanta sua vaga
          sem ligar pra ninguém.
        </Text>
        <Button onPress={() => router.push('/(tabs)/explorar')} testID="home-explore-button">
          Explorar arenas
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', gap: spacing.md, paddingBottom: spacing['3xl'] },
  title: {
    fontSize: typography.heading.fontSize,
    fontWeight: typography.heading.fontWeight,
    letterSpacing: typography.heading.letterSpacing,
    color: colors.foreground,
  },
  body: {
    fontSize: typography.body.fontSize,
    color: colors.mutedForeground,
    lineHeight: 22,
  },
});
