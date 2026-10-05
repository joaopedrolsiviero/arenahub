'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useDiscoverArena, useAvailability, useCreateBooking } from '@/hooks/use-api';
import { AvailabilityGrid } from '@/components/availability-grid';
import { BookingSummaryCard } from '@/components/booking-summary-card';
import { DashboardDateNav } from '@/components/dashboard-date-nav';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatCurrencyBRL, localDayWindowToUtc, todayInZone } from '@/lib/format';
import { ApiError } from '@/lib/api';
import type { AvailabilitySlot } from '@/lib/types';

// Fase 32 — extraído de page.tsx: continua sendo o mesmo componente cliente
// de sempre (mesmos hooks/estado/lógica de reserva), só passou a receber
// `arenaId` já resolvido pela rota (que agora aceita :arenaSlug), em vez de
// ler o parâmetro direto da URL — page.tsx precisou virar Server Component
// pra poder ter generateMetadata. `pathname` (usado em `signInHref` abaixo)
// já reflete a URL real com o slug automaticamente, sem nenhuma mudança
// aqui — nunca duas fontes de verdade pra mesma seleção.
export function CourtBooking({ arenaId, courtId }: { arenaId: string; courtId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get('date');
  const slotParam = searchParams.get('slots');
  const { userId, isLoaded: isAuthLoaded } = useAuth();

  const { data: arena, isPending: isArenaPending, isError: isArenaError } = useDiscoverArena(arenaId);
  const court = arena?.courts.find((c) => c.id === courtId);

  // A data padrão (hoje no timezone da arena) só existe depois que a arena
  // carrega — antes disso não sabemos o timezone correto (item 76-77).
  useEffect(() => {
    if (arena && !dateParam) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('date', todayInZone(arena.timezone));
      router.replace(`?${params.toString()}`);
    }
  }, [arena, dateParam, router, searchParams]);

  const date = dateParam ?? (arena ? todayInZone(arena.timezone) : null);

  const window = useMemo(
    () => (arena && date ? localDayWindowToUtc(date, arena.timezone) : null),
    [arena, date],
  );

  const {
    data: availability,
    isPending: isAvailabilityPending,
    isError: isAvailabilityError,
  } = useAvailability(arenaId, courtId, window?.from, window?.to);

  // Fase "múltiplos horários": um Set de `startsAt` (não mais um único
  // slot) — o cliente pode escolher vários horários (ex: 09:00+10:00+11:00)
  // numa única ação de reserva. O backend decide se viram um Booking
  // contínuo ou vários separados (ver BookingsService.createCustomerBookingBatch);
  // aqui só importa QUAIS horários foram escolhidos.
  const [selectedStartTimes, setSelectedStartTimes] = useState<Set<string>>(new Set());
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // Slots selecionados, sempre ordenados por horário — derivado de
  // `availability` + `selectedStartTimes`, nunca guardado como estado
  // próprio (uma única fonte de verdade, a mesma prevenção de divergência
  // já usada no restante do arquivo).
  const selectedSlots = useMemo(() => {
    if (!availability) return [];
    return availability.slots
      .filter((slot) => selectedStartTimes.has(slot.startsAt))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [availability, selectedStartTimes]);

  function updateSlotsParam(startTimes: Set<string>) {
    const params = new URLSearchParams(searchParams.toString());
    if (startTimes.size > 0) {
      params.set('slots', [...startTimes].sort().join(','));
    } else {
      params.delete('slots');
    }
    router.replace(`?${params.toString()}`);
  }

  // Chave de idempotência estável para a MESMA tentativa lógica (mesmo
  // CONJUNTO de horários selecionados) — só troca quando a seleção muda,
  // nunca a cada clique/retry (item 25-27). A seleção também vai pra URL
  // (item novo da Fase 29): um visitante sem conta que escolhe horários e é
  // mandado pro login volta pra cá com a MESMA seleção, sem escolher de novo.
  function handleToggleSlot(slot: AvailabilitySlot) {
    setConflictMessage(null);
    // Calculado fora do updater do setState: o updater roda durante o render
    // e precisa ser puro — chamar router.replace lá dentro atualiza o Router
    // no meio do render do CourtBooking.
    const next = new Set(selectedStartTimes);
    if (next.has(slot.startsAt)) {
      next.delete(slot.startsAt);
    } else {
      next.add(slot.startsAt);
    }
    setSelectedStartTimes(next);
    updateSlotsParam(next);
    setIdempotencyKey(crypto.randomUUID());
  }

  function handleDateChange(value: string) {
    setSelectedStartTimes(new Set());
    setIdempotencyKey(null);
    setConflictMessage(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set('date', value);
    params.delete('slots');
    router.replace(`?${params.toString()}`);
  }

  // Restaura a seleção a partir da URL (Fase 29) — cobre exatamente o caso
  // de ida-e-volta pelo login: `arenaId`/`courtId`/`date`/`slots` nunca saem
  // da URL, então nunca dependem de estado local que o redirect apagaria.
  // Ajuste de estado DURANTE o render (nunca num useEffect) — padrão
  // recomendado pelo React pra "derivar estado de um valor que mudou": a
  // guarda `selectedStartTimes.size === 0` já impede loop (falsa a partir do
  // próprio re-render que a chamada de setState dispara).
  if (availability && selectedStartTimes.size === 0 && slotParam) {
    const requested = new Set(slotParam.split(','));
    const matched = new Set(
      availability.slots
        .filter((slot) => requested.has(slot.startsAt) && slot.available)
        .map((slot) => slot.startsAt),
    );
    if (matched.size > 0) {
      setSelectedStartTimes(matched);
      setIdempotencyKey(crypto.randomUUID());
    }
  }

  const createBooking = useCreateBooking(arenaId, courtId);
  const queryClient = useQueryClient();

  // Fase 35, item 16 — construído a partir de `date`/`selectedSlots` (estado
  // local já confirmado), nunca de `searchParams`, pelo mesmo motivo do
  // `signInHref` abaixo: o `router.replace` de `updateSlotsParam` é
  // assíncrono, então a URL do navegador só reflete a seleção mais recente
  // depois de um re-render. Reaproveitado tanto pro link "Entrar para
  // confirmar reserva" quanto pelo tratamento de sessão expirada em
  // `handleConfirm` — nunca duas fórmulas divergentes pra mesma URL.
  function signInUrl(): string {
    return `/sign-in?redirect_url=${encodeURIComponent(
      `${pathname}?${new URLSearchParams({
        ...(date ? { date } : {}),
        ...(selectedSlots.length > 0
          ? { slots: selectedSlots.map((slot) => slot.startsAt).join(',') }
          : {}),
      }).toString()}`,
    )}`;
  }

  async function handleConfirm() {
    if (selectedSlots.length === 0 || !idempotencyKey) return;
    setConflictMessage(null);
    try {
      const [first, ...rest] = selectedSlots;
      const booking = await createBooking.mutateAsync({
        startsAt: first!.startsAt,
        additionalStartTimes: rest.map((slot) => slot.startsAt),
        idempotencyKey,
      });
      // Múltiplos horários podem virar mais de um Booking (trechos não
      // consecutivos, ver BookingsService.createCustomerBookingBatch) — a
      // tela de detalhe só mostra uma reserva por vez, então navegamos pra
      // primeira (cronologicamente); as demais continuam acessíveis em
      // "Minhas reservas".
      const firstBooking = Array.isArray(booking) ? booking[0]! : booking;
      router.push(`/minhas-reservas/${firstBooking.id}?created=true`);
    } catch (error) {
      // 409 (conflito de horário) e 400 (BookingsService.assertNotPast — um
      // horário selecionado já começou entre a seleção e a confirmação,
      // item "bloqueio de horários passados") recebem o MESMO tratamento:
      // o backend é sempre a autoridade final, então em ambos os casos a
      // seleção não é mais válida e a grade precisa refletir isso, nunca só
      // o texto do erro cru.
      if (error instanceof ApiError && (error.status === 409 || error.status === 400)) {
        setConflictMessage(
          error.status === 400
            ? 'Um dos horários selecionados já passou. Escolha novamente.'
            : selectedSlots.length > 1
              ? 'Um ou mais horários selecionados não estão mais disponíveis. Escolha outros horários.'
              : 'Esse horário não está mais disponível. Escolha outro horário.',
        );
        setSelectedStartTimes(new Set());
        updateSlotsParam(new Set());
        // A chave é reaproveitada só para retries da MESMA seleção; como a
        // seleção ficou indisponível, a próxima tentativa é uma nova
        // tentativa lógica.
        setIdempotencyKey(null);
        // Força a grade a refletir o estado real (item 20/39-42) — o backend
        // continua sendo a única autoridade sobre disponibilidade.
        await queryClient.invalidateQueries({ queryKey: ['availability', arenaId, courtId] });
      } else if (error instanceof ApiError && error.status === 401) {
        // Fase 35, item 16 — a sessão expirou entre a seleção do horário e a
        // confirmação. "Tente novamente" nunca resolveria isso (o próximo
        // clique falharia do mesmo jeito) — manda de volta pro login
        // preservando a mesma seleção, mesma convenção de `redirect_url` já
        // usada no restante do fluxo.
        router.push(signInUrl());
      } else {
        setConflictMessage('Não foi possível confirmar a reserva. Tente novamente.');
      }
    }
  }

  if (isArenaPending) {
    return <LoadingState label="Carregando quadra…" />;
  }
  if (isArenaError || !arena) {
    return <ErrorState message="Não foi possível carregar esta arena." />;
  }
  if (!court) {
    return <ErrorState message="Quadra não encontrada ou indisponível." />;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* Fase 33, item 3/17 — antes era texto puro: quem escolheu a
              quadra errada só voltava pelo botão do navegador. Uma arena com
              mais de uma quadra precisa de um jeito óbvio de comparar. */}
          <Link
            href={`/arenas/${arena.slug}`}
            className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {arena.name}
          </Link>
          <h1 className="font-heading text-2xl font-bold tracking-tight">{court.name}</h1>
        </div>
        <div className="flex items-baseline gap-1.5 rounded-xl bg-brand/10 px-3 py-2">
          <span className="tabular text-lg font-bold">{formatCurrencyBRL(court.pricePerSlot)}</span>
          <span className="text-xs text-muted-foreground">/ {court.slotDurationMinutes}min</span>
        </div>
      </div>

      {date ? (
        <DashboardDateNav date={date} timezone={arena.timezone} onChange={handleDateChange} />
      ) : null}

      {conflictMessage ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Horário indisponível</AlertTitle>
          <AlertDescription>{conflictMessage}</AlertDescription>
        </Alert>
      ) : null}

      {isAvailabilityPending ? <LoadingState label="Carregando horários…" /> : null}
      {isAvailabilityError ? (
        <ErrorState message="Não foi possível carregar os horários disponíveis." />
      ) : null}
      {availability && availability.slots.length === 0 ? (
        <EmptyState message="Sem horários para esta data — a arena está fechada ou não há grade disponível." />
      ) : null}

      {availability && availability.slots.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-sm font-semibold">
            Horários disponíveis
            {/* Fase "múltiplos horários" — dica curta de que dá pra escolher
                mais de um, sem precisar de um tutorial/onboarding próprio. */}
            <span className="ml-1.5 font-normal text-muted-foreground">
              (selecione um ou mais)
            </span>
          </p>
          <AvailabilityGrid
            slots={availability.slots}
            timezone={availability.timezone}
            selectedStartTimes={selectedStartTimes}
            onToggle={handleToggleSlot}
          />
        </div>
      ) : null}

      {selectedSlots.length > 0 && availability ? (
        <BookingSummaryCard
          court={court}
          slots={selectedSlots}
          timezone={availability.timezone}
          isSubmitting={createBooking.isPending}
          onConfirm={handleConfirm}
          signInHref={isAuthLoaded && !userId ? signInUrl() : undefined}
        />
      ) : null}
    </div>
  );
}
