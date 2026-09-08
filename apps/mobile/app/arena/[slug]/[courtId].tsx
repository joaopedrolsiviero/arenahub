import { useMemo, useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { Screen } from '@/components/Screen';
import { LoadingState } from '@/components/LoadingState';
import { ErrorState } from '@/components/ErrorState';
import { EmptyState } from '@/components/EmptyState';
import { BookingSummaryCard } from '@/components/BookingSummaryCard';
import { useDiscoverArena } from '@/hooks/useArenas';
import { useCourtAvailability } from '@/hooks/useAvailability';
import { useCreateBooking } from '@/hooks/useCreateBooking';
import { formatDateLabel, localDayWindowToUtc, shiftDate, todayInZone, formatTimeInZone } from '@/lib/format';
import { ApiError } from '@/api/client';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { AvailabilitySlot } from '@/types/arena';
import type { Booking } from '@/types/booking';

// Passo de data simples (M2, item 19) — anterior/próximo dia + rótulo,
// mesmo padrão do DashboardDateNav do Web. Nunca um calendário completo
// (fora de escopo desta fase). `disabled` no botão "anterior" quando já
// está no primeiro dia consultável (hoje no timezone da arena) — impede
// navegar pra datas passadas, coerente com o backend (que já marca todo
// slot passado como indisponível de qualquer forma).
function DateStepper({
  date,
  timezone,
  minDate,
  onChange,
}: {
  date: string;
  timezone: string;
  minDate: string;
  onChange: (next: string) => void;
}) {
  const atMin = date <= minDate;
  return (
    <View style={styles.dateStepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dia anterior"
        disabled={atMin}
        onPress={() => onChange(shiftDate(date, timezone, -1))}
        style={[styles.dateButton, atMin && styles.dateButtonDisabled]}
        testID="date-prev"
      >
        <Ionicons name="chevron-back" size={20} color={atMin ? colors.mutedForeground : colors.foreground} />
      </Pressable>
      <Text style={styles.dateLabel}>{formatDateLabel(date)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Próximo dia"
        onPress={() => onChange(shiftDate(date, timezone, 1))}
        style={styles.dateButton}
        testID="date-next"
      >
        <Ionicons name="chevron-forward" size={20} color={colors.foreground} />
      </Pressable>
    </View>
  );
}

// M3 — slots ficam selecionáveis (M2 só exibia). Um horário indisponível
// nunca dispara onToggle (o backend continua sendo a autoridade final —
// item 12/42 do prompt: isto é só UX, nunca uma garantia).
function SlotChip({
  slot,
  timezone,
  selected,
  onToggle,
}: {
  slot: AvailabilitySlot;
  timezone: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const label = formatTimeInZone(slot.startsAt, timezone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !slot.available, selected }}
      disabled={!slot.available}
      onPress={onToggle}
      testID={`slot-${slot.startsAt}`}
      accessibilityLabel={
        slot.available ? `Selecionar horário ${label}` : `Horário ${label} indisponível`
      }
      style={[
        styles.slot,
        selected && styles.slotSelected,
        !selected && slot.available && styles.slotAvailable,
        !slot.available && styles.slotUnavailable,
      ]}
    >
      <Text
        style={[
          styles.slotText,
          selected && styles.slotTextSelected,
          !slot.available && styles.slotTextUnavailable,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function CourtAvailabilityScreen() {
  const { slug, courtId, date: dateParam, slots: slotsParam } = useLocalSearchParams<{
    slug: string;
    courtId: string;
    date?: string;
    slots?: string;
  }>();
  const { userId, isLoaded: isAuthLoaded } = useAuth();
  const { data: arena, isPending: isArenaPending, isError: isArenaError, refetch: refetchArena } =
    useDiscoverArena(slug);
  const court = arena?.courts.find((c) => c.id === courtId);

  // Data padrão (hoje no timezone da arena) via query param — sincronizada
  // pelo próprio router (nunca um `useState` local): sobrevive à
  // navegação pra tela de login e volta (M3, item 7/9), mesmo mecanismo já
  // usado pelo Web (court-booking.tsx) pra `date`/`slots` na URL. Efeito
  // (não ajuste durante o render) porque `router.setParams` é uma
  // atualização de sistema EXTERNO à árvore React, não estado local.
  useEffect(() => {
    if (arena && !dateParam) {
      router.setParams({ date: todayInZone(arena.timezone) });
    }
  }, [arena, dateParam]);
  const date = dateParam ?? (arena ? todayInZone(arena.timezone) : null);

  // Seleção de horários — Set local (mesma escolha do Web) espelhado no
  // parâmetro `slots` da própria rota a cada mudança; é esse parâmetro,
  // não o Set, que sobrevive ao remount desta tela depois do login.
  const [selectedStartTimes, setSelectedStartTimes] = useState<Set<string>>(new Set());
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const window = useMemo(
    () => (arena && date ? localDayWindowToUtc(date, arena.timezone) : null),
    [arena, date],
  );
  const {
    data: availability,
    isPending: isAvailabilityPending,
    isError: isAvailabilityError,
    refetch: refetchAvailability,
  } = useCourtAvailability(arena?.id, courtId, window?.from, window?.to);

  const selectedSlots = useMemo(() => {
    if (!availability) return [];
    return availability.slots
      .filter((slot) => selectedStartTimes.has(slot.startsAt))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [availability, selectedStartTimes]);

  function updateSlotsParam(startTimes: Set<string>) {
    router.setParams({ slots: startTimes.size > 0 ? [...startTimes].sort().join(',') : '' });
  }

  function handleToggleSlot(slot: AvailabilitySlot) {
    setConflictMessage(null);
    setSelectedStartTimes((current) => {
      const next = new Set(current);
      if (next.has(slot.startsAt)) {
        next.delete(slot.startsAt);
      } else {
        next.add(slot.startsAt);
      }
      updateSlotsParam(next);
      return next;
    });
    setIdempotencyKey(Crypto.randomUUID());
  }

  function handleDateChange(nextDate: string) {
    setSelectedStartTimes(new Set());
    setIdempotencyKey(null);
    setConflictMessage(null);
    router.setParams({ date: nextDate, slots: '' });
  }

  // Restaura a seleção a partir da URL (M3, item 7/33) — cobre exatamente
  // a ida-e-volta pelo login: `slug`/`courtId`/`date`/`slots` nunca saem da
  // URL. Ajuste DURANTE o render (mesmo padrão já usado pra `date` na M2 e
  // pelo Web pra este caso específico): a guarda `size===0` impede loop.
  if (availability && selectedStartTimes.size === 0 && slotsParam) {
    const requested = new Set(slotsParam.split(',').filter(Boolean));
    const matched = new Set(
      availability.slots
        .filter((slot) => requested.has(slot.startsAt) && slot.available)
        .map((slot) => slot.startsAt),
    );
    if (matched.size > 0) {
      setSelectedStartTimes(matched);
      setIdempotencyKey(Crypto.randomUUID());
    }
  }

  const createBooking = useCreateBooking(arena?.id ?? '', courtId ?? '');

  // Mesma fórmula usada tanto pelo link "Entrar para confirmar reserva"
  // quanto pelo tratamento de sessão expirada (401) em handleConfirm —
  // nunca duas versões divergentes da mesma URL de retorno (M3, item 35).
  function signInUrl(): string {
    const query = new URLSearchParams({
      ...(date ? { date } : {}),
      ...(selectedSlots.length > 0
        ? { slots: selectedSlots.map((slot) => slot.startsAt).join(',') }
        : {}),
    }).toString();
    return `/(auth)/sign-in?redirect=${encodeURIComponent(`/arena/${slug}/${courtId}?${query}`)}`;
  }

  async function handleConfirm() {
    if (selectedSlots.length === 0 || !idempotencyKey || !arena) return;
    setConflictMessage(null);
    try {
      const [first, ...rest] = selectedSlots;
      const result = await createBooking.mutateAsync({
        startsAt: first!.startsAt,
        additionalStartTimes: rest.map((slot) => slot.startsAt),
        idempotencyKey,
      });
      const bookings: Booking[] = Array.isArray(result) ? result : [result];
      const firstBooking = bookings[0]!;

      // Reserva criada — limpa o draft (M3, item 29): nunca deixar a mesma
      // seleção disponível pra uma nova tentativa acidental.
      setSelectedStartTimes(new Set());
      setIdempotencyKey(null);
      const bookingParams = {
        bookingId: firstBooking.id,
        status: firstBooking.status,
        startsAt: firstBooking.startsAt,
        endsAt: firstBooking.endsAt,
        total: firstBooking.total,
        count: String(bookings.length),
        arenaName: arena.name,
        courtName: court?.name ?? '',
        timezone: arena.timezone,
      };
      // M4, item 7/8/21 — só `arena.paymentMode` (vindo do banco, nunca de
      // um valor do cliente) decide o próximo passo: ONLINE segue pro
      // fluxo de PIX; IN_PERSON encerra direto na confirmação, sem NUNCA
      // chamar o endpoint de pagamento.
      if (arena.paymentMode === 'ONLINE') {
        router.replace({ pathname: '/pagamento/[bookingId]', params: bookingParams });
      } else {
        router.replace({
          pathname: '/reserva-confirmada/[bookingId]',
          params: { ...bookingParams, paymentMode: arena.paymentMode },
        });
      }
    } catch (error) {
      // 409 (conflito — horário deixou de estar disponível) e 400
      // (BookingsService.assertNotPast — um horário selecionado já começou
      // entre a seleção e a confirmação) recebem o mesmo tratamento: a
      // seleção não é mais válida, nunca só o texto cru do erro (M3, item
      // 14/38). A grade é invalidada pra refletir o estado real — o
      // backend continua sendo a única autoridade.
      if (error instanceof ApiError && (error.status === 409 || error.status === 400)) {
        setConflictMessage(
          'Esse horário acabou de ser reservado por outra pessoa. Atualize a disponibilidade e escolha outro horário.',
        );
        setSelectedStartTimes(new Set());
        updateSlotsParam(new Set());
        setIdempotencyKey(null);
        await refetchAvailability();
      } else if (error instanceof ApiError && error.status === 401) {
        // Sessão expirou entre montar o resumo e confirmar — "tente
        // novamente" nunca resolveria isso (M3, item 35). Preserva a MESMA
        // seleção via signInUrl(), nunca gera uma segunda.
        router.push(signInUrl());
      } else if (error instanceof ApiError && error.status === 403) {
        setConflictMessage('Você não tem permissão para criar esta reserva.');
      } else {
        // 5xx / erro de rede / timeout — nunca assume que a reserva NÃO foi
        // criada (M3, item 38): o draft e a Idempotency-Key são
        // preservados de propósito, então tocar "Confirmar reserva" de
        // novo reutiliza a MESMA chave, nunca duplica.
        setConflictMessage('Não foi possível concluir a reserva. Tente novamente.');
      }
    }
  }

  if (isArenaPending) {
    return (
      <Screen>
        <LoadingState label="Carregando quadra…" />
      </Screen>
    );
  }
  if (isArenaError) {
    return (
      <Screen>
        <ErrorState message="Não foi possível carregar esta quadra." onRetry={() => refetchArena()} />
      </Screen>
    );
  }
  if (arena && !court) {
    return (
      <Screen>
        <ErrorState message="Quadra não encontrada ou indisponível." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: court?.name ?? '' }} />

      {arena && court && date ? (
        <View style={styles.content}>
          <DateStepper
            date={date}
            timezone={arena.timezone}
            minDate={todayInZone(arena.timezone)}
            onChange={handleDateChange}
          />

          {conflictMessage ? (
            <View accessibilityRole="alert" style={styles.conflictBanner}>
              <Text style={styles.conflictText}>{conflictMessage}</Text>
            </View>
          ) : null}

          {isAvailabilityPending ? <LoadingState label="Carregando horários…" /> : null}
          {isAvailabilityError ? (
            <ErrorState
              message="Não foi possível carregar os horários disponíveis."
              onRetry={() => refetchAvailability()}
            />
          ) : null}
          {availability && availability.slots.length === 0 ? (
            <EmptyState message="Sem horários para esta data — a arena está fechada ou não há grade disponível." />
          ) : null}
          {availability && availability.slots.length > 0 ? (
            <View style={styles.grid} accessibilityRole="list" accessibilityLabel="Horários disponíveis">
              {availability.slots.map((slot) => (
                <SlotChip
                  key={slot.startsAt}
                  slot={slot}
                  timezone={availability.timezone}
                  selected={selectedStartTimes.has(slot.startsAt)}
                  onToggle={() => handleToggleSlot(slot)}
                />
              ))}
            </View>
          ) : null}

          {selectedSlots.length > 0 ? (
            <BookingSummaryCard
              arenaName={arena.name}
              court={court!}
              date={date}
              startTimes={selectedSlots.map((slot) => slot.startsAt)}
              timezone={availability?.timezone ?? arena.timezone}
              isSubmitting={createBooking.isPending}
              onConfirm={handleConfirm}
              signInHref={isAuthLoaded && !userId ? signInUrl() : undefined}
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  dateStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
  },
  dateButton: { padding: spacing.sm },
  dateButtonDisabled: { opacity: 0.4 },
  dateLabel: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.foreground,
    textTransform: 'capitalize',
  },
  conflictBanner: {
    backgroundColor: colors.destructive,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  conflictText: { color: colors.destructiveForeground, fontSize: typography.body.fontSize },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slot: {
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    paddingHorizontal: spacing.sm,
  },
  slotAvailable: { borderColor: colors.brand, backgroundColor: 'transparent' },
  slotSelected: { borderColor: colors.brand, backgroundColor: colors.brand },
  slotUnavailable: { borderColor: colors.border, backgroundColor: colors.muted },
  slotText: { fontSize: typography.body.fontSize, fontWeight: '600', color: colors.foreground },
  slotTextSelected: { color: colors.brandForeground },
  slotTextUnavailable: { color: colors.mutedForeground, textDecorationLine: 'line-through' },
});
