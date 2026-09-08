import { render, screen, fireEvent } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import ReservaConfirmadaScreen from './[bookingId]';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockedUseLocalSearchParams = useLocalSearchParams as jest.Mock;

const baseParams = {
  bookingId: 'booking-1',
  status: 'CONFIRMED',
  startsAt: '2026-09-07T13:00:00.000Z',
  endsAt: '2026-09-07T14:00:00.000Z',
  total: '100',
  count: '1',
  arenaName: 'Arena Central',
  courtName: 'Quadra 1',
  timezone: 'America/Sao_Paulo',
};

describe('Reserva confirmada (M3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseLocalSearchParams.mockReturnValue(baseParams);
  });

  it('mostra exatamente os dados devolvidos pelo backend — arena, quadra, horário, status, total, id', async () => {
    await render(<ReservaConfirmadaScreen />);

    expect(screen.getByText('Reserva realizada!')).toBeTruthy();
    expect(screen.getByText('Arena Central')).toBeTruthy();
    expect(screen.getByText('Quadra 1')).toBeTruthy();
    expect(screen.getByText('10:00–11:00')).toBeTruthy();
    expect(screen.getByText('Confirmada')).toBeTruthy();
    expect(screen.getByText('R$ 100,00')).toBeTruthy();
    expect(screen.getByText('Reserva booking-1')).toBeTruthy();
  });

  it('avisa quando mais de uma reserva foi criada pela mesma seleção (horários não consecutivos)', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ ...baseParams, count: '2' });

    await render(<ReservaConfirmadaScreen />);

    expect(screen.getByText(/\+ 1 outra reserva criada/)).toBeTruthy();
  });

  it('"Ver minhas reservas" navega pra aba Reservas', async () => {
    await render(<ReservaConfirmadaScreen />);

    await fireEvent.press(screen.getByTestId('see-my-bookings'));

    expect(router.replace).toHaveBeenCalledWith('/(tabs)/reservas');
  });

  it('nunca oferece nenhuma ação de pagamento online — M4 trata isso', async () => {
    await render(<ReservaConfirmadaScreen />);

    expect(screen.queryByText(/gerar pix/i)).toBeNull();
    expect(screen.queryByText(/copia e cola/i)).toBeNull();
    expect(screen.queryByText(/mercado pago/i)).toBeNull();
  });

  // M4, item 7/21 — esta tela só é alcançada quando arena.paymentMode ===
  // 'IN_PERSON' (ONLINE vai pra /pagamento/[bookingId]); o aviso só aparece
  // quando o parâmetro correspondente está presente.
  describe('paymentMode IN_PERSON (M4)', () => {
    it('mostra o aviso de pagamento presencial', async () => {
      mockedUseLocalSearchParams.mockReturnValue({ ...baseParams, paymentMode: 'IN_PERSON' });

      await render(<ReservaConfirmadaScreen />);

      expect(screen.getByTestId('in-person-notice')).toHaveTextContent(
        'O pagamento será realizado presencialmente na arena.',
      );
    });
  });

  it('sem paymentMode (fluxo padrão), nenhum aviso presencial aparece', async () => {
    await render(<ReservaConfirmadaScreen />);

    expect(screen.queryByTestId('in-person-notice')).toBeNull();
  });
});
