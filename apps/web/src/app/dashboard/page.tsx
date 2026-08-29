'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMyAdminArenas } from '@/hooks/use-api';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Painel administrativo</h1>
        {/* Sempre visível (não só no estado vazio) — item 21: um OWNER pode
            administrar mais de uma arena, então "criar arena" nunca é uma
            ação de uso único. */}
        <Link href="/dashboard/nova-arena" className="shrink-0">
          <Button type="button">Nova arena</Button>
        </Link>
      </div>

      {isPending ? <LoadingState label="Carregando arenas…" /> : null}
      {isError ? <ErrorState message="Não foi possível carregar suas arenas." /> : null}
      {arenas && arenas.length === 0 ? (
        <EmptyState
          message="Você ainda não administra nenhuma arena."
          action={
            <Link href="/dashboard/nova-arena">
              <Button type="button">Criar minha arena</Button>
            </Link>
          }
        />
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
