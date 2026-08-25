import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { InviteCard } from './page';
import { useAcceptInvitation, useInvitationByToken } from '../../../hooks/use-api';
import { ApiError } from '../../../lib/api';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

let mockIsSignedIn = false;
let mockEmail: string | undefined;

jest.mock('@clerk/nextjs', () => ({
  Show: ({ when, children }: { when: string; children: ReactNode }) =>
    (when === 'signed-in') === mockIsSignedIn ? children : null,
  SignIn: () => <div data-testid="clerk-sign-in" />,
  useUser: () => ({
    isSignedIn: mockIsSignedIn,
    user: mockIsSignedIn ? { primaryEmailAddress: { emailAddress: mockEmail } } : null,
  }),
}));

jest.mock('../../../hooks/use-api', () => ({
  useInvitationByToken: jest.fn(),
  useAcceptInvitation: jest.fn(),
}));

const mockedUseInvitationByToken = useInvitationByToken as jest.Mock;
const mockedUseAcceptInvitation = useAcceptInvitation as jest.Mock;

const PENDING_INVITATION = {
  id: 'inv-1',
  arenaId: 'arena-1',
  arenaName: 'Arena Central',
  email: 'convidado@example.com',
  role: 'ADMIN',
  status: 'PENDING',
  expiresAt: '2026-09-01T00:00:00.000Z',
};

function renderPage(token = 'tok_abc123') {
  return render(<InviteCard token={token} />);
}

describe('InvitationAcceptPage', () => {
  let acceptMutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSignedIn = false;
    mockEmail = undefined;
    acceptMutateAsync = jest.fn();
    mockedUseAcceptInvitation.mockReturnValue({ mutateAsync: acceptMutateAsync, isPending: false });
  });

  it('mostra o estado de carregamento', () => {
    mockedUseInvitationByToken.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderPage();

    expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('mostra mensagem genérica quando o convite não é encontrado', async () => {
    mockedUseInvitationByToken.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderPage();

    expect(await screen.findByText('Convite indisponível')).toBeInTheDocument();
    expect(screen.getByText(/convite inválido ou indisponível/i)).toBeInTheDocument();
  });

  it('mostra estado de convite revogado', async () => {
    mockedUseInvitationByToken.mockReturnValue({
      data: { ...PENDING_INVITATION, status: 'REVOKED' },
      isPending: false,
      isError: false,
    });
    renderPage();

    expect(await screen.findByText('Convite revogado')).toBeInTheDocument();
  });

  it('mostra estado de convite expirado', async () => {
    mockedUseInvitationByToken.mockReturnValue({
      data: { ...PENDING_INVITATION, status: 'EXPIRED' },
      isPending: false,
      isError: false,
    });
    renderPage();

    expect(await screen.findByText('Convite expirado')).toBeInTheDocument();
  });

  it('mostra estado de convite já aceito, sem botão para o painel', async () => {
    mockedUseInvitationByToken.mockReturnValue({
      data: { ...PENDING_INVITATION, status: 'ACCEPTED' },
      isPending: false,
      isError: false,
    });
    renderPage();

    expect(await screen.findByText('Este convite já foi utilizado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ir para o painel' })).not.toBeInTheDocument();
  });

  it('convite pendente e usuário deslogado mostra o formulário de login', async () => {
    mockedUseInvitationByToken.mockReturnValue({
      data: PENDING_INVITATION,
      isPending: false,
      isError: false,
    });
    mockIsSignedIn = false;
    renderPage();

    expect(await screen.findByText('Convite para Arena Central')).toBeInTheDocument();
    expect(screen.getByText('convidado@example.com')).toBeInTheDocument();
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceitar convite' })).not.toBeInTheDocument();
  });

  it('avisa quando o e-mail logado é diferente do convite', async () => {
    mockedUseInvitationByToken.mockReturnValue({
      data: PENDING_INVITATION,
      isPending: false,
      isError: false,
    });
    mockIsSignedIn = true;
    mockEmail = 'outra@example.com';
    renderPage();

    expect(await screen.findByText('Convite enviado para outro endereço')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceitar convite' })).not.toBeInTheDocument();
  });

  it('usuário logado com o e-mail certo aceita o convite com sucesso', async () => {
    mockedUseInvitationByToken.mockReturnValue({
      data: PENDING_INVITATION,
      isPending: false,
      isError: false,
    });
    mockIsSignedIn = true;
    mockEmail = 'convidado@example.com';
    acceptMutateAsync.mockResolvedValue(undefined);
    renderPage('tok_abc123');

    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar convite' }));

    await waitFor(() => expect(acceptMutateAsync).toHaveBeenCalledWith('tok_abc123'));
    expect(await screen.findByText('Convite aceito!')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ir para o painel' }));
    expect(push).toHaveBeenCalledWith('/dashboard/arena-1');
  });

  it('mostra erro amigável quando aceitar falha', async () => {
    mockedUseInvitationByToken.mockReturnValue({
      data: PENDING_INVITATION,
      isPending: false,
      isError: false,
    });
    mockIsSignedIn = true;
    mockEmail = 'convidado@example.com';
    acceptMutateAsync.mockRejectedValue(new ApiError(409, 'Este convite já foi utilizado.'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar convite' }));

    expect(await screen.findByText('Este convite já foi utilizado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aceitar convite' })).toBeInTheDocument();
  });
});
