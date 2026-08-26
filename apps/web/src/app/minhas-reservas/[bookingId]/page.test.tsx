import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BookingDetail } from './page';
import {
  useMyBooking,
  useCancelBooking,
  useBookingPayment,
  useCreateBookingPayment,
} from '../../../hooks/use-api';
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
  useBookingPayment: jest.fn(),
  useCreateBookingPayment: jest.fn(),
}));

const mockedUseMyBooking = useMyBooking as jest.Mock;
const mockedUseCancelBooking = useCancelBooking as jest.Mock;
const mockedUseBookingPayment = useBookingPayment as jest.Mock;
const mockedUseCreateBookingPayment = useCreateBookingPayment as jest.Mock;

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
  let createPaymentMutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    searchParamsValue = new URLSearchParams();
    mutateAsync = jest.fn();
    mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: false });
    createPaymentMutateAsync = jest.fn();
    mockedUseBookingPayment.mockReturnValue({ data: null, isPending: false, isError: false });
    mockedUseCreateBookingPayment.mockReturnValue({
      mutateAsync: createPaymentMutateAsync,
      isPending: false,
    });
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

  describe('Seção de pagamento (Fase 17)', () => {
    const payment = {
      id: 'payment-1',
      bookingId: 'booking-1',
      status: 'PENDING',
      amount: '100',
      currency: 'BRL',
      checkoutUrl: 'https://mp.example/checkout',
      pixCopyPaste: '00020126-fake-pix',
      failureReason: null,
      paidAt: null,
      expiresAt: '2026-09-07T13:30:00.000Z',
      createdAt: '2026-09-07T13:00:00.000Z',
    };

    it('sem nenhum pagamento ainda, mostra "Pagar com PIX"', () => {
      mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
      mockedUseBookingPayment.mockReturnValue({ data: null, isPending: false, isError: false });

      render(<BookingDetail bookingId="booking-1" />);

      expect(screen.getByText('Esta reserva ainda não foi paga.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pagar com PIX' })).toBeInTheDocument();
    });

    it('clicar em "Pagar com PIX" dispara a mutation com uma Idempotency-Key nova', async () => {
      mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
      mockedUseBookingPayment.mockReturnValue({ data: null, isPending: false, isError: false });
      createPaymentMutateAsync.mockResolvedValue(payment);

      render(<BookingDetail bookingId="booking-1" />);
      fireEvent.click(screen.getByRole('button', { name: 'Pagar com PIX' }));

      await waitFor(() => expect(createPaymentMutateAsync).toHaveBeenCalledTimes(1));
      expect(typeof createPaymentMutateAsync.mock.calls[0][0]).toBe('string');
    });

    it('PENDING mostra o código PIX copia e cola e o prazo de expiração — nunca edita o valor', () => {
      mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
      mockedUseBookingPayment.mockReturnValue({ data: payment, isPending: false, isError: false });

      render(<BookingDetail bookingId="booking-1" />);

      expect(screen.getByText('Aguardando pagamento')).toBeInTheDocument();
      const pixInput = screen.getByLabelText('Código PIX copia e cola') as HTMLInputElement;
      expect(pixInput).toHaveValue('00020126-fake-pix');
      expect(pixInput).toHaveAttribute('readonly');
      // O valor exibido é sempre o do backend — não há nenhum campo editável.
      expect(screen.getAllByText('R$ 100,00').length).toBeGreaterThan(0);
    });

    it('PAID mostra confirmação e data de pagamento, sem botão de pagar', () => {
      mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
      mockedUseBookingPayment.mockReturnValue({
        data: { ...payment, status: 'PAID', paidAt: '2026-09-07T13:05:00.000Z' },
        isPending: false,
        isError: false,
      });

      render(<BookingDetail bookingId="booking-1" />);

      expect(screen.getByText('Pago')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /pagar/i })).not.toBeInTheDocument();
    });

    it('FAILED mostra "Tentar pagar novamente"', () => {
      mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
      mockedUseBookingPayment.mockReturnValue({
        data: { ...payment, status: 'FAILED', failureReason: 'insufficient_funds', pixCopyPaste: null },
        isPending: false,
        isError: false,
      });

      render(<BookingDetail bookingId="booking-1" />);

      expect(screen.getByText('Pagamento recusado')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tentar pagar novamente' })).toBeInTheDocument();
    });

    it('CANCELLED explica que a tentativa foi cancelada junto com a reserva, sem botão de pagar', () => {
      mockedUseMyBooking.mockReturnValue({
        data: { ...booking, status: 'CANCELLED' },
        isPending: false,
        isError: false,
      });
      mockedUseBookingPayment.mockReturnValue({
        data: { ...payment, status: 'CANCELLED', pixCopyPaste: null },
        isPending: false,
        isError: false,
      });

      render(<BookingDetail bookingId="booking-1" />);

      expect(screen.getByText(/cancelada porque a reserva foi cancelada/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /pagar/i })).not.toBeInTheDocument();
    });

    it('reserva cancelada e nunca paga: seção financeira nem aparece', () => {
      mockedUseMyBooking.mockReturnValue({
        data: { ...booking, status: 'CANCELLED' },
        isPending: false,
        isError: false,
      });
      mockedUseBookingPayment.mockReturnValue({ data: null, isPending: false, isError: false });

      render(<BookingDetail bookingId="booking-1" />);

      expect(screen.queryByText('Pagamento')).not.toBeInTheDocument();
    });

    it('erro ao iniciar pagamento mostra mensagem amigável, nunca finge sucesso', async () => {
      mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
      mockedUseBookingPayment.mockReturnValue({ data: null, isPending: false, isError: false });
      createPaymentMutateAsync.mockRejectedValue(new ApiError(409, 'Esta reserva já está paga.'));

      render(<BookingDetail bookingId="booking-1" />);
      fireEvent.click(screen.getByRole('button', { name: 'Pagar com PIX' }));

      expect(await screen.findByText('Esta reserva já está paga.')).toBeInTheDocument();
    });
  });
});
