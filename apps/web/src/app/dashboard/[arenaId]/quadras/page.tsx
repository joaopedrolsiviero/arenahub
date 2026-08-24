'use client';

import { Suspense, use, useState } from 'react';
import Link from 'next/link';
import { useCourts, useCreateCourt, useMyAdminArenas, useDashboard } from '@/hooks/use-api';
import { DashboardHeader } from '@/components/dashboard-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatCurrencyBRL } from '@/lib/format';
import { ApiError } from '@/lib/api';

function CreateCourtForm({ arenaId, onDone }: { arenaId: string; onDone: () => void }) {
  const createCourt = useCreateCourt(arenaId);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createCourt.mutateAsync({ name, sport: 'BEACH_VOLLEYBALL' });
      setName('');
      onDone();
    } catch (submitError) {
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : 'Não foi possível criar a quadra.',
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nova quadra</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="court-name">Nome</Label>
            <Input
              id="court-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              className="w-56"
            />
          </div>
          <Button type="submit" disabled={createCourt.isPending || name.trim().length === 0}>
            {createCourt.isPending ? 'Criando…' : 'Criar quadra'}
          </Button>
        </form>
        {error ? (
          <Alert variant="destructive" role="alert" className="mt-3">
            <AlertTitle>Erro</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CourtsList({ arenaId }: { arenaId: string }) {
  const { data: adminArenas } = useMyAdminArenas();
  const { data: dashboard } = useDashboard(arenaId, undefined);
  const { data: courts, isPending, isError } = useCourts(arenaId);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      <DashboardHeader
        arenaId={arenaId}
        arenaName={dashboard?.arena.name ?? '…'}
        adminArenas={adminArenas ?? []}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xl font-bold tracking-tight">Quadras</h2>
          <Button type="button" variant="outline" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Cancelar' : 'Nova quadra'}
          </Button>
        </div>

        {showCreate ? (
          <CreateCourtForm arenaId={arenaId} onDone={() => setShowCreate(false)} />
        ) : null}

        {isPending ? <LoadingState label="Carregando quadras…" /> : null}
        {isError ? <ErrorState message="Não foi possível carregar as quadras." /> : null}
        {courts && courts.length === 0 ? (
          <EmptyState message="Nenhuma quadra cadastrada ainda." />
        ) : null}

        {courts && courts.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {courts.map((court) => (
              <Link key={court.id} href={`/dashboard/${arenaId}/quadras/${court.id}`} className="block">
                <Card className="transition-shadow hover:shadow-md">
                  <CardHeader>
                    <CardTitle>{court.name}</CardTitle>
                    <CardAction>
                      {!court.isActive ? <Badge variant="destructive">Inativa</Badge> : null}
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between">
                    <span className="tabular text-sm font-bold">
                      {formatCurrencyBRL(court.pricePerSlot)} / horário
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {court.slotDurationMinutes} min
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

export default function QuadrasPage({ params }: { params: Promise<{ arenaId: string }> }) {
  const { arenaId } = use(params);
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState label="Carregando…" />}>
        <CourtsList arenaId={arenaId} />
      </Suspense>
    </RequireAuth>
  );
}
