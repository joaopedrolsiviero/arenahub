import { render, screen, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useMyBookings } from '@/hooks/useMyBookings';
import { useMyPaymentStatuses } from '@/hooks/usePayment';
import ReservasScreen from './reservas';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/useMyBookings', () => ({ useMyBookings: jest.fn() }));
jest.mock('@/hooks/usePayment', () => ({ useMyPaymentStatuses: jest.fn() }));

const mockedUseAuth = useAuth as jest.Mock;
const mockedUseMyBookings = useMyBookings as jest.Mock;
const mockedUseMyPaymentStatuses = useMyPaymentStatuses as jest.Mock;

const onlineBooking = {
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

const inPersonBooking = {
  id: 'booking-2',
  status: 'CONFIRMED',
  startsAt: '2099-09-08T13:00:00.000Z',
  endsAt: '2099-09-08T14:00:00.000Z',
  total: '80',
  court: {
    id: 'court-2',
    name: 'Quadra 2',
    sport: 'BEACH_VOLLEYBALL',
    arena: { id: 'arena-2', name: 'Arena Sul', slug: 'arena-sul', timezone: 'America/Sao_Paulo', paymentMode: 'IN_PERSON' },
  },
};

const pastBooking = {
  ...onlineBooking,
  id: 'booking-3',
  startsAt: '2020-01-01T13:00:00.000Z',
  endsAt: '2020-01-01T14:00:00.000Z',
};

const cancelledBooking = { ...onlineBooking, id: 'booking-4', status: 'CANCELLED' };

function mockBookings(data: unknown[] | undefined, overrides: Record<string, unknown> = {}) {
  mockedUseMyBookings.mockReturnValue({
    isPending: false,
    isError: false,
    data,
    refetch: jest.fn(),
    ...overrides,
  });
}

describe('Minhas reservas — lista', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true });
    mockedUseMyPaymentStatuses.mockReturnValue({ data: {} });
  });

  it('sessão carregando: mostra estado de carregamento da sessão', async () => {
    mockedUseAuth.mockReturnValue({ isLoaded: false, isSignedIn: undefined });
    mockBookings(undefined);

    await render(<ReservasScreen />);

    expect(screen.getByText('Carregando sessão…')).toBeTruthy();
  });

  it('deslogado: mostra CTA para entrar, preservando o padrão de auth do M1-M4', async () => {
    mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false });
    mockBookings(undefined);

    await render(<ReservasScreen />);
    await fireEvent.press(screen.getByTestId('bookings-sign-in'));

    expect(screen.getByText('Entre na sua conta para ver suas reservas.')).toBeTruthy();
    expect(router.push).toHaveBeenCalledWith(
      `/(auth)/sign-in?redirect=${encodeURIComponent('/(tabs)/reservas')}`,
    );
  });

  it('deslogado: nunca dispara as consultas de reservas/pagamentos', async () => {
    mockedUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false });
    mockBookings(undefined);

    await render(<ReservasScreen />);

    expect(mockedUseMyBookings).toHaveBeenCalledWith(false);
  });

  it('loading: mostra o estado de carregamento das reservas', async () => {
    mockBookings(undefined, { isPending: true });

    await render(<ReservasScreen />);

    expect(screen.getByText('Carregando reservas…')).toBeTruthy();
  });

  it('erro: mostra mensagem de erro com botão de tentar novamente', async () => {
    const refetch = jest.fn();
    mockBookings(undefined, { isError: true, refetch });

    await render(<ReservasScreen />);
    await fireEvent.press(screen.getByTestId('error-retry'));

    expect(screen.getByText('Não foi possível carregar suas reservas.')).toBeTruthy();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('empty: mostra o estado vazio com CTA para explorar arenas', async () => {
    mockBookings([]);

    await render(<ReservasScreen />);
    await fireEvent.press(screen.getByTestId('empty-state-action'));

    expect(screen.getByText('Você ainda não tem nenhuma reserva.')).toBeTruthy();
    expect(router.push).toHaveBeenCalledWith('/(tabs)/explorar');
  });

  it('sucesso: renderiza arena, quadra, data/horário, total e status de cada reserva', async () => {
    mockBookings([onlineBooking]);

    await render(<ReservasScreen />);

    expect(screen.getByText('Arena Central')).toBeTruthy();
    expect(screen.getByText('Quadra 1')).toBeTruthy();
    expect(screen.getByText('Confirmada')).toBeTruthy();
    expect(screen.getByText('R$ 100,00')).toBeTruthy();
  });

  it('mostra o badge de status de pagamento só para reservas de arena ONLINE, nunca para IN_PERSON', async () => {
    mockedUseMyPaymentStatuses.mockReturnValue({ data: { 'booking-1': 'PENDING', 'booking-2': 'PAID' } });
    mockBookings([onlineBooking, inPersonBooking]);

    await render(<ReservasScreen />);

    expect(screen.getByText('Aguardando pagamento')).toBeTruthy();
    expect(screen.queryByText('Pago')).toBeNull();
  });

  it('sem N+1: o mapa de status de pagamento é consultado uma única vez, não por item da lista', async () => {
    mockBookings([onlineBooking, pastBooking, cancelledBooking]);

    await render(<ReservasScreen />);

    expect(mockedUseMyPaymentStatuses).toHaveBeenCalledTimes(1);
  });

  it('abas: "Próximas" é a aba padrão e mostra só reservas futuras confirmadas', async () => {
    mockBookings([onlineBooking, pastBooking, cancelledBooking]);

    await render(<ReservasScreen />);

    expect(screen.getByTestId('booking-item-booking-1')).toBeTruthy();
    expect(screen.queryByTestId('booking-item-booking-3')).toBeNull();
    expect(screen.queryByTestId('booking-item-booking-4')).toBeNull();
  });

  it('abas: trocar para "Histórico" mostra reservas passadas', async () => {
    mockBookings([onlineBooking, pastBooking, cancelledBooking]);

    await render(<ReservasScreen />);
    await fireEvent.press(screen.getByTestId('bookings-tab-past'));

    expect(screen.getByTestId('booking-item-booking-3')).toBeTruthy();
    expect(screen.queryByTestId('booking-item-booking-1')).toBeNull();
  });

  it('abas: trocar para "Canceladas" mostra reservas canceladas', async () => {
    mockBookings([onlineBooking, pastBooking, cancelledBooking]);

    await render(<ReservasScreen />);
    await fireEvent.press(screen.getByTestId('bookings-tab-cancelled'));

    expect(screen.getByTestId('booking-item-booking-4')).toBeTruthy();
  });

  it('abas: aba vazia mostra a mensagem de vazio específica, sem CTA de explorar', async () => {
    mockBookings([onlineBooking]);

    await render(<ReservasScreen />);
    await fireEvent.press(screen.getByTestId('bookings-tab-cancelled'));

    expect(screen.getByText('Nenhuma reserva cancelada.')).toBeTruthy();
    expect(screen.queryByTestId('empty-state-action')).toBeNull();
  });

  it('tocar numa reserva navega pro detalhe pelo bookingId', async () => {
    mockBookings([onlineBooking]);

    await render(<ReservasScreen />);
    await fireEvent.press(screen.getByTestId('booking-item-booking-1'));

    expect(router.push).toHaveBeenCalledWith('/reservas/booking-1');
  });
});
