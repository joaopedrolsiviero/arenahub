'use client';

import { useDiscoverArenas } from '@/hooks/use-api';
import { ArenaCard } from '@/components/arena-card';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';

function ArenasList() {
  const { data: arenas, isPending, isError } = useDiscoverArenas();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Arenas</h1>

      {isPending ? <LoadingState label="Carregando arenas…" /> : null}
      {isError ? <ErrorState message="Não foi possível carregar as arenas." /> : null}
      {arenas && arenas.length === 0 ? (
        <EmptyState message="Nenhuma arena disponível no momento." />
      ) : null}

      {arenas && arenas.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {arenas.map((arena) => (
            <ArenaCard key={arena.id} arena={arena} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ArenasPage() {
  return (
    <RequireAuth>
      <ArenasList />
    </RequireAuth>
  );
}
