'use client';

import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useArenaCustomers, useDashboard, useMyAdminArenas } from '@/hooks/use-api';
import { DashboardHeader } from '@/components/dashboard-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { formatCurrencyBRL, formatDateInZone } from '@/lib/format';

const PAGE_SIZE = 20;
// Pequeno atraso antes de disparar a busca no backend — evita uma
// requisição por tecla digitada, sem precisar de uma lib de debounce nova.
const SEARCH_DEBOUNCE_MS = 300;

export function CustomersList({ arenaId }: { arenaId: string }) {
  const { data: adminArenas } = useMyAdminArenas();
  const { data: dashboard } = useDashboard(arenaId, undefined);
  const timezone = dashboard?.arena.timezone ?? 'UTC';

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const { data, isPending, isError } = useArenaCustomers(arenaId, {
    search: search || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <DashboardHeader
        arenaId={arenaId}
        arenaName={dashboard?.arena.name ?? '…'}
        adminArenas={adminArenas ?? []}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div>
          <h2 className="font-heading text-xl font-bold tracking-tight">Clientes</h2>
          <p className="text-sm text-muted-foreground">
            Pessoas com pelo menos uma reserva nesta arena — resumo, receita e histórico.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customer-search">Buscar cliente</Label>
          <Input
            id="customer-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Nome ou e-mail…"
            className="max-w-sm"
          />
        </div>

        {isPending ? <LoadingState label="Carregando clientes…" /> : null}
        {isError ? <ErrorState message="Não foi possível carregar os clientes." /> : null}

        {data && data.items.length === 0 && !search ? (
          <EmptyState message="Ainda não há clientes nesta arena." />
        ) : null}
        {data && data.items.length === 0 && search ? (
          <EmptyState message="Nenhum cliente encontrado." />
        ) : null}

        {data && data.items.length > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.items.map((customer) => (
                <Link
                  key={customer.userId}
                  href={`/dashboard/${arenaId}/clientes/${customer.userId}`}
                  className="block"
                >
                  <Card className="transition-shadow hover:shadow-md">
                    <CardHeader>
                      <CardTitle>{customer.name ?? customer.email}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {customer.totalBookings}{' '}
                          {customer.totalBookings === 1 ? 'reserva' : 'reservas'}
                        </span>
                        <span className="tabular text-sm font-bold">
                          {formatCurrencyBRL(customer.totalRevenue)}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Última reserva: {formatDateInZone(customer.lastBookingAt, timezone)}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            {totalPages > 1 ? (
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground">
                  Página {page} de {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Próxima
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

export default function ClientesPage({ params }: { params: Promise<{ arenaId: string }> }) {
  const { arenaId } = use(params);
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState label="Carregando…" />}>
        <CustomersList arenaId={arenaId} />
      </Suspense>
    </RequireAuth>
  );
}
