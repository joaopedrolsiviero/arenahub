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
    arena: {
      id: 'arena-1',
      name: 'Arena Central',
      slug: 'arena-central',
      timezone: 'America/Sao_Paulo',
      paymentMode: 'ONLINE',
    },
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

  it('avisa que o reembolso é integral ao cancelar uma reserva já paga (Fase 27, Regra 2)', async () => {
    mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
    mockedUseBookingPayment.mockReturnValue({
      data: { status: 'PAID', amount: '100.00', paidAt: '2026-09-07T13:05:00.000Z' },
      isPending: false,
      isError: false,
    });
    render(<BookingDetail bookingId="booking-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));

    expect(
      await screen.findByText(/será reembolsado integralmente/i),
    ).toBeInTheDocument();
  });

  it('Fase 27: esconde o botão de cancelar e explica quando a reserva já começou', () => {
    mockedUseMyBooking.mockReturnValue({
      data: { ...booking, startsAt: '2020-01-01T13:00:00.000Z', endsAt: '2020-01-01T14:00:00.000Z' },
      isPending: false,
      isError: false,
    });
    render(<BookingDetail bookingId="booking-1" />);

    expect(screen.queryByRole('button', { name: /cancelar reserva/i })).not.toBeInTheDocument();
    expect(screen.getByText(/já começou e não pode mais ser cancelada/i)).toBeInTheDocument();
  });

  it('Fase 27: mostra "reembolso em processamento" enquanto o Payment está REFUNDING', () => {
    mockedUseMyBooking.mockReturnValue({
      data: { ...booking, status: 'CANCELLED' },
      isPending: false,
      isError: false,
    });
    mockedUseBookingPayment.mockReturnValue({
      data: { status: 'REFUNDING', amount: '100.00' },
      isPending: false,
      isError: false,
    });
    render(<BookingDetail bookingId="booking-1" />);

    expect(screen.getByText(/reembolso solicitado/i)).toBeInTheDocument();
  });

  it('Fase 27: mostra "reembolsado integralmente" quando o Payment está REFUNDED, nunca antes da confirmação', () => {
    mockedUseMyBooking.mockReturnValue({
      data: { ...booking, status: 'CANCELLED' },
      isPending: false,
      isError: false,
    });
    mockedUseBookingPayment.mockReturnValue({
      data: { status: 'REFUNDED', amount: '100.00', refundedAt: '2026-09-01T10:00:00.000Z' },
      isPending: false,
      isError: false,
    });
    render(<BookingDetail bookingId="booking-1" />);

    expect(screen.getByText(/reembolsado integralmente/i)).toBeInTheDocument();
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
      qrCodeBase64: 'iVBORw0KGgo=',
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
      const qrImage = screen.getByAltText('QR Code do PIX') as HTMLImageElement;
      expect(qrImage.src).toContain('data:image/png;base64,iVBORw0KGgo=');
      const pixInput = screen.getByLabelText('Código PIX copia e cola') as HTMLInputElement;
      expect(pixInput).toHaveValue('00020126-fake-pix');
      expect(pixInput).toHaveAttribute('readonly');
      // O valor exibido é sempre o do backend — não há nenhum campo editável.
      expect(screen.getAllByText('R$ 100,00').length).toBeGreaterThan(0);
    });

    it('Fase 30: botão de copiar o código PIX usa a Clipboard API e mostra feedback', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      mockedUseMyBooking.mockReturnValue({ data: booking, isPending: false, isError: false });
      mockedUseBookingPayment.mockReturnValue({ data: payment, isPending: false, isError: false });

      render(<BookingDetail bookingId="booking-1" />);
      fireEvent.click(screen.getByRole('button', { name: 'Copiar código PIX' }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith('00020126-fake-pix'));
      expect(await screen.findByRole('button', { name: 'Código copiado' })).toBeInTheDocument();
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

  // Fase "melhorias no fluxo de reserva", item 5 — arena com pagamento
  // presencial: nunca oferece "Pagar com PIX" nem a mensagem de "ainda não
  // foi paga" (que implicaria pagamento online pendente).
  describe('Seção de pagamento — arena com paymentMode IN_PERSON', () => {
    const inPersonBooking = {
      ...booking,
      court: { ...booking.court, arena: { ...booking.court.arena, paymentMode: 'IN_PERSON' } },
    };

    it('mostra a explicação de pagamento presencial, nunca "Pagar com PIX"', () => {
      mockedUseMyBooking.mockReturnValue({ data: inPersonBooking, isPending: false, isError: false });
      mockedUseBookingPayment.mockReturnValue({ data: null, isPending: false, isError: false });

      render(<BookingDetail bookingId="booking-1" />);

      expect(screen.getByText(/pagamento presencial/i)).toBeInTheDocument();
      expect(screen.queryByText('Esta reserva ainda não foi paga.')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /pagar/i })).not.toBeInTheDocument();
    });

    it('nunca chama a mutation de criar pagamento (não há botão pra isso)', () => {
      mockedUseMyBooking.mockReturnValue({ data: inPersonBooking, isPending: false, isError: false });
      mockedUseBookingPayment.mockReturnValue({ data: null, isPending: false, isError: false });

      render(<BookingDetail bookingId="booking-1" />);

      expect(createPaymentMutateAsync).not.toHaveBeenCalled();
    });
  });
});
