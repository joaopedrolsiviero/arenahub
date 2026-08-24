'use client';

import { useDiscoverArenas } from '@/hooks/use-api';
import { ArenaCard } from '@/components/arena-card';
import { SiteHeader } from '@/components/site-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';

function ArenasList() {
  const { data: arenas, isPending, isError } = useDiscoverArenas();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Encontre sua quadra</h1>
        <p className="text-sm text-muted-foreground">
          Arenas com horário disponível pra reservar agora.
        </p>
      </div>

      {isPending ? <LoadingState label="Carregando arenas…" /> : null}
      {isError ? <ErrorState message="Não foi possível carregar as arenas." /> : null}
      {arenas && arenas.length === 0 ? (
        <EmptyState message="Nenhuma arena disponível no momento. Volte em breve." />
      ) : null}

      {arenas && arenas.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      <SiteHeader />
      <ArenasList />
    </RequireAuth>
  );
}
