import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useMyBooking } from '@/hooks/useMyBookings';
import { usePayment } from '@/hooks/usePayment';
import { useCancelBooking } from '@/hooks/useCancelBooking';
import { ApiError, ApiNetworkError } from '@/api/client';
import ReservaDetalheScreen from './[bookingId]';

jest.mock('@/lib/env', () => ({
  env: { apiUrl: 'https://api.example.test/v1', clerkPublishableKey: 'pk_test_x' },
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/useMyBookings', () => ({ useMyBooking: jest.fn() }));
jest.mock('@/hooks/usePayment', () => ({ usePayment: jest.fn() }));
jest.mock('@/hooks/useCancelBooking', () => ({ useCancelBooking: jest.fn() }));

const mockedUseLocalSearchParams = useLocalSearchParams as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;
const mockedUseMyBooking = useMyBooking as jest.Mock;
const mockedUsePayment = usePayment as jest.Mock;
const mockedUseCancelBooking = useCancelBooking as jest.Mock;

const futureBooking = {
  id: 'booking-1',
  status: 'CONFIRMED',
  startsAt: '2099-09-07T13:00:00.000Z',
  endsAt: '2099-09-07T14:00:00.000Z',
  total: '100',
  court: {
    id: 'court-1',
    name: 'Quadra 1',
    sport: 'BEACH_VOLLEYBALL',
    arena: { id: 'arena-1', name: 'Arena Central', slug: 'arena-central', timezone: 'America/Sao_Paulo', paymentMode: 'ONLINE' },
  },
};

const pastBooking = { ...futureBooking, startsAt: '2020-01-01T13:00:00.000Z', endsAt: '2020-01-01T14:00:00.000Z' };
const inPersonBooking = {
  ...futureBooking,
  court: { ...futureBooking.court, arena: { ...futureBooking.court.arena, paymentMode: 'IN_PERSON' } },
};
const cancelledBooking = { ...futureBooking, status: 'CANCELLED' };

function mockBookingQuery(overrides: Record<string, unknown> = {}) {
  mockedUseMyBooking.mockReturnValue({
    isPending: false,
    isError: false,
    data: futureBooking,
    error: null,
    refetch: jest.fn(),
    ...overrides,
  });
}

function mockPaymentQuery(overrides: Record<string, unknown> = {}) {
  mockedUsePayment.mockReturnValue({ isPending: false, data: undefined, ...overrides });
}

function mockCancelMutation(overrides: Record<string, unknown> = {}) {
  const mutateAsync = jest.fn().mockResolvedValue({ id: 'booking-1', status: 'CANCELLED' });
  mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: false, ...overrides });
  return mutateAsync;
}

describe('Detalhe de "minha reserva" (M5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseLocalSearchParams.mockReturnValue({ bookingId: 'booking-1' });
    mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true });
    mockBookingQuery();
    mockPaymentQuery();
    mockCancelMutation();
  });

  it('sessão carregando: mostra estado de carregamento da sessão', async () => {
    mockedUseAuth.mockReturnValue({ isLoaded: false, isSignedIn: undefined });

    await render(<ReservaDetalheScreen />);

    expect(screen.getByText('Carregando sessão…')).toBeTruthy();
  });

  it('deslogado: redireciona para o login preservando o bookingId no redirect', async () => {
    mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false });

    await render(<ReservaDetalheScreen />);

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/(auth)/sign-in?redirect=${encodeURIComponent('/reservas/booking-1')}`,
      ),
    );
  });

  it('carregando reserva: mostra estado de carregamento', async () => {
    mockBookingQuery({ isPending: true, data: undefined });

    await render(<ReservaDetalheScreen />);

    expect(screen.getByText('Carregando reserva…')).toBeTruthy();
  });

  it('bookingId inexistente (404): mostra "Reserva não encontrada." sem oferecer retry, e nunca renderiza dados de reserva', async () => {
    mockBookingQuery({ isError: true, data: undefined, error: new ApiError(404, 'Reserva não encontrada.') });

    await render(<ReservaDetalheScreen />);

    expect(screen.getByText('Reserva não encontrada.')).toBeTruthy();
    expect(screen.queryByTestId('error-retry')).toBeNull();
    expect(screen.queryByText('Arena Central')).toBeNull();
  });

  it('segurança: reserva de outro usuário chega como 404 (nunca como dado real) — a tela nunca distingue de "não existe"', async () => {
    // IDOR: o backend nunca devolve 403 nem os dados de uma reserva alheia —
    // do ponto de vista do cliente, "de outro usuário" e "não existe" são o
    // mesmo 404 (my-bookings.controller.ts / findMyBookingDetail).
    mockBookingQuery({ isError: true, data: undefined, error: new ApiError(404, 'Reserva não encontrada.') });

    await render(<ReservaDetalheScreen />);

    expect(screen.getByText('Reserva não encontrada.')).toBeTruthy();
    expect(screen.queryByTestId('cancel-booking')).toBeNull();
    expect(screen.queryByTestId('go-to-payment')).toBeNull();
  });

  it('erro genérico (5xx/rede): mostra retry que refaz a consulta', async () => {
    const refetch = jest.fn();
    mockBookingQuery({ isError: true, data: undefined, error: new ApiError(500, 'Erro 500'), refetch });

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('error-retry'));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('sessão expira durante a consulta (401): redireciona para o login', async () => {
    mockBookingQuery({ isError: true, data: undefined, error: new ApiError(401, 'Não autenticado.') });

    await render(<ReservaDetalheScreen />);

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/(auth)/sign-in?redirect=${encodeURIComponent('/reservas/booking-1')}`,
      ),
    );
  });

  it('sucesso: renderiza arena, quadra, data/horário, total e status', async () => {
    await render(<ReservaDetalheScreen />);

    expect(screen.getByText('Arena Central')).toBeTruthy();
    expect(screen.getByText('Quadra 1')).toBeTruthy();
    expect(screen.getByText('Confirmada')).toBeTruthy();
    expect(screen.getByText('R$ 100,00')).toBeTruthy();
  });

  it('arena IN_PERSON: mostra o aviso de pagamento presencial, nunca chama nem exibe nada de PIX', async () => {
    mockBookingQuery({ data: inPersonBooking });

    await render(<ReservaDetalheScreen />);

    expect(screen.getByTestId('in-person-notice')).toBeTruthy();
    expect(screen.queryByTestId('go-to-payment')).toBeNull();
    expect(screen.queryByText('Aguardando pagamento')).toBeNull();
  });

  it('arena ONLINE sem pagamento ainda: mostra aviso e botão "Pagar agora" navegando para o fluxo PIX existente da M4', async () => {
    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('go-to-payment'));

    expect(screen.getByText('Esta reserva ainda não foi paga.')).toBeTruthy();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/pagamento/[bookingId]',
      params: {
        bookingId: 'booking-1',
        startsAt: futureBooking.startsAt,
        endsAt: futureBooking.endsAt,
        total: futureBooking.total,
        arenaName: 'Arena Central',
        courtName: 'Quadra 1',
        timezone: 'America/Sao_Paulo',
      },
    });
  });

  it('pagamento PENDING: mostra o badge e o botão "Ver PIX gerado"', async () => {
    mockPaymentQuery({ data: { status: 'PENDING', amount: '100.00' } });

    await render(<ReservaDetalheScreen />);

    expect(screen.getByText('Aguardando pagamento')).toBeTruthy();
    expect(screen.getByText('Ver PIX gerado')).toBeTruthy();
  });

  it('pagamento PAID: mostra o badge "Pago" e nenhum botão de ação de pagamento', async () => {
    mockPaymentQuery({ data: { status: 'PAID', amount: '100.00' } });

    await render(<ReservaDetalheScreen />);

    expect(screen.getByText('Pago')).toBeTruthy();
    expect(screen.queryByTestId('go-to-payment')).toBeNull();
  });

  it('pagamento FAILED: mostra o botão "Tentar pagamento novamente"', async () => {
    mockPaymentQuery({ data: { status: 'FAILED', amount: '100.00' } });

    await render(<ReservaDetalheScreen />);

    expect(screen.getByText('Tentar pagamento novamente')).toBeTruthy();
  });

  it('reserva CONFIRMED e ainda não iniciada: botão de cancelar aparece', async () => {
    await render(<ReservaDetalheScreen />);

    expect(screen.getByTestId('cancel-booking')).toBeTruthy();
  });

  it('reserva já iniciada: botão de cancelar não aparece, mensagem de bloqueio aparece', async () => {
    mockBookingQuery({ data: pastBooking });

    await render(<ReservaDetalheScreen />);

    expect(screen.queryByTestId('cancel-booking')).toBeNull();
    expect(screen.getByText('Esta reserva já começou e não pode mais ser cancelada.')).toBeTruthy();
  });

  it('reserva já cancelada: nenhum botão de cancelar nem mensagem de bloqueio', async () => {
    mockBookingQuery({ data: cancelledBooking });

    await render(<ReservaDetalheScreen />);

    expect(screen.queryByTestId('cancel-booking')).toBeNull();
    expect(screen.queryByText('Esta reserva já começou e não pode mais ser cancelada.')).toBeNull();
  });

  it('confirmação: tocar em "Cancelar reserva" abre o modal, sem cancelar imediatamente', async () => {
    const mutateAsync = mockCancelMutation();

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));

    expect(screen.getByText('Cancelar esta reserva?')).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('confirmação: "Voltar" fecha o modal sem cancelar', async () => {
    const mutateAsync = mockCancelMutation();

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));
    await fireEvent.press(screen.getByTestId('cancel-dialog-dismiss'));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByText('Cancelar esta reserva?')).toBeNull();
  });

  it('confirmação: quando o pagamento está PAID, avisa sobre o reembolso integral', async () => {
    mockPaymentQuery({ data: { status: 'PAID', amount: '100.00' } });

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));

    expect(screen.getByText(/será reembolsado integralmente/)).toBeTruthy();
  });

  it('confirmação: sem pagamento PAID, nunca inventa política de reembolso', async () => {
    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));

    expect(screen.queryByText(/reembolsado/)).toBeNull();
  });

  it('cancelamento bem-sucedido: chama o backend com arenaId/courtId/bookingId reais da reserva, nunca cancela localmente', async () => {
    const mutateAsync = mockCancelMutation();

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));
    await fireEvent.press(screen.getByTestId('cancel-dialog-confirm'));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ arenaId: 'arena-1', courtId: 'court-1', bookingId: 'booking-1' }),
    );
  });

  it('duplo toque: botão de cancelar fica desabilitado enquanto a mutation está em andamento', async () => {
    mockCancelMutation({ isPending: true });

    await render(<ReservaDetalheScreen />);

    expect(screen.getByTestId('cancel-booking').props.accessibilityState.disabled).toBe(true);
  });

  it('erro 403 ao cancelar: mostra mensagem de permissão, nunca considera cancelado', async () => {
    const mutateAsync = jest.fn().mockRejectedValue(new ApiError(403, 'Sem permissão.'));
    mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: false });

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));
    await fireEvent.press(screen.getByTestId('cancel-dialog-confirm'));

    await waitFor(() =>
      expect(screen.getByText('Você não tem permissão para cancelar esta reserva.')).toBeTruthy(),
    );
  });

  it('erro 404 ao cancelar: mostra "Reserva não encontrada."', async () => {
    const mutateAsync = jest.fn().mockRejectedValue(new ApiError(404, 'Não encontrada.'));
    mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: false });

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));
    await fireEvent.press(screen.getByTestId('cancel-dialog-confirm'));

    await waitFor(() => expect(screen.getByText('Reserva não encontrada.')).toBeTruthy());
  });

  it('erro 400 ao cancelar (reserva já começou): mostra a mensagem real do backend', async () => {
    const mutateAsync = jest.fn().mockRejectedValue(new ApiError(400, 'já começou'));
    mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: false });

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));
    await fireEvent.press(screen.getByTestId('cancel-dialog-confirm'));

    await waitFor(() =>
      expect(
        screen.getByText('Esta reserva já começou ou já foi concluída e não pode mais ser cancelada.'),
      ).toBeTruthy(),
    );
  });

  it('erro 429 ao cancelar: mostra mensagem de limite de tentativas', async () => {
    const mutateAsync = jest.fn().mockRejectedValue(new ApiError(429, 'Muitas requisições'));
    mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: false });

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));
    await fireEvent.press(screen.getByTestId('cancel-dialog-confirm'));

    await waitFor(() =>
      expect(
        screen.getByText('Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.'),
      ).toBeTruthy(),
    );
  });

  it('erro 401 ao cancelar: redireciona para o login', async () => {
    const mutateAsync = jest.fn().mockRejectedValue(new ApiError(401, 'Não autenticado.'));
    mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: false });

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));
    await fireEvent.press(screen.getByTestId('cancel-dialog-confirm'));

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/(auth)/sign-in?redirect=${encodeURIComponent('/reservas/booking-1')}`,
      ),
    );
  });

  it('erro de rede/timeout ao cancelar: NUNCA assume sucesso — relê o estado real e avisa o usuário', async () => {
    const refetch = jest.fn();
    mockBookingQuery({ refetch });
    const mutateAsync = jest.fn().mockRejectedValue(new ApiNetworkError());
    mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: false });

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));
    await fireEvent.press(screen.getByTestId('cancel-dialog-confirm'));

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText(
        'Não foi possível confirmar o cancelamento. Verifique o status da reserva abaixo antes de tentar de novo.',
      ),
    ).toBeTruthy();
  });

  it('erro 5xx ao cancelar: mesmo tratamento de "nunca assume sucesso" da rede/timeout', async () => {
    const refetch = jest.fn();
    mockBookingQuery({ refetch });
    const mutateAsync = jest.fn().mockRejectedValue(new ApiError(503, 'Indisponível'));
    mockedUseCancelBooking.mockReturnValue({ mutateAsync, isPending: false });

    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('cancel-booking'));
    await fireEvent.press(screen.getByTestId('cancel-dialog-confirm'));

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });

  it('"Voltar para minhas reservas" navega de volta pra lista', async () => {
    await render(<ReservaDetalheScreen />);
    await fireEvent.press(screen.getByTestId('back-to-my-bookings'));

    expect(router.replace).toHaveBeenCalledWith('/(tabs)/reservas');
  });
});
