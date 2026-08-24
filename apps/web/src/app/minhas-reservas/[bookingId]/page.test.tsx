import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BookingDetail } from './page';
import { useMyBooking, useCancelBooking } from '../../../hooks/use-api';
import { ApiError } from '../../../lib/api';

const push = jest.fn();
let searchParamsValue = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParamsValue,
}));

jest.mock('../../../hooks/use-api', () => ({
  useMyBooking: jest.fn(),
  useCancelBooking: jest.fn(),
}));

const mockedUseMyBooking = useMyBooking as jest.Mock;
const mockedUseCancelBooking = useCancelBooking as jest.Mock;

const booking = {
  id: 'booking-1',
  status: 'CONFIRMED',
  startsAt: '2026-09-07T13:00:00.000Z',
  endsAt: '2026-09-07T14:00:00.000Z',
  total: '100',
  court: {
    id: 'court-1',
    name: 'Quadra 1',
    sport: 'BEACH_VOLLEYBALL',
    arena: { id: 'arena-1', name: 'Arena Central', slug: 'arena-central', timezone: 'America/Sao_Paulo' },
  },
};

describe('BookingDetail', () => {
  let mutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    searchParamsValue = new URLSearchParams();
    mutateAsync = jest.fn();
    mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: false });
  });

  it('mostra os dados da reserva', () => {
    mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
    render(<BookingDetail bookingId="booking-1" />);

    expect(screen.getByText('Arena Central')).toBeInTheDocument();
    expect(screen.getByText('Quadra 1')).toBeInTheDocument();
    expect(screen.getByText('R$ 100,00')).toBeInTheDocument();
    expect(screen.getByText('Confirmada')).toBeInTheDocument();
  });

  it('mostra o banner de sucesso quando ?created=true', () => {
    searchParamsValue = new URLSearchParams({ created: 'true' });
    mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
    render(<BookingDetail bookingId="booking-1" />);

    expect(screen.getByText(/reserva confirmada/i)).toBeInTheDocument();
  });

  it('não mostra o banner de sucesso sem o parâmetro', () => {
    mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
    render(<BookingDetail bookingId="booking-1" />);

    expect(screen.queryByText(/reserva confirmada/i)).not.toBeInTheDocument();
  });

  it('mostra o botão de cancelar apenas para reservas confirmadas', () => {
    mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
    render(<BookingDetail bookingId="booking-1" />);

    expect(screen.getByRole('button', { name: /cancelar reserva/i })).toBeInTheDocument();
  });

  it('não mostra o botão de cancelar para reservas já canceladas', () => {
    mockedUseMyBooking.mockReturnValue({
      data: { ...booking, status: 'CANCELLED' },
      isPending: false,
      isError: false,
    });
    render(<BookingDetail bookingId="booking-1" />);

    expect(screen.queryByRole('button', { name: /cancelar reserva/i })).not.toBeInTheDocument();
  });

  it('exige confirmação num dialog antes de cancelar (item 64)', async () => {
    mutateAsync.mockResolvedValue({ ...booking, status: 'CANCELLED' });
    mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
    render(<BookingDetail bookingId="booking-1" />);

    // O primeiro clique só abre o dialog — não deve cancelar direto.
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));
    expect(mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Sim, cancelar reserva' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        arenaId: 'arena-1',
        courtId: 'court-1',
        bookingId: 'booking-1',
      }),
    );
  });

  it('mostra mensagem de erro amigável quando o cancelamento falha', async () => {
    mutateAsync.mockRejectedValue(new ApiError(409, 'Reserva já cancelada.'));
    mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
    render(<BookingDetail bookingId="booking-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sim, cancelar reserva' }));

    expect(await screen.findByText('Reserva já cancelada.')).toBeInTheDocument();
  });

  it('mostra estado de erro quando a reserva não é encontrada', () => {
    mockedUseMyBooking.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<BookingDetail bookingId="booking-inexistente" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/não encontrada/i);
  });
});
