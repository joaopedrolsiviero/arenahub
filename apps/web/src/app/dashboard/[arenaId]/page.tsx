'use client';

import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useArena, useDashboard, useMyAdminArenas } from '@/hooks/use-api';
import { DashboardHeader } from '@/components/dashboard-header';
import { DashboardDateNav } from '@/components/dashboard-date-nav';
import { DashboardSummaryCards } from '@/components/dashboard-summary';
import { UpcomingBookings } from '@/components/upcoming-bookings';
import { BookingTimelineCard } from '@/components/booking-timeline';
import { ArenaSetupChecklist } from '@/components/arena-setup-checklist';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { RequireAuth } from '@/components/require-auth';
import { ApiError } from '@/lib/api';
import { formatTimeInZone } from '@/lib/format';
import type { DashboardBookingItem } from '@/lib/types';

export function DashboardOverview({ arenaId }: { arenaId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get('date') ?? undefined;

  const { data: adminArenas } = useMyAdminArenas();
  const { data: dashboard, isPending, isError, error } = useDashboard(arenaId, dateParam);
  const { data: arena } = useArena(arenaId);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  // Sem ?date na URL: o backend já resolveu "hoje no timezone da arena"
  // (item 14 da Fase 7) — só refletimos essa escolha na URL depois,
  // nunca tentamos adivinhar o timezone no cliente antes de sabê-lo
  // (item 65: bookmark/refresh precisam da data explícita na URL).
  useEffect(() => {
    if (dashboard && !dateParam) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('date', dashboard.date);
      router.replace(`?${params.toString()}`);
    }
  }, [dashboard, dateParam, router, searchParams]);

  function handleDateChange(newDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('date', newDate);
    router.replace(`?${params.toString()}`);
  }

  if (isPending) {
    return <LoadingState label="Carregando dashboard…" />;
  }

  if (isError) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <div className="mx-auto w-full max-w-2xl p-6">
          <ErrorState message="Você não tem permissão para administrar esta arena." />
        </div>
      );
    }
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="mx-auto w-full max-w-2xl p-6">
          <ErrorState message="Arena não encontrada." />
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <ErrorState message="Não foi possível carregar o dashboard." />
      </div>
    );
  }

  const isClosedToday = dashboard.operatingHours.length === 0;

  function handleBookingCancelled(booking: DashboardBookingItem) {
    const who = booking.user?.name ?? booking.user?.email ?? 'cliente';
    const wasPaid = booking.paymentStatus === 'PAID' || booking.paymentStatus === 'REFUNDING';
    setCancelNotice(
      `${booking.courtName} às ${formatTimeInZone(booking.startsAt, dashboard!.arena.timezone)} (${who}) foi cancelada e o horário foi liberado.` +
        (wasPaid ? ' O reembolso foi solicitado — acompanhe o status do pagamento.' : ''),
    );
  }

  return (
    <>
      <DashboardHeader
        arenaId={arenaId}
        arenaName={dashboard.arena.name}
        adminArenas={adminArenas ?? []}
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
        {/* Fase 31 — único item do menu do dashboard sem h2 próprio
            (Quadras/Horários/Equipe/Configurações já têm o deles); sem isso
            a navegação por cabeçalhos de leitor de tela pulava direto do h1
            da arena pro conteúdo, sem nenhum marco pra esta página. */}
        <h2 className="sr-only">Dashboard</h2>
        {/* Sinal de onboarding mais importante da tela (item 13/14) — vem
            antes de qualquer outra coisa, inclusive do nav de data. */}
        {arena?.setupStatus ? (
          <ArenaSetupChecklist arenaId={arenaId} setupStatus={arena.setupStatus} />
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <DashboardDateNav
            date={dashboard.date}
            timezone={dashboard.arena.timezone}
            onChange={handleDateChange}
          />
        </div>

        {isClosedToday ? (
          <Alert>
            <AlertTitle>Arena fechada</AlertTitle>
            <AlertDescription>
              Não há horário de funcionamento configurado para este dia.
            </AlertDescription>
          </Alert>
        ) : null}

        {cancelNotice ? (
          <Alert role="status" className="border-brand/30 bg-brand/8">
            <AlertTitle>Reserva cancelada</AlertTitle>
            <AlertDescription>{cancelNotice}</AlertDescription>
          </Alert>
        ) : null}

        <DashboardSummaryCards summary={dashboard.summary} />

        {/* Ocupação por quadra é a informação prioritária (item 20-21) — vem
            antes da lista de próximas reservas, que é só um recorte dela. */}
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">Ocupação por quadra</p>
          {dashboard.courts.length === 0 ? (
            <EmptyState
              message="Nenhuma quadra cadastrada ainda."
              action={
                <Link href={`/dashboard/${arenaId}/quadras`}>
                  <Button type="button">Adicionar primeira quadra</Button>
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {dashboard.courts.map((court) => (
                <BookingTimelineCard
                  key={court.id}
                  arenaId={arenaId}
                  court={court}
                  operatingHours={dashboard.operatingHours}
                  timezone={dashboard.arena.timezone}
                  onBookingCancelled={handleBookingCancelled}
                />
              ))}
            </div>
          )}
        </div>

        <UpcomingBookings
          arenaId={arenaId}
          bookings={dashboard.upcomingBookings}
          timezone={dashboard.arena.timezone}
          onBookingCancelled={handleBookingCancelled}
        />
      </div>
    </>
  );
}

export default function DashboardPage({ params }: { params: Promise<{ arenaId: string }> }) {
  const { arenaId } = use(params);
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState label="Carregando dashboard…" />}>
        <DashboardOverview arenaId={arenaId} />
      </Suspense>
    </RequireAuth>
  );
}
