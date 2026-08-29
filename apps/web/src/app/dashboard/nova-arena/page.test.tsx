import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NovaArenaPage from './page';
import { useCreateArena } from '../../../hooks/use-api';
import { ApiError } from '../../../lib/api';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/dashboard/nova-arena',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@clerk/nextjs', () => ({
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    when === 'signed-in' ? children : null,
  UserButton: () => null,
}));

jest.mock('../../../hooks/use-api', () => ({
  useCreateArena: jest.fn(),
}));

const mockedUseCreateArena = useCreateArena as jest.Mock;

describe('NovaArenaPage', () => {
  let mutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mutateAsync = jest.fn();
    mockedUseCreateArena.mockReturnValue({ mutateAsync, isPending: false });
  });

  it('gera o slug automaticamente a partir do nome, até o campo ser editado manualmente', () => {
    render(<NovaArenaPage />);

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Arena Zona Sul' } });
    expect(screen.getByLabelText('Endereço (slug)')).toHaveValue('arena-zona-sul');

    // Edição manual do slug passa a valer, mesmo que o nome mude de novo.
    fireEvent.change(screen.getByLabelText('Endereço (slug)'), {
      target: { value: 'meu-slug-customizado' },
    });
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Arena Zona Sul 2' } });
    expect(screen.getByLabelText('Endereço (slug)')).toHaveValue('meu-slug-customizado');
  });

  // Fase 28, Caso 1: fluxo de criação de arena pelo próprio OWNER, algo que
  // hoje não existia no frontend.
  it('Fase 28: cria a arena com nome/slug/timezone e navega pra criação da primeira quadra', async () => {
    mutateAsync.mockResolvedValue({ id: 'arena-nova-1' });
    render(<NovaArenaPage />);

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Arena Central' } });
    fireEvent.change(screen.getByLabelText('Timezone'), {
      target: { value: 'America/Recife' },
    });
    fireEvent.click(screen.getByRole('button', { name: /criar arena/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        name: 'Arena Central',
        slug: 'arena-central',
        timezone: 'America/Recife',
        description: undefined,
      }),
    );
    expect(push).toHaveBeenCalledWith('/dashboard/arena-nova-1/quadras');
  });

  it('mostra mensagem de erro quando o slug já existe (409)', async () => {
    mutateAsync.mockRejectedValue(new ApiError(409, 'Já existe uma arena com este slug.'));
    render(<NovaArenaPage />);

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Arena Central' } });
    fireEvent.click(screen.getByRole('button', { name: /criar arena/i }));

    expect(await screen.findByText('Já existe uma arena com este slug.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
