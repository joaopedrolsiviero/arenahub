import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CourtsList } from './page';
import { useCourts, useCreateCourt, useMyAdminArenas, useDashboard } from '../../../../hooks/use-api';
import { ApiError } from '../../../../lib/api';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/arena-1/quadras',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../../../hooks/use-api', () => ({
  useMyAdminArenas: jest.fn(),
  useDashboard: jest.fn(),
  useCourts: jest.fn(),
  useCreateCourt: jest.fn(),
}));

const mockedUseMyAdminArenas = useMyAdminArenas as jest.Mock;
const mockedUseDashboard = useDashboard as jest.Mock;
const mockedUseCourts = useCourts as jest.Mock;
const mockedUseCreateCourt = useCreateCourt as jest.Mock;

const activeCourt = {
  id: 'court-1',
  arenaId: 'arena-1',
  name: 'Quadra 1',
  sport: 'BEACH_VOLLEYBALL',
  description: null,
  isActive: true,
  pricePerSlot: '100.00',
  slotDurationMinutes: 60,
  bufferMinutes: 0,
};

describe('CourtsList', () => {
  let mutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseMyAdminArenas.mockReturnValue({ data: [] });
    mockedUseDashboard.mockReturnValue({ data: undefined });
    mutateAsync = jest.fn();
    mockedUseCreateCourt.mockReturnValue({ mutateAsync, isPending: false });
  });

  it('mostra o estado de carregamento', () => {
    mockedUseCourts.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<CourtsList arenaId="arena-1" />);

    expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('lista as quadras existentes, com preço e duração', () => {
    mockedUseCourts.mockReturnValue({ data: [activeCourt], isPending: false, isError: false });
    render(<CourtsList arenaId="arena-1" />);

    expect(screen.getByText('Quadra 1')).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*100,00/)).toBeInTheDocument();
    expect(screen.getByText('60 min')).toBeInTheDocument();
  });

  it('quadra inativa mostra o badge "Inativa"', () => {
    mockedUseCourts.mockReturnValue({
      data: [{ ...activeCourt, isActive: false }],
      isPending: false,
      isError: false,
    });
    render(<CourtsList arenaId="arena-1" />);

    expect(screen.getByText('Inativa')).toBeInTheDocument();
  });

  // Fase 28, item 6/18: preço e duração são coletados JÁ na criação, não só
  // depois — reduz a jornada a um único passo.
  it('Fase 28: cria uma quadra já com preço e duração no mesmo formulário', async () => {
    mockedUseCourts.mockReturnValue({ data: [], isPending: false, isError: false });
    mutateAsync.mockResolvedValue({ ...activeCourt });
    render(<CourtsList arenaId="arena-1" />);

    fireEvent.click(screen.getByRole('button', { name: /nova quadra/i }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Quadra Nova' } });
    fireEvent.change(screen.getByLabelText('Preço (R$)'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('Duração (min)'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: /^criar quadra$/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        name: 'Quadra Nova',
        sport: 'BEACH_VOLLEYBALL',
        pricePerSlot: 80,
        slotDurationMinutes: 90,
      }),
    );
  });

  it('Fase 28: estado vazio mostra CTA que abre o formulário de criação', () => {
    mockedUseCourts.mockReturnValue({ data: [], isPending: false, isError: false });
    render(<CourtsList arenaId="arena-1" />);

    expect(screen.getByText('Nenhuma quadra cadastrada ainda.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /adicionar primeira quadra/i }));

    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
  });

  it('mostra mensagem de erro quando a criação falha', async () => {
    mockedUseCourts.mockReturnValue({ data: [], isPending: false, isError: false });
    mutateAsync.mockRejectedValue(new ApiError(409, 'Já existe uma quadra com este nome.'));
    render(<CourtsList arenaId="arena-1" />);

    fireEvent.click(screen.getByRole('button', { name: /nova quadra/i }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Quadra 1' } });
    fireEvent.click(screen.getByRole('button', { name: /^criar quadra$/i }));

    expect(await screen.findByText('Já existe uma quadra com este nome.')).toBeInTheDocument();
  });
});
