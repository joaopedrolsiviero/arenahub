import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OperatingHoursEditor } from './page';
import {
  useMyAdminArenas,
  useDashboard,
  useOperatingHours,
  useReplaceOperatingHours,
} from '../../../../hooks/use-api';
import { ApiError } from '../../../../lib/api';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/arena-1/horarios',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../../../hooks/use-api', () => ({
  useMyAdminArenas: jest.fn(),
  useDashboard: jest.fn(),
  useOperatingHours: jest.fn(),
  useReplaceOperatingHours: jest.fn(),
}));

const mockedUseMyAdminArenas = useMyAdminArenas as jest.Mock;
const mockedUseDashboard = useDashboard as jest.Mock;
const mockedUseOperatingHours = useOperatingHours as jest.Mock;
const mockedUseReplaceOperatingHours = useReplaceOperatingHours as jest.Mock;

describe('OperatingHoursEditor', () => {
  let mutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseMyAdminArenas.mockReturnValue({ data: [] });
    mockedUseDashboard.mockReturnValue({ data: undefined });
    mutateAsync = jest.fn();
    mockedUseReplaceOperatingHours.mockReturnValue({ mutateAsync, isPending: false });
  });

  it('mostra "Fechado" para dias sem intervalo configurado', () => {
    mockedUseOperatingHours.mockReturnValue({ data: [], isPending: false, isError: false });
    render(<OperatingHoursEditor arenaId="arena-1" />);

    expect(screen.getAllByText('Fechado').length).toBe(7);
  });

  it('carrega os intervalos já salvos nos campos', () => {
    mockedUseOperatingHours.mockReturnValue({
      data: [{ id: 'oh-1', dayOfWeek: 'THURSDAY', opensAt: '08:00', closesAt: '22:00' }],
      isPending: false,
      isError: false,
    });
    render(<OperatingHoursEditor arenaId="arena-1" />);

    expect(screen.getByDisplayValue('08:00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('22:00')).toBeInTheDocument();
  });

  it('adiciona um novo intervalo ao clicar em "+ Intervalo"', () => {
    mockedUseOperatingHours.mockReturnValue({ data: [], isPending: false, isError: false });
    render(<OperatingHoursEditor arenaId="arena-1" />);

    const addButtons = screen.getAllByRole('button', { name: '+ Intervalo' });
    fireEvent.click(addButtons[0]!);

    expect(screen.getByDisplayValue('08:00')).toBeInTheDocument();
  });

  it('salva os intervalos e mostra mensagem de sucesso', async () => {
    mockedUseOperatingHours.mockReturnValue({
      data: [{ id: 'oh-1', dayOfWeek: 'THURSDAY', opensAt: '08:00', closesAt: '22:00' }],
      isPending: false,
      isError: false,
    });
    mutateAsync.mockResolvedValue([]);
    render(<OperatingHoursEditor arenaId="arena-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith([
      { dayOfWeek: 'THURSDAY', opensAt: '08:00', closesAt: '22:00' },
    ]));
    expect(await screen.findByText(/horário atualizado/i)).toBeInTheDocument();
  });

  it('mostra a mensagem de erro do backend quando salvar falha', async () => {
    mockedUseOperatingHours.mockReturnValue({
      data: [{ id: 'oh-1', dayOfWeek: 'THURSDAY', opensAt: '08:00', closesAt: '22:00' }],
      isPending: false,
      isError: false,
    });
    mutateAsync.mockRejectedValue(new ApiError(400, 'Intervalos sobrepostos em THURSDAY.'));
    render(<OperatingHoursEditor arenaId="arena-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário' }));

    expect(await screen.findByText('Intervalos sobrepostos em THURSDAY.')).toBeInTheDocument();
  });

  it('"Cancelar edição" descarta alterações não salvas', () => {
    mockedUseOperatingHours.mockReturnValue({
      data: [{ id: 'oh-1', dayOfWeek: 'THURSDAY', opensAt: '08:00', closesAt: '22:00' }],
      isPending: false,
      isError: false,
    });
    render(<OperatingHoursEditor arenaId="arena-1" />);

    fireEvent.click(screen.getAllByRole('button', { name: '+ Intervalo' })[0]!); // segunda-feira
    expect(screen.getAllByDisplayValue('08:00')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edição' }));
    expect(screen.getAllByDisplayValue('08:00')).toHaveLength(1);
  });
});
