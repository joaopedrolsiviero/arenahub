'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMyAdminArenas } from '@/hooks/use-api';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

function ArenaPicker() {
  const router = useRouter();
  const { data: arenas, isPending, isError } = useMyAdminArenas();

  // Um único administrador de arena vai direto para o dashboard — não faz
  // sentido escolher entre 1 opção (item 42: responder em poucos segundos).
  useEffect(() => {
    if (arenas && arenas.length === 1) {
      router.replace(`/dashboard/${arenas[0]!.id}`);
    }
  }, [arenas, router]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 sm:px-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Painel administrativo</h1>

      {isPending ? <LoadingState label="Carregando arenas…" /> : null}
      {isError ? <ErrorState message="Não foi possível carregar suas arenas." /> : null}
      {arenas && arenas.length === 0 ? (
        <EmptyState message="Você não administra nenhuma arena. Fale com quem cadastrou a sua arena para receber acesso." />
      ) : null}

      {arenas && arenas.length > 1 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {arenas.map((arena) => (
            <Link key={arena.id} href={`/dashboard/${arena.id}`} className="block">
              <Card className="transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle>{arena.name}</CardTitle>
                  <CardDescription>{arena.role === 'OWNER' ? 'Proprietário' : 'Administrador'}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{arena.timezone}</CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function DashboardEntryPage() {
  return (
    <RequireAuth>
      <ArenaPicker />
    </RequireAuth>
  );
}
