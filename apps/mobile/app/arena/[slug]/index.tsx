import { useState } from 'react';
import { FlatList, Image, Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/Screen';
import { LoadingState } from '@/components/LoadingState';
import { ErrorState } from '@/components/ErrorState';
import { EmptyState } from '@/components/EmptyState';
import { useDiscoverArena } from '@/hooks/useArenas';
import { formatCurrencyBRL } from '@/lib/format';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { CourtPublic } from '@/types/arena';

const SPORT_LABEL: Record<string, string> = { BEACH_VOLLEYBALL: 'Vôlei de praia' };

// Foto colada pelo OWNER (URL externa, nunca um asset do projeto) — mesma
// regra do Web (CourtCard): placeholder neutro tanto pra "sem foto"
// (`imageUrl` nulo) quanto pra "a URL quebrou" (`onError`), nunca um ícone
// de imagem quebrada nem o card sem altura estável (M2, item 17).
function CourtImage({ imageUrl, label }: { imageUrl: string | null; label: string }) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return (
      <View style={styles.imagePlaceholder} accessibilityLabel={`${label} — sem foto`}>
        <Ionicons name="image-outline" size={28} color={colors.mutedForeground} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: imageUrl }}
      accessibilityLabel={label}
      style={styles.image}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

function CourtListItem({ arenaSlug, court }: { arenaSlug: string; court: CourtPublic }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Escolher quadra ${court.name}`}
      onPress={() => router.push(`/arena/${arenaSlug}/${court.id}`)}
      testID={`court-item-${court.id}`}
      style={styles.courtCard}
    >
      <CourtImage imageUrl={court.imageUrl} label={court.name} />
      <View style={styles.courtInfo}>
        <Text style={styles.courtName}>{court.name}</Text>
        <Text style={styles.courtSport}>{SPORT_LABEL[court.sport] ?? court.sport}</Text>
        <View style={styles.courtMeta}>
          <Text style={styles.courtPrice}>{formatCurrencyBRL(court.pricePerSlot)}</Text>
          <Text style={styles.courtDuration}>/ {court.slotDurationMinutes}min</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

// Detalhe público da arena (GET /arenas/discover/slug/:slug, público) — as
// quadras já vêm embutidas na mesma resposta (M2, item 14/16), nunca uma
// segunda chamada por quadra.
export default function ArenaDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data: arena, isPending, isError, refetch } = useDiscoverArena(slug);

  return (
    <Screen>
      <Stack.Screen options={{ title: arena?.name ?? '' }} />

      {isPending ? <LoadingState label="Carregando arena…" /> : null}
      {isError ? (
        <ErrorState message="Não foi possível carregar esta arena." onRetry={() => refetch()} />
      ) : null}

      {arena ? (
        <FlatList
          data={arena.courts}
          keyExtractor={(court) => court.id}
          ListHeaderComponent={
            <View style={styles.header}>
              {!arena.isReady ? (
                <View style={styles.readyBadge}>
                  <Text style={styles.readyBadgeText}>Em breve</Text>
                </View>
              ) : null}
              {arena.description ? <Text style={styles.description}>{arena.description}</Text> : null}
              {arena.phone ? (
                <View style={styles.contactRow}>
                  <Ionicons name="call-outline" size={16} color={colors.mutedForeground} />
                  <Text style={styles.contactText}>{arena.phone}</Text>
                </View>
              ) : null}
              {arena.email ? (
                <View style={styles.contactRow}>
                  <Ionicons name="mail-outline" size={16} color={colors.mutedForeground} />
                  <Text style={styles.contactText}>{arena.email}</Text>
                </View>
              ) : null}
              <Text style={styles.sectionTitle}>Quadras</Text>
            </View>
          }
          renderItem={({ item }) => <CourtListItem arenaSlug={arena.slug} court={item} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState message="Esta arena ainda não tem quadras cadastradas." />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.xl, paddingTop: spacing.md },
  header: { gap: spacing.sm, marginBottom: spacing.md },
  description: { fontSize: typography.body.fontSize, color: colors.mutedForeground },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  contactText: { fontSize: typography.caption.fontSize, color: colors.mutedForeground },
  sectionTitle: {
    marginTop: spacing.sm,
    fontSize: typography.title.fontSize,
    fontWeight: typography.title.fontWeight,
    color: colors.foreground,
  },
  readyBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  readyBadgeText: { fontSize: typography.caption.fontSize, color: colors.mutedForeground, fontWeight: '600' },
  courtCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.sm,
  },
  image: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.muted },
  imagePlaceholder: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courtInfo: { flex: 1, gap: 2 },
  courtName: { fontSize: typography.body.fontSize, fontWeight: '700', color: colors.foreground },
  courtSport: { fontSize: typography.caption.fontSize, color: colors.mutedForeground },
  courtMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 },
  courtPrice: { fontSize: typography.body.fontSize, fontWeight: '700', color: colors.foreground },
  courtDuration: { fontSize: typography.caption.fontSize, color: colors.mutedForeground },
});
