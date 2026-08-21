'use client';

import { Suspense, use, useMemo, useState } from 'react';
import { useArena, useUpdateArena, useMyAdminArenas, useDashboard } from '@/hooks/use-api';
import { DashboardHeader } from '@/components/dashboard-header';
import { LoadingState, ErrorState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/lib/api';
import type { AdminArena } from '@/lib/types';

// IANA nativo do runtime — nunca um catálogo próprio de timezones (item 34
// da Fase 7), mesma fonte de verdade que o backend usa para validar
// (Intl.supportedValuesOf('timeZone')).
function useTimezoneOptions(): string[] {
  return useMemo(() => Intl.supportedValuesOf('timeZone'), []);
}

// Só monta depois que `arena` chega do servidor — estado local nasce do
// valor inicial diretamente (sem useEffect).
function ArenaForm({ arenaId, arena }: { arenaId: string; arena: AdminArena }) {
  const updateArena = useUpdateArena(arenaId);
  const timezones = useTimezoneOptions();

  const [name, setName] = useState(arena.name);
  const [description, setDescription] = useState(arena.description ?? '');
  const [phone, setPhone] = useState(arena.phone ?? '');
  const [email, setEmail] = useState(arena.email ?? '');
  const [timezone, setTimezone] = useState(arena.timezone);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSavedMessage(false);
    try {
      await updateArena.mutateAsync({
        name,
        description: description.trim().length > 0 ? description : undefined,
        phone: phone.trim().length > 0 ? phone : undefined,
        email: email.trim().length > 0 ? email : undefined,
        timezone,
      });
      setSavedMessage(true);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'Não foi possível salvar.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informações básicas</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="arena-name">Nome</Label>
            <Input
              id="arena-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="arena-description">Descrição</Label>
            <Input
              id="arena-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={1000}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="arena-phone">Telefone</Label>
              <Input
                id="arena-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={30}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="arena-email">E-mail</Label>
              <Input
                id="arena-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={160}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="arena-timezone">Timezone</Label>
            <select
              id="arena-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Alterar o timezone nunca modifica reservas já existentes — só passa a valer para a
              disponibilidade futura.
            </p>
          </div>

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Erro</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {savedMessage ? (
            <Alert role="status">
              <AlertTitle>Configurações salvas</AlertTitle>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button type="submit" disabled={updateArena.isPending}>
            {updateArena.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function ArenaSettings({ arenaId }: { arenaId: string }) {
  const { data: adminArenas } = useMyAdminArenas();
  const { data: dashboard } = useDashboard(arenaId, undefined);
  const { data: arena, isPending, isError } = useArena(arenaId);

  return (
    <>
      <DashboardHeader
        arenaId={arenaId}
        arenaName={dashboard?.arena.name ?? arena?.name ?? '…'}
        adminArenas={adminArenas ?? []}
      />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
        <h2 className="text-lg font-semibold">Configurações da arena</h2>

        {isPending ? <LoadingState label="Carregando…" /> : null}
        {isError ? <ErrorState message="Não foi possível carregar os dados da arena." /> : null}

        {arena ? <ArenaForm arenaId={arenaId} arena={arena} /> : null}
      </div>
    </>
  );
}

export default function ArenaSettingsPage({ params }: { params: Promise<{ arenaId: string }> }) {
  const { arenaId } = use(params);
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState label="Carregando…" />}>
        <ArenaSettings arenaId={arenaId} />
      </Suspense>
    </RequireAuth>
  );
}
