import { render, screen, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useDiscoverArena } from '@/hooks/useArenas';
import ArenaDetailScreen from './index';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ slug: 'arena-central' }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/hooks/useArenas', () => ({ useDiscoverArena: jest.fn() }));

const mockedUseDiscoverArena = useDiscoverArena as jest.Mock;

const arena = {
  id: 'arena-1',
  name: 'Arena Central',
  slug: 'arena-central',
  description: 'A melhor arena da cidade.',
  phone: '11999999999',
  email: 'contato@arenacentral.com',
  timezone: 'America/Sao_Paulo',
  isReady: true,
  courts: [
    {
      id: 'court-1',
      name: 'Quadra 1',
      sport: 'BEACH_VOLLEYBALL',
      description: null,
      pricePerSlot: '100',
      slotDurationMinutes: 60,
      bufferMinutes: 0,
      imageUrl: null,
    },
  ],
};

describe('Arena — detalhe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loading: mostra o estado de carregamento', async () => {
    mockedUseDiscoverArena.mockReturnValue({ isPending: true, isError: false, data: undefined });

    await render(<ArenaDetailScreen />);

    expect(screen.getByText('Carregando arena…')).toBeTruthy();
  });

  it('renderiza os dados públicos da arena (descrição, telefone, email)', async () => {
    mockedUseDiscoverArena.mockReturnValue({ isPending: false, isError: false, data: arena });

    await render(<ArenaDetailScreen />);

    expect(screen.getByText('A melhor arena da cidade.')).toBeTruthy();
    expect(screen.getByText('11999999999')).toBeTruthy();
    expect(screen.getByText('contato@arenacentral.com')).toBeTruthy();
  });

  it('mostra as quadras da arena, vindas da mesma resposta (sem chamada extra)', async () => {
    mockedUseDiscoverArena.mockReturnValue({ isPending: false, isError: false, data: arena });

    await render(<ArenaDetailScreen />);

    expect(screen.getByText('Quadra 1')).toBeTruthy();
    expect(screen.getByText('R$ 100,00')).toBeTruthy();
  });

  it('nunca mostra campos ausentes (telefone/email nulos)', async () => {
    mockedUseDiscoverArena.mockReturnValue({
      isPending: false,
      isError: false,
      data: { ...arena, phone: null, email: null },
    });

    await render(<ArenaDetailScreen />);

    expect(screen.queryByText('11999999999')).toBeNull();
    expect(screen.queryByText('contato@arenacentral.com')).toBeNull();
  });

  it('selecionar uma quadra navega pra tela de disponibilidade dessa quadra', async () => {
    mockedUseDiscoverArena.mockReturnValue({ isPending: false, isError: false, data: arena });

    await render(<ArenaDetailScreen />);
    await fireEvent.press(screen.getByTestId('court-item-court-1'));

    expect(router.push).toHaveBeenCalledWith('/arena/arena-central/court-1');
  });
});
