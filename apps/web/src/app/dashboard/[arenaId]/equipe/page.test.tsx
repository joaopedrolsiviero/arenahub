import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TeamManagement } from './page';
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
} from '../../../../hooks/use-api';
import { ApiError } from '../../../../lib/api';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/arena-1/equipe',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../../../hooks/use-api', () => ({
  useMyAdminArenas: jest.fn(),
  useDashboard: jest.fn(),
  useArenaMembers: jest.fn(),
  useAddMember: jest.fn(),
  useRemoveMember: jest.fn(),
  useTransferOwnership: jest.fn(),
  useArenaInvitations: jest.fn(),
  useCreateInvitation: jest.fn(),
  useRevokeInvitation: jest.fn(),
  useResendInvitation: jest.fn(),
}));

const mockedUseMyAdminArenas = useMyAdminArenas as jest.Mock;
const mockedUseDashboard = useDashboard as jest.Mock;
const mockedUseArenaMembers = useArenaMembers as jest.Mock;
const mockedUseAddMember = useAddMember as jest.Mock;
const mockedUseRemoveMember = useRemoveMember as jest.Mock;
const mockedUseTransferOwnership = useTransferOwnership as jest.Mock;
const mockedUseArenaInvitations = useArenaInvitations as jest.Mock;
const mockedUseCreateInvitation = useCreateInvitation as jest.Mock;
const mockedUseRevokeInvitation = useRevokeInvitation as jest.Mock;
const mockedUseResendInvitation = useResendInvitation as jest.Mock;

const OWNER_MEMBER = {
  id: 'm1',
  userId: 'owner-1',
  role: 'OWNER',
  createdAt: '2026-01-01T00:00:00.000Z',
  user: { id: 'owner-1', name: 'Dona da Arena', email: 'dona@example.com' },
};

const ADMIN_MEMBER = {
  id: 'm2',
  userId: 'admin-1',
  role: 'ADMIN',
  createdAt: '2026-01-02T00:00:00.000Z',
  user: { id: 'admin-1', name: 'Fulano Admin', email: 'fulano@example.com' },
};

const PENDING_INVITATION = {
  id: 'inv-1',
  email: 'convidado@example.com',
  role: 'ADMIN',
  status: 'PENDING',
  createdAt: '2026-01-03T00:00:00.000Z',
  expiresAt: '2026-01-10T00:00:00.000Z',
  acceptedAt: null,
  revokedAt: null,
  invitedBy: { id: 'owner-1', name: 'Dona da Arena', email: 'dona@example.com' },
};

function renderAsOwner() {
  mockedUseMyAdminArenas.mockReturnValue({ data: [{ id: 'arena-1', role: 'OWNER' }] });
  return render(<TeamManagement arenaId="arena-1" />);
}

function renderAsAdmin() {
  mockedUseMyAdminArenas.mockReturnValue({ data: [{ id: 'arena-1', role: 'ADMIN' }] });
  return render(<TeamManagement arenaId="arena-1" />);
}

describe('TeamPage (equipe)', () => {
  let addMutateAsync: jest.Mock;
  let removeMutateAsync: jest.Mock;
  let transferMutateAsync: jest.Mock;
  let createInvitationMutateAsync: jest.Mock;
  let revokeInvitationMutateAsync: jest.Mock;
  let resendInvitationMutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseDashboard.mockReturnValue({
      data: { arena: { name: 'Arena Central', timezone: 'America/Sao_Paulo' } },
    });
    addMutateAsync = jest.fn();
    removeMutateAsync = jest.fn();
    transferMutateAsync = jest.fn();
    createInvitationMutateAsync = jest.fn();
    revokeInvitationMutateAsync = jest.fn();
    resendInvitationMutateAsync = jest.fn();
    mockedUseAddMember.mockReturnValue({ mutateAsync: addMutateAsync, isPending: false });
    mockedUseRemoveMember.mockReturnValue({ mutateAsync: removeMutateAsync, isPending: false });
    mockedUseTransferOwnership.mockReturnValue({ mutateAsync: transferMutateAsync, isPending: false });
    mockedUseCreateInvitation.mockReturnValue({
      mutateAsync: createInvitationMutateAsync,
      isPending: false,
    });
    mockedUseRevokeInvitation.mockReturnValue({
      mutateAsync: revokeInvitationMutateAsync,
      isPending: false,
    });
    mockedUseResendInvitation.mockReturnValue({
      mutateAsync: resendInvitationMutateAsync,
      isPending: false,
    });
    mockedUseArenaInvitations.mockReturnValue({ data: [], isPending: false, isError: false });
  });

  it('mostra o estado de carregamento', () => {
    mockedUseArenaMembers.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderAsOwner();

    expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('mostra o proprietário com destaque e os administradores', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER, ADMIN_MEMBER],
      isPending: false,
      isError: false,
    });
    renderAsOwner();

    expect(await screen.findByText('Dona da Arena')).toBeInTheDocument();
    expect(screen.getByText('Proprietário')).toBeInTheDocument();
    expect(screen.getByText('Fulano Admin')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('mostra estado vazio quando só há o proprietário', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER],
      isPending: false,
      isError: false,
    });
    renderAsOwner();

    expect(await screen.findByText(/nenhum administrador/i)).toBeInTheDocument();
  });

  it('ADMIN não vê abas de convites nem ações de gerenciamento', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER, ADMIN_MEMBER],
      isPending: false,
      isError: false,
    });
    renderAsAdmin();

    await screen.findByText('Fulano Admin');
    expect(screen.queryByRole('tab', { name: 'Convites' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /adicionar direto/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transferir propriedade/i })).not.toBeInTheDocument();
  });

  it('OWNER vê as ações de gerenciamento na aba Membros', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER, ADMIN_MEMBER],
      isPending: false,
      isError: false,
    });
    renderAsOwner();

    expect(await screen.findByRole('button', { name: /adicionar direto/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /transferir propriedade/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Convites' })).toBeInTheDocument();
  });

  it('OWNER adiciona um administrador direto pelo e-mail', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER],
      isPending: false,
      isError: false,
    });
    addMutateAsync.mockResolvedValue(ADMIN_MEMBER);
    renderAsOwner();

    fireEvent.click(await screen.findByRole('button', { name: /adicionar direto/i }));
    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'novo@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(addMutateAsync).toHaveBeenCalledWith('novo@example.com'));
  });

  it('mostra erro amigável quando adicionar falha', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER],
      isPending: false,
      isError: false,
    });
    addMutateAsync.mockRejectedValue(new ApiError(404, 'Não foi possível encontrar esse usuário.'));
    renderAsOwner();

    fireEvent.click(await screen.findByRole('button', { name: /adicionar direto/i }));
    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'ninguem@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByText('Não foi possível encontrar esse usuário.')).toBeInTheDocument();
  });

  it('OWNER remove um administrador após confirmar no dialog', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER, ADMIN_MEMBER],
      isPending: false,
      isError: false,
    });
    removeMutateAsync.mockResolvedValue(undefined);
    renderAsOwner();

    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    expect(removeMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Remover membro' }));

    await waitFor(() => expect(removeMutateAsync).toHaveBeenCalledWith('admin-1'));
  });

  it('botão de transferir propriedade fica desabilitado sem nenhum ADMIN', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER],
      isPending: false,
      isError: false,
    });
    renderAsOwner();

    expect(await screen.findByRole('button', { name: /transferir propriedade/i })).toBeDisabled();
  });

  it('OWNER transfere a propriedade para um ADMIN selecionado', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER, ADMIN_MEMBER],
      isPending: false,
      isError: false,
    });
    transferMutateAsync.mockResolvedValue({
      arenaId: 'arena-1',
      previousOwnerUserId: 'owner-1',
      newOwnerUserId: 'admin-1',
      completedAt: '2026-01-05T00:00:00.000Z',
    });
    renderAsOwner();

    fireEvent.click(await screen.findByRole('button', { name: /transferir propriedade/i }));
    fireEvent.change(screen.getByLabelText('Novo proprietário'), {
      target: { value: 'admin-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Transferir propriedade' }));

    await waitFor(() => expect(transferMutateAsync).toHaveBeenCalledWith('admin-1'));
  });

  it('mostra a aba de Convites com a lista de convites pendentes', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER],
      isPending: false,
      isError: false,
    });
    mockedUseArenaInvitations.mockReturnValue({
      data: [PENDING_INVITATION],
      isPending: false,
      isError: false,
    });
    renderAsOwner();

    fireEvent.click(await screen.findByRole('tab', { name: 'Convites' }));

    expect(await screen.findByText('convidado@example.com')).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reenviar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revogar' })).toBeInTheDocument();
  });

  it('estado vazio de convites', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER],
      isPending: false,
      isError: false,
    });
    mockedUseArenaInvitations.mockReturnValue({ data: [], isPending: false, isError: false });
    renderAsOwner();

    fireEvent.click(await screen.findByRole('tab', { name: 'Convites' }));
    expect(await screen.findByText(/não há convites pendentes/i)).toBeInTheDocument();
  });

  it('OWNER cria um convite por e-mail', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER],
      isPending: false,
      isError: false,
    });
    createInvitationMutateAsync.mockResolvedValue(PENDING_INVITATION);
    renderAsOwner();

    fireEvent.click(await screen.findByRole('tab', { name: 'Convites' }));
    fireEvent.click(await screen.findByRole('button', { name: /convidar administrador/i }));
    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'convidado@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }));

    await waitFor(() =>
      expect(createInvitationMutateAsync).toHaveBeenCalledWith('convidado@example.com'),
    );
  });

  it('OWNER revoga um convite pendente', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER],
      isPending: false,
      isError: false,
    });
    mockedUseArenaInvitations.mockReturnValue({
      data: [PENDING_INVITATION],
      isPending: false,
      isError: false,
    });
    revokeInvitationMutateAsync.mockResolvedValue(undefined);
    renderAsOwner();

    fireEvent.click(await screen.findByRole('tab', { name: 'Convites' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar' }));

    await waitFor(() => expect(revokeInvitationMutateAsync).toHaveBeenCalledWith('inv-1'));
  });

  it('OWNER reenvia um convite', async () => {
    mockedUseArenaMembers.mockReturnValue({
      data: [OWNER_MEMBER],
      isPending: false,
      isError: false,
    });
    mockedUseArenaInvitations.mockReturnValue({
      data: [PENDING_INVITATION],
      isPending: false,
      isError: false,
    });
    resendInvitationMutateAsync.mockResolvedValue(PENDING_INVITATION);
    renderAsOwner();

    fireEvent.click(await screen.findByRole('tab', { name: 'Convites' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar' }));

    await waitFor(() => expect(resendInvitationMutateAsync).toHaveBeenCalledWith('inv-1'));
  });
});
