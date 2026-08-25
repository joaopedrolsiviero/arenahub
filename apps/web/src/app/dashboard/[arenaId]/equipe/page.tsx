'use client';

import { Suspense, use, useState } from 'react';
import {
  ArrowRightLeftIcon,
  CheckCircle2Icon,
  ClockIcon,
  CrownIcon,
  MailPlusIcon,
  ShieldIcon,
  TriangleAlertIcon,
  UserPlusIcon,
  XCircleIcon,
} from 'lucide-react';
import {
  useAddMember,
  useArenaInvitations,
  useArenaMembers,
  useCreateInvitation,
  useDashboard,
  useMyAdminArenas,
  useRemoveMember,
  useResendInvitation,
  useRevokeInvitation,
  useTransferOwnership,
} from '@/hooks/use-api';
import { DashboardHeader } from '@/components/dashboard-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ApiError } from '@/lib/api';
import { formatDateInZone } from '@/lib/format';
import type { ArenaMember, Invitation, InvitationStatus } from '@/lib/types';

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function MemberAvatar({ member }: { member: ArenaMember }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-foreground"
    >
      {initials(member.user.name, member.user.email)}
    </span>
  );
}

// Adicionar administrador (item 27 da Fase 10) — usuário precisa já ter
// conta no ArenaHub, entra na equipe imediatamente. Continua existindo ao
// lado do convite por e-mail da Fase 11 (abaixo): não foi removida, são
// dois fluxos complementares — "sei que a pessoa já usa o ArenaHub" vs.
// "quero convidar alguém que talvez ainda não tenha conta".
function AddMemberDialog({ arenaId }: { arenaId: string }) {
  const addMember = useAddMember(arenaId);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await addMember.mutateAsync(email.trim());
      setEmail('');
      setOpen(false);
    } catch (submitError) {
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : 'Não foi possível adicionar esse administrador.',
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        <UserPlusIcon />
        Adicionar direto
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Adicionar administrador existente</DialogTitle>
            <DialogDescription>
              A pessoa precisa já ter uma conta no ArenaHub. Ela ganha acesso imediato ao painel
              desta arena como ADMIN.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-email">E-mail</Label>
            <Input
              id="member-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="pessoa@exemplo.com"
            />
          </div>

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Não foi possível adicionar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={addMember.isPending || email.trim().length === 0}>
              {addMember.isPending ? 'Adicionando…' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveMemberButton({ arenaId, member }: { arenaId: string; member: ArenaMember }) {
  const removeMember = useRemoveMember(arenaId);
  const [error, setError] = useState<string | null>(null);
  const label = member.user.name ?? member.user.email;

  async function handleConfirm() {
    setError(null);
    try {
      await removeMember.mutateAsync(member.userId);
    } catch (submitError) {
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : 'Não foi possível remover esse administrador.',
      );
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button type="button" variant="outline" size="sm" disabled={removeMember.isPending} />}
      >
        Remover
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover {label} da equipe?</AlertDialogTitle>
          <AlertDialogDescription>
            {label} ({member.user.email}) perde acesso ao painel administrativo desta arena.
            {error ? <span className="mt-2 block text-destructive">{error}</span> : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Remover membro</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Transferência de ownership (item 47-48/96) — operação crítica, nunca um
// botão "Salvar" genérico. Destinatário só pode ser um ADMIN JÁ existente
// desta arena (item 45-46) — o próprio <select> só lista quem já está na
// equipe, então nunca é possível submeter um alvo inválido pela UI (o
// backend continua validando de qualquer forma, item 34).
function TransferOwnershipDialog({ arenaId, admins }: { arenaId: string; admins: ArenaMember[] }) {
  const transferOwnership = useTransferOwnership(arenaId);
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selected = admins.find((admin) => admin.userId === selectedUserId);

  async function handleTransfer() {
    setError(null);
    try {
      await transferOwnership.mutateAsync(selectedUserId);
      setOpen(false);
      setSelectedUserId('');
    } catch (submitError) {
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : 'Não foi possível transferir a propriedade.',
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setSelectedUserId('');
        }
      }}
    >
      <DialogTrigger
        render={<Button type="button" variant="outline" disabled={admins.length === 0} />}
      >
        <ArrowRightLeftIcon />
        Transferir propriedade
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transferir propriedade da arena</DialogTitle>
          <DialogDescription>
            Você está transferindo a propriedade desta arena. Depois da transferência, você
            continua com acesso, mas como administrador — não mais como proprietário.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-owner">Novo proprietário</Label>
          <select
            id="new-owner"
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="">Selecione um administrador</option>
            {admins.map((admin) => (
              <option key={admin.userId} value={admin.userId}>
                {admin.user.name ?? admin.user.email}
              </option>
            ))}
          </select>
        </div>

        {selected ? (
          <div className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-sm">
            <p>
              <span className="text-muted-foreground">Atual proprietário:</span> Você
            </p>
            <p>
              <span className="text-muted-foreground">Novo proprietário:</span>{' '}
              {selected.user.name ?? selected.user.email}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Seu papel depois da transferência: Administrador.
            </p>
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Não foi possível transferir</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="destructive"
            disabled={!selectedUserId || transferOwnership.isPending}
            onClick={handleTransfer}
          >
            {transferOwnership.isPending ? 'Transferindo…' : 'Transferir propriedade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembersTab({ arenaId, isOwner }: { arenaId: string; isOwner: boolean }) {
  const { data: members, isPending, isError } = useArenaMembers(arenaId);
  const owner = members?.find((member) => member.role === 'OWNER');
  const admins = members?.filter((member) => member.role === 'ADMIN') ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isOwner ? <TransferOwnershipDialog arenaId={arenaId} admins={admins} /> : null}
        {isOwner ? <AddMemberDialog arenaId={arenaId} /> : null}
      </div>

      {isPending ? <LoadingState label="Carregando equipe…" /> : null}
      {isError ? <ErrorState message="Não foi possível carregar a equipe." /> : null}

      {owner ? (
        <Card className="border-2 border-brand/25">
          <CardContent className="flex items-center gap-3">
            <MemberAvatar member={owner} />
            <div className="flex-1">
              <p className="font-heading text-sm font-semibold">
                {owner.user.name ?? owner.user.email}
              </p>
              <p className="text-xs text-muted-foreground">{owner.user.email}</p>
            </div>
            <Badge variant="brand">
              <CrownIcon data-icon="inline-start" />
              Proprietário
            </Badge>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <p className="text-sm font-semibold">Administradores</p>
        {members && admins.length === 0 ? (
          <EmptyState message="Nenhum administrador além do proprietário ainda." />
        ) : null}
        {admins.map((member) => (
          <Card key={member.id}>
            <CardContent className="flex items-center gap-3">
              <MemberAvatar member={member} />
              <div className="flex-1">
                <p className="font-heading text-sm font-semibold">
                  {member.user.name ?? member.user.email}
                </p>
                <p className="text-xs text-muted-foreground">{member.user.email}</p>
              </div>
              <Badge variant="outline">
                <ShieldIcon data-icon="inline-start" />
                Admin
              </Badge>
              {isOwner ? <RemoveMemberButton arenaId={arenaId} member={member} /> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

const INVITATION_STATUS_CONFIG: Record<
  InvitationStatus,
  { label: string; variant: 'outline' | 'brand' | 'destructive' | 'warning'; icon: typeof ClockIcon }
> = {
  PENDING: { label: 'Pendente', variant: 'outline', icon: ClockIcon },
  ACCEPTED: { label: 'Aceito', variant: 'brand', icon: CheckCircle2Icon },
  REVOKED: { label: 'Revogado', variant: 'destructive', icon: XCircleIcon },
  EXPIRED: { label: 'Expirado', variant: 'warning', icon: TriangleAlertIcon },
};

function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
  const { label, variant, icon: Icon } = INVITATION_STATUS_CONFIG[status];
  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" />
      {label}
    </Badge>
  );
}

// Convite por e-mail (item 19-21 da Fase 11) — a pessoa não precisa ter
// conta ainda (diferente do "Adicionar direto" acima).
function InviteDialog({ arenaId }: { arenaId: string }) {
  const createInvitation = useCreateInvitation(arenaId);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createInvitation.mutateAsync(email.trim());
      setEmail('');
      setOpen(false);
    } catch (submitError) {
      setError(
        submitError instanceof ApiError ? submitError.message : 'Não foi possível criar o convite.',
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger render={<Button type="button" />}>
        <MailPlusIcon />
        Convidar administrador
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Convidar administrador</DialogTitle>
            <DialogDescription>
              A pessoa recebe um convite por e-mail para entrar como ADMIN — mesmo que ainda não
              tenha conta no ArenaHub.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">E-mail</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="pessoa@exemplo.com"
            />
          </div>

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Não foi possível convidar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={createInvitation.isPending || email.trim().length === 0}>
              {createInvitation.isPending ? 'Enviando…' : 'Enviar convite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InvitationCard({
  arenaId,
  invitation,
  timezone,
}: {
  arenaId: string;
  invitation: Invitation;
  timezone: string;
}) {
  const revokeInvitation = useRevokeInvitation(arenaId);
  const resendInvitation = useResendInvitation(arenaId);
  const [error, setError] = useState<string | null>(null);

  const canRevoke = invitation.status === 'PENDING' || invitation.status === 'EXPIRED';
  const canResend = invitation.status === 'PENDING' || invitation.status === 'EXPIRED';

  async function handleRevoke() {
    setError(null);
    try {
      await revokeInvitation.mutateAsync(invitation.id);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'Não foi possível revogar.');
    }
  }

  async function handleResend() {
    setError(null);
    try {
      await resendInvitation.mutateAsync(invitation.id);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'Não foi possível reenviar.');
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <p className="font-heading text-sm font-semibold">{invitation.email}</p>
            <p className="text-xs text-muted-foreground">
              Convidado em {formatDateInZone(invitation.createdAt, timezone)} · expira em{' '}
              {formatDateInZone(invitation.expiresAt, timezone)}
            </p>
          </div>
          <InvitationStatusBadge status={invitation.status} />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {canRevoke || canResend ? (
          <div className="flex justify-end gap-2">
            {canResend ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resendInvitation.isPending}
                onClick={handleResend}
              >
                {resendInvitation.isPending ? 'Reenviando…' : 'Reenviar'}
              </Button>
            ) : null}
            {canRevoke ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={revokeInvitation.isPending}
                onClick={handleRevoke}
              >
                {revokeInvitation.isPending ? 'Revogando…' : 'Revogar'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InvitationsTab({ arenaId, timezone }: { arenaId: string; timezone: string }) {
  const { data: invitations, isPending, isError } = useArenaInvitations(arenaId);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <InviteDialog arenaId={arenaId} />
      </div>

      {isPending ? <LoadingState label="Carregando convites…" /> : null}
      {isError ? <ErrorState message="Não foi possível carregar os convites." /> : null}
      {invitations && invitations.length === 0 ? (
        <EmptyState message="Não há convites pendentes." />
      ) : null}

      <div className="flex flex-col gap-2.5">
        {invitations?.map((invitation) => (
          <InvitationCard
            key={invitation.id}
            arenaId={arenaId}
            invitation={invitation}
            timezone={timezone}
          />
        ))}
      </div>
    </div>
  );
}

export function TeamManagement({ arenaId }: { arenaId: string }) {
  const { data: adminArenas } = useMyAdminArenas();
  const { data: dashboard } = useDashboard(arenaId, undefined);

  // Só o OWNER gerencia convites/transferência/remoção (item 7/26 do prompt
  // da Fase 10, mantido na Fase 11) — o backend segue sendo a autoridade
  // final independentemente do que a UI mostra (item 34).
  const isOwner = adminArenas?.find((arena) => arena.id === arenaId)?.role === 'OWNER';

  return (
    <>
      <DashboardHeader
        arenaId={arenaId}
        arenaName={dashboard?.arena.name ?? '…'}
        adminArenas={adminArenas ?? []}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div>
          <h2 className="font-heading text-xl font-bold tracking-tight">Equipe</h2>
          <p className="text-sm text-muted-foreground">
            Quem administra esta arena e pode acessar o painel.
          </p>
        </div>

        {isOwner ? (
          <Tabs defaultValue="membros">
            <TabsList>
              <TabsTrigger value="membros">Membros</TabsTrigger>
              <TabsTrigger value="convites">Convites</TabsTrigger>
            </TabsList>
            <TabsContent value="membros">
              <MembersTab arenaId={arenaId} isOwner={isOwner} />
            </TabsContent>
            <TabsContent value="convites">
              <InvitationsTab arenaId={arenaId} timezone={dashboard?.arena.timezone ?? 'UTC'} />
            </TabsContent>
          </Tabs>
        ) : (
          // ADMIN só vê a lista de membros — sem abas de convite, sem ações
          // de gerenciamento (item 59).
          <MembersTab arenaId={arenaId} isOwner={false} />
        )}
      </div>
    </>
  );
}

export default function TeamPage({ params }: { params: Promise<{ arenaId: string }> }) {
  const { arenaId } = use(params);
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState label="Carregando…" />}>
        <TeamManagement arenaId={arenaId} />
      </Suspense>
    </RequireAuth>
  );
}
