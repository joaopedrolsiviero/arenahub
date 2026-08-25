import { render, screen } from '@testing-library/react';
import { CustomerDetail } from './page';
import {
  useArenaCustomer,
  useArenaCustomerBookings,
  useDashboard,
  useMyAdminArenas,
} from '../../../../../hooks/use-api';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/arena-1/clientes/user-1',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../../../../hooks/use-api', () => ({
  useMyAdminArenas: jest.fn(),
  useDashboard: jest.fn(),
  useArenaCustomer: jest.fn(),
  useArenaCustomerBookings: jest.fn(),
}));

const mockedUseMyAdminArenas = useMyAdminArenas as jest.Mock;
const mockedUseDashboard = useDashboard as jest.Mock;
const mockedUseArenaCustomer = useArenaCustomer as jest.Mock;
const mockedUseArenaCustomerBookings = useArenaCustomerBookings as jest.Mock;

const CUSTOMER = {
  userId: 'user-1',
  name: 'João Pedro',
  email: 'joao@example.com',
  totalBookings: 18,
  confirmedBookings: 15,
  cancelledBookings: 3,
  totalRevenue: 1350,
  firstBookingAt: '2026-05-10T13:00:00.000Z',
  lastBookingAt: '2026-08-24T22:00:00.000Z',
};

const BOOKING = {
  id: 'booking-1',
  status: 'CONFIRMED',
  startsAt: '2026-08-24T22:00:00.000Z',
  endsAt: '2026-08-24T23:00:00.000Z',
  total: '75',
  court: { id: 'court-1', name: 'Quadra 2' },
};

function renderPage() {
  return render(<CustomerDetail arenaId="arena-1" userId="user-1" />);
}

describe('CustomerDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseMyAdminArenas.mockReturnValue({ data: [{ id: 'arena-1', role: 'OWNER' }] });
    mockedUseDashboard.mockReturnValue({
      data: { arena: { name: 'Arena Central', timezone: 'America/Sao_Paulo' } },
    });
    mockedUseArenaCustomerBookings.mockReturnValue({ data: [BOOKING], isPending: false });
  });

  it('mostra o estado de carregamento', async () => {
    mockedUseArenaCustomer.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderPage();

    expect(await screen.findByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('mostra erro quando o cliente não é encontrado', async () => {
    mockedUseArenaCustomer.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderPage();

    expect(await screen.findByText('Cliente não encontrado nesta arena.')).toBeInTheDocument();
  });

  it('mostra nome, e-mail e o resumo completo', async () => {
    mockedUseArenaCustomer.mockReturnValue({ data: CUSTOMER, isPending: false, isError: false });
    renderPage();

    expect(await screen.findByText('João Pedro')).toBeInTheDocument();
    expect(screen.getByText('joao@example.com')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.350,00')).toBeInTheDocument();
  });

  it('mostra o histórico de reservas com quadra, horário, valor e status', async () => {
    mockedUseArenaCustomer.mockReturnValue({ data: CUSTOMER, isPending: false, isError: false });
    renderPage();

    expect(await screen.findByText('Quadra 2')).toBeInTheDocument();
    expect(screen.getByText('R$ 75,00')).toBeInTheDocument();
    expect(screen.getByText('Confirmada')).toBeInTheDocument();
  });

  it('mostra estado vazio quando o histórico não tem reservas', async () => {
    mockedUseArenaCustomer.mockReturnValue({ data: CUSTOMER, isPending: false, isError: false });
    mockedUseArenaCustomerBookings.mockReturnValue({ data: [], isPending: false });
    renderPage();

    expect(await screen.findByText('Nenhuma reserva encontrada.')).toBeInTheDocument();
  });

  it('mostra o link/botão para voltar para a lista de clientes', async () => {
    mockedUseArenaCustomer.mockReturnValue({ data: CUSTOMER, isPending: false, isError: false });
    renderPage();

    expect(await screen.findByRole('button', { name: /Voltar para clientes/ })).toBeInTheDocument();
  });
});
