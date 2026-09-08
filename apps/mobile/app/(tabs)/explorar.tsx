import { FlatList, Pressable, Text, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Header } from '@/components/Header';
import { Card } from '@/components/Card';
import { LoadingState } from '@/components/LoadingState';
import { ErrorState } from '@/components/ErrorState';
import { EmptyState } from '@/components/EmptyState';
import { useDiscoverArenas } from '@/hooks/useArenas';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { ArenaDiscoverySummary } from '@/types/arena';

const SPORT_LABEL: Record<string, string> = { BEACH_VOLLEYBALL: 'Vôlei de praia' };

// Item da lista — só usado aqui, mantido local em vez de um componente
// próprio em src/components (M2, item 26: reaproveitar os tokens da M1,
// não criar uma arquitetura nova para um pedaço de UI de uso único).
function ArenaListItem({ arena }: { arena: ArenaDiscoverySummary }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${arena.name}`}
      onPress={() => router.push(`/arena/${arena.slug}`)}
      testID={`arena-item-${arena.slug}`}
    >
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.name}>{arena.name}</Text>
          {!arena.isReady ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Em breve</Text>
            </View>
          ) : null}
        </View>
        {arena.description ? <Text style={styles.description}>{arena.description}</Text> : null}
        <View style={styles.sports}>
          {arena.sports.map((sport) => (
            <View key={sport} style={styles.sportChip}>
              <Text style={styles.sportChipText}>{SPORT_LABEL[sport] ?? sport}</Text>
            </View>
          ))}
        </View>
      </Card>
    </Pressable>
  );
}

// Explorar — primeira tela funcional da M2 (GET /arenas/discover, público,
// nunca exige Clerk). Estados explícitos (loading/erro/vazio/sucesso, M2
// item 13) — nenhum deles é um "carregando" genérico.
export default function ExplorarScreen() {
  const { data: arenas, isPending, isError, refetch } = useDiscoverArenas();

  return (
    <Screen>
      <Header title="Explorar arenas" />

      {isPending ? <LoadingState label="Carregando arenas…" /> : null}

      {isError ? (
        <ErrorState message="Não foi possível carregar as arenas." onRetry={() => refetch()} />
      ) : null}

      {!isPending && !isError && arenas && arenas.length === 0 ? (
        <EmptyState message="Nenhuma arena disponível no momento." />
      ) : null}

      {arenas && arenas.length > 0 ? (
        <FlatList
          data={arenas}
          keyExtractor={(arena) => arena.id}
          renderItem={({ item }) => <ArenaListItem arena={item} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.xl },
  card: { gap: spacing.xs },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: {
    flexShrink: 1,
    fontSize: typography.title.fontSize,
    fontWeight: typography.title.fontWeight,
    color: colors.foreground,
  },
  description: { fontSize: typography.body.fontSize, color: colors.mutedForeground },
  sports: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  sportChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  sportChipText: { fontSize: typography.caption.fontSize, color: colors.foreground },
  badge: {
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeText: { fontSize: typography.caption.fontSize, color: colors.mutedForeground, fontWeight: '600' },
});
