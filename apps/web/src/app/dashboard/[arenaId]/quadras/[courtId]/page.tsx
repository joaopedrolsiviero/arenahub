'use client';

import { Suspense, use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCourt, useUpdateCourt, useMyAdminArenas, useDashboard } from '@/hooks/use-api';
import { DashboardHeader } from '@/components/dashboard-header';
import { LoadingState, ErrorState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/lib/api';
import type { Court } from '@/lib/types';

// Só monta depois que `court` chega do servidor — estado local nasce do
// valor inicial diretamente (sem useEffect), e passa a viver independente
// dele: um refetch em segundo plano nunca apaga uma edição em andamento.
function CourtForm({ arenaId, court }: { arenaId: string; court: Court }) {
  const updateCourt = useUpdateCourt(arenaId);

  const [name, setName] = useState(court.name);
  const [description, setDescription] = useState(court.description ?? '');
  const [pricePerSlot, setPricePerSlot] = useState(court.pricePerSlot);
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(String(court.slotDurationMinutes));
  const [bufferMinutes, setBufferMinutes] = useState(String(court.bufferMinutes));
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await updateCourt.mutateAsync({
        courtId: court.id,
        dto: {
          name,
          description: description.trim().length > 0 ? description : undefined,
          pricePerSlot: Number(pricePerSlot),
          slotDurationMinutes: Number(slotDurationMinutes),
          bufferMinutes: Number(bufferMinutes),
        },
      });
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'Não foi possível salvar.');
    }
  }

  async function handleToggleActive() {
    setError(null);
    try {
      await updateCourt.mutateAsync({ courtId: court.id, dto: { isActive: !court.isActive } });
    } catch (submitError) {
      setError(
        submitError instanceof ApiError ? submitError.message : 'Não foi possível atualizar.',
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {court.name}
          {!court.isActive ? <Badge variant="destructive">Inativa</Badge> : null}
        </CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">Nome</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-description">Descrição</Label>
            <Input
              id="edit-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={1000}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-price">Preço (R$)</Label>
              <Input
                id="edit-price"
                type="number"
                min={0}
                step="0.01"
                value={pricePerSlot}
                onChange={(event) => setPricePerSlot(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-duration">Duração (min)</Label>
              <Input
                id="edit-duration"
                type="number"
                min={15}
                max={1440}
                value={slotDurationMinutes}
                onChange={(event) => setSlotDurationMinutes(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-buffer">Buffer (min)</Label>
              <Input
                id="edit-buffer"
                type="number"
                min={0}
                max={1440}
                value={bufferMinutes}
                onChange={(event) => setBufferMinutes(event.target.value)}
              />
            </div>
          </div>

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Erro</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={updateCourt.isPending}
            onClick={handleToggleActive}
          >
            {court.isActive ? 'Desativar quadra' : 'Ativar quadra'}
          </Button>
          <Button type="submit" disabled={updateCourt.isPending}>
            {updateCourt.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function CourtEditor({ arenaId, courtId }: { arenaId: string; courtId: string }) {
  const router = useRouter();
  const { data: adminArenas } = useMyAdminArenas();
  const { data: dashboard } = useDashboard(arenaId, undefined);
  const { data: court, isPending, isError } = useCourt(arenaId, courtId);

  return (
    <>
      <DashboardHeader
        arenaId={arenaId}
        arenaName={dashboard?.arena.name ?? '…'}
        adminArenas={adminArenas ?? []}
      />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
        <Button
          type="button"
          variant="ghost"
          className="w-fit"
          onClick={() => router.push(`/dashboard/${arenaId}/quadras`)}
        >
          ← Voltar para quadras
        </Button>

        {isPending ? <LoadingState label="Carregando quadra…" /> : null}
        {isError ? <ErrorState message="Quadra não encontrada." /> : null}

        {court ? <CourtForm arenaId={arenaId} court={court} /> : null}
      </div>
    </>
  );
}

export default function CourtEditPage({
  params,
}: {
  params: Promise<{ arenaId: string; courtId: string }>;
}) {
  const { arenaId, courtId } = use(params);
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState label="Carregando…" />}>
        <CourtEditor arenaId={arenaId} courtId={courtId} />
      </Suspense>
    </RequireAuth>
  );
}
