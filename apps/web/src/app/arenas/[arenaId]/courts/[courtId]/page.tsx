'use client';

import { Suspense, use, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useDiscoverArena, useAvailability, useCreateBooking } from '@/hooks/use-api';
import { AvailabilityGrid } from '@/components/availability-grid';
import { BookingSummaryCard } from '@/components/booking-summary-card';
import { DashboardDateNav } from '@/components/dashboard-date-nav';
import { SiteHeader } from '@/components/site-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatCurrencyBRL, localDayWindowToUtc, todayInZone } from '@/lib/format';
import { ApiError } from '@/lib/api';
import type { AvailabilitySlot } from '@/lib/types';

export function CourtBooking({ arenaId, courtId }: { arenaId: string; courtId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get('date');

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

  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // Chave de idempotência estável para a MESMA tentativa lógica (mesmo
  // horário selecionado) — só troca quando a seleção muda, nunca a cada
  // clique/retry (item 25-27).
  function handleSelectSlot(slot: AvailabilitySlot) {
    setConflictMessage(null);
    if (selectedSlot?.startsAt === slot.startsAt) {
      setSelectedSlot(null);
      setIdempotencyKey(null);
      return;
    }
    setSelectedSlot(slot);
    setIdempotencyKey(crypto.randomUUID());
  }

  function handleDateChange(value: string) {
    setSelectedSlot(null);
    setIdempotencyKey(null);
    setConflictMessage(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set('date', value);
    router.replace(`?${params.toString()}`);
  }

  const createBooking = useCreateBooking(arenaId, courtId);
  const queryClient = useQueryClient();

  async function handleConfirm() {
    if (!selectedSlot || !idempotencyKey) return;
    setConflictMessage(null);
    try {
      const booking = await createBooking.mutateAsync({
        startsAt: selectedSlot.startsAt,
        idempotencyKey,
      });
      router.push(`/minhas-reservas/${booking.id}?created=true`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflictMessage('Esse horário não está mais disponível. Escolha outro horário.');
        setSelectedSlot(null);
        // A chave é reaproveitada só para retries do MESMO horário; como o
        // horário mudou (ficou indisponível), a próxima tentativa é uma
        // nova tentativa lógica.
        setIdempotencyKey(null);
        // Força a grade a refletir o estado real (item 20/39-42) — o backend
        // continua sendo a única autoridade sobre disponibilidade.
        await queryClient.invalidateQueries({ queryKey: ['availability', arenaId, courtId] });
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
          <p className="text-sm text-muted-foreground">{arena.name}</p>
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
          <p className="text-sm font-semibold">Horários disponíveis</p>
          <AvailabilityGrid
            slots={availability.slots}
            timezone={availability.timezone}
            selectedStartsAt={selectedSlot?.startsAt ?? null}
            onSelect={handleSelectSlot}
          />
        </div>
      ) : null}

      {selectedSlot && availability ? (
        <BookingSummaryCard
          court={court}
          slot={selectedSlot}
          timezone={availability.timezone}
          isSubmitting={createBooking.isPending}
          onConfirm={handleConfirm}
        />
      ) : null}
    </div>
  );
}

export default function CourtBookingPage({
  params,
}: {
  params: Promise<{ arenaId: string; courtId: string }>;
}) {
  const { arenaId, courtId } = use(params);
  return (
    <RequireAuth>
      <SiteHeader />
      <Suspense fallback={<LoadingState label="Carregando quadra…" />}>
        <CourtBooking arenaId={arenaId} courtId={courtId} />
      </Suspense>
    </RequireAuth>
  );
}
