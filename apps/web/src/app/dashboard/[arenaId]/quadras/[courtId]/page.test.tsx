import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CourtEditor } from './page';
import { useCourt, useUpdateCourt, useMyAdminArenas, useDashboard } from '../../../../../hooks/use-api';
import { ApiError } from '../../../../../lib/api';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/arena-1/quadras/court-1',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../../../../hooks/use-api', () => ({
  useMyAdminArenas: jest.fn(),
  useDashboard: jest.fn(),
  useCourt: jest.fn(),
  useUpdateCourt: jest.fn(),
}));

const mockedUseMyAdminArenas = useMyAdminArenas as jest.Mock;
const mockedUseDashboard = useDashboard as jest.Mock;
const mockedUseCourt = useCourt as jest.Mock;
const mockedUseUpdateCourt = useUpdateCourt as jest.Mock;

const court = {
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

describe('CourtEditor', () => {
  let mutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseMyAdminArenas.mockReturnValue({ data: [] });
    mockedUseDashboard.mockReturnValue({ data: undefined });
    mutateAsync = jest.fn();
    mockedUseUpdateCourt.mockReturnValue({ mutateAsync, isPending: false });
  });

  it('mostra o estado de carregamento', () => {
    mockedUseCourt.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<CourtEditor arenaId="arena-1" courtId="court-1" />);

    expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('mostra os dados atuais da quadra', () => {
    mockedUseCourt.mockReturnValue({ data: court, isPending: false, isError: false });
    render(<CourtEditor arenaId="arena-1" courtId="court-1" />);

    expect(screen.getByLabelText('Nome')).toHaveValue('Quadra 1');
    expect(screen.getByLabelText('Preço (R$)')).toHaveValue(100);
    expect(screen.getByLabelText('Duração (min)')).toHaveValue(60);
  });

  it('salva as alterações de preço/duração/buffer', async () => {
    mockedUseCourt.mockReturnValue({ data: court, isPending: false, isError: false });
    mutateAsync.mockResolvedValue({ ...court, pricePerSlot: '75.00' });
    render(<CourtEditor arenaId="arena-1" courtId="court-1" />);

    fireEvent.change(screen.getByLabelText('Preço (R$)'), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        courtId: 'court-1',
        dto: {
          name: 'Quadra 1',
          description: undefined,
          pricePerSlot: 75,
          slotDurationMinutes: 60,
          bufferMinutes: 0,
        },
      }),
    );
  });

  it('alterna quadra ativa/inativa', async () => {
    mockedUseCourt.mockReturnValue({ data: court, isPending: false, isError: false });
    mutateAsync.mockResolvedValue({ ...court, isActive: false });
    render(<CourtEditor arenaId="arena-1" courtId="court-1" />);

    fireEvent.click(screen.getByRole('button', { name: /desativar quadra/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ courtId: 'court-1', dto: { isActive: false } }),
    );
  });

  // Fase 28, Caso 13: quadra inativa não pode ser confundida com uma pronta
  // pra reservar — o formulário deixa isso claro visualmente.
  it('Fase 28: quadra inativa mostra o badge "Inativa" e o botão para reativar', () => {
    mockedUseCourt.mockReturnValue({
      data: { ...court, isActive: false },
      isPending: false,
      isError: false,
    });
    render(<CourtEditor arenaId="arena-1" courtId="court-1" />);

    expect(screen.getByText('Inativa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ativar quadra/i })).toBeInTheDocument();
  });

  it('mostra mensagem de erro quando salvar falha', async () => {
    mockedUseCourt.mockReturnValue({ data: court, isPending: false, isError: false });
    mutateAsync.mockRejectedValue(new ApiError(409, 'Já existe uma quadra com este nome.'));
    render(<CourtEditor arenaId="arena-1" courtId="court-1" />);

    fireEvent.click(screen.getByRole('button', { name: /^salvar$/i }));

    expect(await screen.findByText('Já existe uma quadra com este nome.')).toBeInTheDocument();
  });

  it('mostra "quadra não encontrada" em erro de carregamento', () => {
    mockedUseCourt.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<CourtEditor arenaId="arena-1" courtId="court-x" />);

    expect(screen.getByText(/quadra não encontrada/i)).toBeInTheDocument();
  });
});
