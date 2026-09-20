import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminBookingActions } from './admin-booking-actions';
import { useCancelBooking } from '../hooks/use-api';
import { ApiError } from '../lib/api';
import type { DashboardBookingItem, PaymentStatus } from '../lib/types';

jest.mock('../hooks/use-api', () => ({
  useCancelBooking: jest.fn(),
}));

const mockedUseCancelBooking = useCancelBooking as jest.Mock;
const mutateAsync = jest.fn();

// Data sempre relativa a Date.now() (mesmo padrão dos demais testes web):
// uma data fixa vira "passado" e esconde o botão de cancelar.
function isoInHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function booking(overrides: Partial<DashboardBookingItem> = {}): DashboardBookingItem {
  return {
    id: 'booking-1',
    courtId: 'court-1',
    courtName: 'Quadra 1',
    type: 'CUSTOMER',
    status: 'CONFIRMED',
    startsAt: isoInHours(48),
    endsAt: isoInHours(49),
    total: '100',
    reason: null,
    user: { id: 'user-1', name: 'Cliente Teste', email: 'cliente@example.com' },
    paymentStatus: null,
    ...overrides,
  };
}

function renderActions(
  item: DashboardBookingItem,
  onCancelled: (b: DashboardBookingItem) => void = jest.fn(),
) {
  return render(
    <AdminBookingActions
      booking={item}
      arenaId="arena-1"
      timezone="America/Sao_Paulo"
      onCancelled={onCancelled}
    />,
  );
}

async function confirmCancel() {
  // `hidden: true`: numa 2ª rodada o Base UI ainda pode ter a página marcada
  // como inerte enquanto o dialog anterior termina de fechar (jsdom não
  // dispara animationend).
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva', hidden: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sim, cancelar reserva', hidden: true }));
}

describe('AdminBookingActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: false });
  });

  describe('status de pagamento', () => {
    it.each<[PaymentStatus, RegExp]>([
      ['PENDING', /aguardando pagamento/i],
      ['PAID', /^pago$/i],
      ['EXPIRED', /expirado/i],
      ['REFUNDING', /reembolso em processamento/i],
      ['REFUNDED', /reembolsado/i],
      ['FAILED', /pagamento recusado/i],
    ])('mostra o badge de %s', (status, label) => {
      renderActions(booking({ paymentStatus: status }));

      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('reserva sem Payment (presencial ou PIX ainda não gerado) não quebra e é identificada', () => {
      renderActions(booking({ paymentStatus: null }));

      expect(screen.getByText(/sem pagamento online/i)).toBeInTheDocument();
    });

    it('BLOCK e MAINTENANCE não mostram pagamento nem cancelamento', () => {
      const { container, rerender } = renderActions(booking({ type: 'BLOCK', reason: 'Evento' }));
      expect(container).toBeEmptyDOMElement();

      rerender(
        <AdminBookingActions
          booking={booking({ type: 'MAINTENANCE' })}
          arenaId="arena-1"
          timezone="America/Sao_Paulo"
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('botão "Cancelar reserva"', () => {
    it('aparece para reserva de cliente CONFIRMED que ainda não começou', () => {
      renderActions(booking());

      expect(screen.getByRole('button', { name: 'Cancelar reserva' })).toBeInTheDocument();
    });

    it('não aparece para reserva que já começou nem para reserva já CANCELLED', () => {
      const { rerender } = renderActions(booking({ startsAt: isoInHours(-1) }));
      expect(screen.queryByRole('button', { name: 'Cancelar reserva' })).not.toBeInTheDocument();

      rerender(
        <AdminBookingActions
          booking={booking({ status: 'CANCELLED' })}
          arenaId="arena-1"
          timezone="America/Sao_Paulo"
        />,
      );
      expect(screen.queryByRole('button', { name: 'Cancelar reserva' })).not.toBeInTheDocument();
    });

    it('exige confirmação: o primeiro clique só abre o dialog, avisando que é irreversível', async () => {
      renderActions(booking());

      fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));

      expect(mutateAsync).not.toHaveBeenCalled();
      expect(await screen.findByText(/não pode ser desfeita/i)).toBeInTheDocument();
      expect(screen.getByText(/o horário será liberado/i)).toBeInTheDocument();
    });

    it('reserva paga: o dialog avisa do reembolso integral; sem pagamento, não fala de reembolso', async () => {
      const paid = renderActions(booking({ paymentStatus: 'PAID' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));
      expect(await screen.findByText(/reembolsado integralmente/i)).toBeInTheDocument();
      paid.unmount();

      renderActions(booking({ paymentStatus: 'PENDING' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));
      await screen.findByText(/não pode ser desfeita/i);
      expect(screen.queryByText(/reembolsado/i)).not.toBeInTheDocument();
    });

    it('confirmar chama o endpoint existente com arena/quadra/reserva corretas e avisa o pai', async () => {
      mutateAsync.mockResolvedValue({});
      const onCancelled = jest.fn();
      const item = booking({ paymentStatus: 'PAID' });
      renderActions(item, onCancelled);

      await confirmCancel();

      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith({
          arenaId: 'arena-1',
          courtId: 'court-1',
          bookingId: 'booking-1',
        }),
      );
      expect(mutateAsync).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(item));
      expect(screen.queryByRole('alert', { hidden: true })).not.toBeInTheDocument();
    });

    it('durante o cancelamento o botão fica desabilitado ("Cancelando…") — sem dupla submissão', () => {
      mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: true });
      renderActions(booking());

      const button = screen.getByRole('button', { name: 'Cancelando…' });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(mutateAsync).not.toHaveBeenCalled();
    });
  });

  describe('erros do cancelamento', () => {
    it.each<[string, unknown, RegExp]>([
      ['401', new ApiError(401, 'Unauthorized'), /sessão expirou/i],
      ['403', new ApiError(403, 'Forbidden'), /não tem permissão/i],
      ['404', new ApiError(404, 'Reserva não encontrada.'), /não encontrada/i],
      [
        '400 (reserva já começou)',
        new ApiError(400, 'Não é possível cancelar uma reserva que já começou.'),
        /já começou/i,
      ],
      ['409 (estado já alterado)', new ApiError(409, 'Reserva já alterada.'), /já alterada/i],
      ['500', new ApiError(500, 'boom'), /tente novamente em instantes/i],
      ['erro de rede', new TypeError('Failed to fetch'), /verifique sua conexão/i],
    ])('%s mostra mensagem compreensível e não avisa o pai', async (_label, error, message) => {
      mutateAsync.mockRejectedValue(error);
      const onCancelled = jest.fn();
      renderActions(booking(), onCancelled);

      await confirmCancel();

      expect(await screen.findByRole('alert', { hidden: true })).toHaveTextContent(message);
      expect(onCancelled).not.toHaveBeenCalled();
    });

    it('permite tentar de novo depois de um erro e limpa a mensagem no sucesso', async () => {
      mutateAsync.mockRejectedValueOnce(new ApiError(500, 'boom')).mockResolvedValueOnce({});
      renderActions(booking());

      await confirmCancel();
      expect(await screen.findByRole('alert', { hidden: true })).toBeInTheDocument();
      // Espera o dialog anterior fechar por completo antes de reabri-lo.
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Sim, cancelar reserva', hidden: true }),
        ).not.toBeInTheDocument(),
      );

      await confirmCancel();
      await waitFor(() =>
        expect(screen.queryByRole('alert', { hidden: true })).not.toBeInTheDocument(),
      );
      expect(mutateAsync).toHaveBeenCalledTimes(2);
    });
  });
});
