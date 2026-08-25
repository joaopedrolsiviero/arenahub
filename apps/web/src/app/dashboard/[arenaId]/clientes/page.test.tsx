import { render, screen, fireEvent, act } from '@testing-library/react';
import { CustomersList } from './page';
import { useArenaCustomers, useDashboard, useMyAdminArenas } from '../../../../hooks/use-api';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/arena-1/clientes',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../../../hooks/use-api', () => ({
  useMyAdminArenas: jest.fn(),
  useDashboard: jest.fn(),
  useArenaCustomers: jest.fn(),
}));

const mockedUseMyAdminArenas = useMyAdminArenas as jest.Mock;
const mockedUseDashboard = useDashboard as jest.Mock;
const mockedUseArenaCustomers = useArenaCustomers as jest.Mock;

function renderPage() {
  return render(<CustomersList arenaId="arena-1" />);
}

describe('ClientesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseMyAdminArenas.mockReturnValue({ data: [{ id: 'arena-1', role: 'OWNER' }] });
    mockedUseDashboard.mockReturnValue({
      data: { arena: { name: 'Arena Central', timezone: 'America/Sao_Paulo' } },
    });
  });

  it('mostra o estado de carregamento', async () => {
    mockedUseArenaCustomers.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderPage();

    expect(await screen.findByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('mostra o estado de erro', async () => {
    mockedUseArenaCustomers.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderPage();

    expect(await screen.findByText('Não foi possível carregar os clientes.')).toBeInTheDocument();
  });

  it('mostra estado vazio quando a arena não tem clientes', async () => {
    mockedUseArenaCustomers.mockReturnValue({
      data: { items: [], total: 0, page: 1, limit: 20 },
      isPending: false,
      isError: false,
    });
    renderPage();

    expect(await screen.findByText('Ainda não há clientes nesta arena.')).toBeInTheDocument();
  });

  it('lista clientes com reservas, receita e última reserva', async () => {
    mockedUseArenaCustomers.mockReturnValue({
      data: {
        items: [
          {
            userId: 'user-1',
            name: 'João Pedro',
            email: 'joao@example.com',
            totalBookings: 18,
            confirmedBookings: 15,
            cancelledBookings: 3,
            totalRevenue: 1350,
            firstBookingAt: '2026-05-10T13:00:00.000Z',
            lastBookingAt: '2026-08-24T22:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      },
      isPending: false,
      isError: false,
    });
    renderPage();

    expect(await screen.findByText('João Pedro')).toBeInTheDocument();
    expect(screen.getByText('18 reservas')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.350,00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /João Pedro/ })).toHaveAttribute(
      'href',
      '/dashboard/arena-1/clientes/user-1',
    );
  });

  it('busca dispara a query com o termo digitado após um pequeno atraso', async () => {
    jest.useFakeTimers();
    try {
      mockedUseArenaCustomers.mockReturnValue({
        data: { items: [], total: 0, page: 1, limit: 20 },
        isPending: false,
        isError: false,
      });
      renderPage();

      fireEvent.change(await screen.findByLabelText('Buscar cliente'), {
        target: { value: 'Maria' },
      });

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(mockedUseArenaCustomers).toHaveBeenLastCalledWith(
        'arena-1',
        expect.objectContaining({ search: 'Maria', page: 1 }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('mostra "nenhum cliente encontrado" quando a busca não encontra nada', async () => {
    mockedUseArenaCustomers.mockReturnValue({
      data: { items: [], total: 0, page: 1, limit: 20 },
      isPending: false,
      isError: false,
    });
    jest.useFakeTimers();
    try {
      renderPage();
      fireEvent.change(await screen.findByLabelText('Buscar cliente'), {
        target: { value: 'ninguem' },
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(await screen.findByText('Nenhum cliente encontrado.')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('mostra paginação só quando há mais de uma página', async () => {
    mockedUseArenaCustomers.mockReturnValue({
      data: {
        items: [
          {
            userId: 'user-1',
            name: 'João',
            email: 'joao@example.com',
            totalBookings: 1,
            confirmedBookings: 1,
            cancelledBookings: 0,
            totalRevenue: 75,
            firstBookingAt: '2026-08-01T13:00:00.000Z',
            lastBookingAt: '2026-08-01T13:00:00.000Z',
          },
        ],
        total: 25,
        page: 1,
        limit: 20,
      },
      isPending: false,
      isError: false,
    });
    renderPage();

    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima' })).not.toBeDisabled();
  });
});
