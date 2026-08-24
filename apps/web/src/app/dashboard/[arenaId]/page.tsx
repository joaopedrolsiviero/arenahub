'use client';

import { Suspense, use, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDashboard, useMyAdminArenas } from '@/hooks/use-api';
import { DashboardHeader } from '@/components/dashboard-header';
import { DashboardDateNav } from '@/components/dashboard-date-nav';
import { DashboardSummaryCards } from '@/components/dashboard-summary';
import { UpcomingBookings } from '@/components/upcoming-bookings';
import { BookingTimelineCard } from '@/components/booking-timeline';
import { LoadingState, ErrorState } from '@/components/async-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RequireAuth } from '@/components/require-auth';
import { ApiError } from '@/lib/api';

export function DashboardOverview({ arenaId }: { arenaId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get('date') ?? undefined;

  const { data: adminArenas } = useMyAdminArenas();
  const { data: dashboard, isPending, isError, error } = useDashboard(arenaId, dateParam);

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

  return (
    <>
      <DashboardHeader
        arenaId={arenaId}
        arenaName={dashboard.arena.name}
        adminArenas={adminArenas ?? []}
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
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

        <DashboardSummaryCards summary={dashboard.summary} />

        {/* Ocupação por quadra é a informação prioritária (item 20-21) — vem
            antes da lista de próximas reservas, que é só um recorte dela. */}
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">Ocupação por quadra</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {dashboard.courts.map((court) => (
              <BookingTimelineCard
                key={court.id}
                court={court}
                operatingHours={dashboard.operatingHours}
                timezone={dashboard.arena.timezone}
              />
            ))}
          </div>
        </div>

        <UpcomingBookings bookings={dashboard.upcomingBookings} timezone={dashboard.arena.timezone} />
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
