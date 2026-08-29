'use client';

import { use } from 'react';
import { useDiscoverArena } from '@/hooks/use-api';
import { CourtCard } from '@/components/court-card';
import { SiteHeader } from '@/components/site-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';

const SPORT_LABEL: Record<string, string> = {
  BEACH_VOLLEYBALL: 'Vôlei de praia',
};

export function ArenaDetail({ arenaId }: { arenaId: string }) {
  const { data: arena, isPending, isError, error } = useDiscoverArena(arenaId);
  const notFound = error instanceof ApiError && error.status === 404;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      {isPending ? <LoadingState label="Carregando arena…" /> : null}
      {isError ? (
        <ErrorState
          message={
            notFound
              ? 'Esta arena não existe ou não está mais disponível.'
              : 'Não foi possível carregar esta arena. Tente novamente.'
          }
        />
      ) : null}

      {arena ? (
        <>
          <div className="flex flex-col gap-3">
            <h1 className="font-heading text-2xl font-bold tracking-tight">{arena.name}</h1>
            {arena.description ? (
              <p className="max-w-lg text-sm text-muted-foreground">{arena.description}</p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {[...new Set(arena.courts.map((court) => court.sport))].map((sport) => (
                <Badge key={sport} variant="outline">
                  {SPORT_LABEL[sport] ?? sport}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <p className="text-sm font-semibold">Quadras</p>
            {!arena.isReady ? (
              // Fase 28, item 16 — nunca uma jornada quebrada (quadra sem
              // preço, ou sem nenhum horário de funcionamento, levando a uma
              // disponibilidade sempre vazia sem explicação): um sinal claro
              // de que a arena ainda está em configuração, distinto de
              // "nenhuma quadra cadastrada" ou de um erro.
              <EmptyState message="Esta arena ainda está sendo configurada pelo proprietário. Volte em breve." />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {arena.courts.map((court) => (
                  <CourtCard key={court.id} arenaId={arena.id} court={court} />
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

// Fase 29 — sem RequireAuth: um visitante sem conta precisa conseguir ver a
// arena antes de autenticar (login só é exigido pra criar a Booking).
export default function ArenaDetailPage({
  params,
}: {
  params: Promise<{ arenaId: string }>;
}) {
  const { arenaId } = use(params);
  return (
    <>
      <SiteHeader />
      <ArenaDetail arenaId={arenaId} />
    </>
  );
}
