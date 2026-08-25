'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Show, SignIn, useUser } from '@clerk/nextjs';
import {
  CheckCircle2Icon,
  ClockIcon,
  MailWarningIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from 'lucide-react';
import { useAcceptInvitation, useInvitationByToken } from '@/hooks/use-api';
import { LoadingState } from '@/components/async-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/lib/api';
import { formatDateInZone } from '@/lib/format';

const ROLE_LABEL: Record<string, string> = { OWNER: 'Proprietário', ADMIN: 'Administrador' };

// Estado terminal (item 64-66 do prompt) — convite existe mas não pode ser
// aceito por um motivo já definitivo (revogado/expirado/já usado). Nunca
// oferece um botão de aceitar — a mensagem já explica o porquê.
function TerminalState({
  icon: Icon,
  title,
  message,
}: {
  icon: typeof ClockIcon;
  title: string;
  message: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <Icon className="size-10 text-muted-foreground" />
        <p className="font-heading text-lg font-bold">{title}</p>
        <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

export function InviteCard({ token }: { token: string }) {
  const { data: invitation, isPending, isError } = useInvitationByToken(token);
  const { isSignedIn, user } = useUser();
  const acceptInvitation = useAcceptInvitation();
  const router = useRouter();
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  if (isPending) {
    return <LoadingState label="Carregando convite…" />;
  }

  if (isError || !invitation) {
    return (
      <TerminalState
        icon={XCircleIcon}
        title="Convite indisponível"
        message="Convite inválido ou indisponível. Verifique o link ou peça um novo convite."
      />
    );
  }

  if (invitation.status === 'REVOKED') {
    return (
      <TerminalState
        icon={XCircleIcon}
        title="Convite revogado"
        message="Este convite foi revogado."
      />
    );
  }

  if (invitation.status === 'EXPIRED') {
    return (
      <TerminalState
        icon={ClockIcon}
        title="Convite expirado"
        message="Este convite expirou. Peça ao proprietário da arena para enviar um novo convite."
      />
    );
  }

  if (invitation.status === 'ACCEPTED' || accepted) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2Icon className="size-10 text-brand" />
          <p className="font-heading text-lg font-bold">
            {accepted ? 'Convite aceito!' : 'Este convite já foi utilizado.'}
          </p>
          {accepted ? (
            <Button type="button" onClick={() => router.push(`/dashboard/${invitation.arenaId}`)}>
              Ir para o painel
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  // Só uma checagem de UX (item 63) — quem decide de verdade é o backend,
  // via e-mail já sincronizado do Clerk (item 26-27), nunca este valor do
  // cliente.
  const signedInEmail = user?.primaryEmailAddress?.emailAddress?.trim().toLowerCase();
  const emailMismatch = isSignedIn && signedInEmail && signedInEmail !== invitation.email;

  async function handleAccept() {
    setAcceptError(null);
    try {
      await acceptInvitation.mutateAsync(token);
      setAccepted(true);
    } catch (error) {
      setAcceptError(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível aceitar o convite. Tente novamente.',
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Convite para {invitation.arenaName}</CardTitle>
        <CardDescription>
          Você foi convidado para administrar esta arena no ArenaHub.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 rounded-lg bg-muted p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">E-mail convidado</span>
            <span className="font-medium">{invitation.email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Papel</span>
            <Badge variant="outline">
              <ShieldCheckIcon data-icon="inline-start" />
              {ROLE_LABEL[invitation.role] ?? invitation.role}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Expira em</span>
            <span className="tabular font-medium">
              {formatDateInZone(invitation.expiresAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}
            </span>
          </div>
        </div>

        <Show when="signed-out">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Entre ou crie sua conta para aceitar este convite.
            </p>
            <SignIn forceRedirectUrl={`/convites/${token}`} fallbackRedirectUrl={`/convites/${token}`} />
          </div>
        </Show>

        <Show when="signed-in">
          {emailMismatch ? (
            <Alert>
              <MailWarningIcon />
              <AlertTitle>Convite enviado para outro endereço</AlertTitle>
              <AlertDescription>
                Este convite foi enviado para {invitation.email}, mas você está conectado como{' '}
                {signedInEmail}. Entre com a conta certa para aceitar.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {acceptError ? (
                <Alert variant="destructive" role="alert">
                  <TriangleAlertIcon />
                  <AlertTitle>Não foi possível aceitar</AlertTitle>
                  <AlertDescription>{acceptError}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                type="button"
                className="w-full"
                disabled={acceptInvitation.isPending}
                onClick={handleAccept}
              >
                {acceptInvitation.isPending ? 'Aceitando…' : 'Aceitar convite'}
              </Button>
            </>
          )}
        </Show>
      </CardContent>
    </Card>
  );
}

export default function InvitationAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center gap-4 px-4 py-8">
      <div className="text-center">
        <span className="font-heading text-lg font-bold tracking-tight">ArenaHub</span>
      </div>
      <InviteCard token={token} />
    </div>
  );
}
