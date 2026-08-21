'use client';

import { use } from 'react';
import { useDiscoverArena } from '@/hooks/use-api';
import { CourtCard } from '@/components/court-card';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';

function ArenaDetail({ arenaId }: { arenaId: string }) {
  const { data: arena, isPending, isError } = useDiscoverArena(arenaId);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      {isPending ? <LoadingState label="Carregando arena…" /> : null}
      {isError ? <ErrorState message="Não foi possível carregar esta arena." /> : null}

      {arena ? (
        <>
          <div>
            <h1 className="text-xl font-semibold">{arena.name}</h1>
            {arena.description ? (
              <p className="text-sm text-muted-foreground">{arena.description}</p>
            ) : null}
          </div>

          {arena.courts.length === 0 ? (
            <EmptyState message="Nenhuma quadra disponível nesta arena no momento." />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {arena.courts.map((court) => (
                <CourtCard key={court.id} arenaId={arena.id} court={court} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export default function ArenaDetailPage({
  params,
}: {
  params: Promise<{ arenaId: string }>;
}) {
  const { arenaId } = use(params);
  return (
    <RequireAuth>
      <ArenaDetail arenaId={arenaId} />
    </RequireAuth>
  );
}
