import { render, screen } from '@testing-library/react';
import MyBookingsPage from './page';
import { useMyBookings, useMyPaymentStatuses } from '../../hooks/use-api';

jest.mock('@clerk/nextjs', () => ({
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    when === 'signed-in' ? children : null,
  UserButton: () => null,
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/minhas-reservas',
}));

jest.mock('../../hooks/use-api', () => ({
  useMyBookings: jest.fn(),
  useMyPaymentStatuses: jest.fn(),
}));

const mockedUseMyBookings = useMyBookings as jest.Mock;
const mockedUseMyPaymentStatuses = useMyPaymentStatuses as jest.Mock;

const arena = { id: 'arena-1', name: 'Arena Central', slug: 'arena-central', timezone: 'America/Sao_Paulo' };
const court = { id: 'court-1', name: 'Quadra 1', sport: 'BEACH_VOLLEYBALL', arena };

describe('MyBookingsPage', () => {
  beforeEach(() => {
    mockedUseMyPaymentStatuses.mockReturnValue({ data: {} });
  });

  it('mostra o estado de carregamento', () => {
    mockedUseMyBookings.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<MyBookingsPage />);

    expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('mostra o estado de erro', () => {
    mockedUseMyBookings.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<MyBookingsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível carregar/i);
  });

  it('separa reservas futuras, passadas e canceladas em abas', () => {
    mockedUseMyBookings.mockReturnValue({
      data: [
        {
          id: 'booking-future',
          status: 'CONFIRMED',
          startsAt: '2099-01-01T13:00:00.000Z',
          endsAt: '2099-01-01T14:00:00.000Z',
          total: '100',
          court,
        },
        {
          id: 'booking-past',
          status: 'CONFIRMED',
          startsAt: '2000-01-01T13:00:00.000Z',
          endsAt: '2000-01-01T14:00:00.000Z',
          total: '100',
          court,
        },
        {
          id: 'booking-cancelled',
          status: 'CANCELLED',
          startsAt: '2099-01-01T13:00:00.000Z',
          endsAt: '2099-01-01T14:00:00.000Z',
          total: '100',
          court,
        },
      ],
      isPending: false,
      isError: false,
    });
    render(<MyBookingsPage />);

    // A aba "Próximas" é a padrão — só a reserva futura aparece nela.
    expect(screen.getAllByText('Arena Central')).toHaveLength(1);
  });

  it('mostra o status do pagamento junto do status da reserva na lista (Fase 26, item 14)', () => {
    mockedUseMyBookings.mockReturnValue({
      data: [
        {
          id: 'booking-pago',
          status: 'CONFIRMED',
          startsAt: '2099-01-01T13:00:00.000Z',
          endsAt: '2099-01-01T14:00:00.000Z',
          total: '100',
          court,
        },
        {
          id: 'booking-sem-pagamento',
          status: 'CONFIRMED',
          startsAt: '2099-01-02T13:00:00.000Z',
          endsAt: '2099-01-02T14:00:00.000Z',
          total: '100',
          court,
        },
      ],
      isPending: false,
      isError: false,
    });
    mockedUseMyPaymentStatuses.mockReturnValue({ data: { 'booking-pago': 'PAID' } });
    render(<MyBookingsPage />);

    expect(screen.getByText('Pago')).toBeInTheDocument();
    // A reserva sem nenhuma tentativa de pagamento não mostra nenhum badge
    // de pagamento — nunca inventa um estado que não existe.
    expect(screen.queryByText('Aguardando pagamento')).not.toBeInTheDocument();
  });

  it('mostra estado vazio quando não há reservas', () => {
    mockedUseMyBookings.mockReturnValue({ data: [], isPending: false, isError: false });
    render(<MyBookingsPage />);

    expect(screen.getByText(/não tem reservas futuras/i)).toBeInTheDocument();
  });
});
