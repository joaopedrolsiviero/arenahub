'use client';

import { Suspense, use, useState } from 'react';
import { useArena, useUpdateArena, useMyAdminArenas, useDashboard } from '@/hooks/use-api';
import { useTimezoneOptions } from '@/hooks/use-timezone-options';
import { DashboardHeader } from '@/components/dashboard-header';
import { LoadingState, ErrorState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/lib/api';
import type { AdminArena } from '@/lib/types';

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
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState(
    arena.whatsappPhoneNumberId ?? '',
  );
  const [paymentMode, setPaymentMode] = useState(arena.paymentMode);
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
        whatsappPhoneNumberId:
          whatsappPhoneNumberId.trim().length > 0 ? whatsappPhoneNumberId.trim() : undefined,
        paymentMode,
      });
      setSavedMessage(true);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'Não foi possível salvar.');
    }
  }

  // Agrupado por assunto (item 24) — mas continua sendo UM único submit
  // para o mesmo PATCH de arena, sem inventar múltiplos endpoints.
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Identidade</CardTitle>
        </CardHeader>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contato</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timezone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <select
            id="arena-timezone"
            aria-label="Timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="h-8 w-fit rounded-lg border border-input bg-transparent px-2.5 text-sm"
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pagamento</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <select
            id="arena-payment-mode"
            aria-label="Como o cliente paga"
            value={paymentMode}
            onChange={(event) => setPaymentMode(event.target.value as typeof paymentMode)}
            className="h-8 w-fit rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="ONLINE">Online (Mercado Pago)</option>
            <option value="IN_PERSON">Presencial</option>
          </select>
          <p className="text-xs text-muted-foreground">
            &quot;Online&quot; leva o cliente ao pagamento pelo Mercado Pago ao confirmar a
            reserva, igual hoje. &quot;Presencial&quot; só confirma a reserva — o pagamento é
            combinado direto com o cliente, sem nenhum PIX ou cobrança gerada pelo ArenaHub.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <Label htmlFor="arena-whatsapp">ID do número (Meta Cloud API)</Label>
          <Input
            id="arena-whatsapp"
            value={whatsappPhoneNumberId}
            onChange={(event) => setWhatsappPhoneNumberId(event.target.value)}
            placeholder="Ex: 109876543210123"
            inputMode="numeric"
          />
          <p className="text-xs text-muted-foreground">
            O &quot;phone_number_id&quot; do seu número de WhatsApp Business, disponível no painel
            da Meta for Developers — nunca o número de telefone em si. Deixe em branco se esta
            arena ainda não atende clientes pelo WhatsApp.
          </p>
        </CardContent>
      </Card>

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

      <div className="flex justify-end">
        <Button type="submit" disabled={updateArena.isPending}>
          {updateArena.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}

export function ArenaSettings({ arenaId }: { arenaId: string }) {
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
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-6 sm:px-6">
        <h2 className="font-heading text-xl font-bold tracking-tight">Configurações da arena</h2>

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
