import { render, screen, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useDiscoverArenas } from '@/hooks/useArenas';
import ExplorarScreen from './explorar';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/hooks/useArenas', () => ({ useDiscoverArenas: jest.fn() }));

const mockedUseDiscoverArenas = useDiscoverArenas as jest.Mock;

const arena = {
  id: 'arena-1',
  name: 'Arena Central',
  slug: 'arena-central',
  description: 'Quadras de vôlei de praia no centro.',
  sports: ['BEACH_VOLLEYBALL'],
  isReady: true,
};

describe('Explorar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loading: mostra o estado de carregamento', async () => {
    mockedUseDiscoverArenas.mockReturnValue({ isPending: true, isError: false, data: undefined });

    await render(<ExplorarScreen />);

    expect(screen.getByText('Carregando arenas…')).toBeTruthy();
  });

  it('sucesso: mostra as arenas reais retornadas pela API', async () => {
    mockedUseDiscoverArenas.mockReturnValue({ isPending: false, isError: false, data: [arena] });

    await render(<ExplorarScreen />);

    expect(screen.getByText('Arena Central')).toBeTruthy();
    expect(screen.getByText('Quadras de vôlei de praia no centro.')).toBeTruthy();
    expect(screen.getByText('Vôlei de praia')).toBeTruthy();
  });

  it('estado vazio: mostra a mensagem de nenhuma arena disponível', async () => {
    mockedUseDiscoverArenas.mockReturnValue({ isPending: false, isError: false, data: [] });

    await render(<ExplorarScreen />);

    expect(screen.getByText('Nenhuma arena disponível no momento.')).toBeTruthy();
  });

  it('erro: mostra a mensagem de erro com botão de tentar novamente', async () => {
    const refetch = jest.fn();
    mockedUseDiscoverArenas.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch });

    await render(<ExplorarScreen />);
    await fireEvent.press(screen.getByTestId('error-retry'));

    expect(screen.getByText('Não foi possível carregar as arenas.')).toBeTruthy();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('tocar numa arena navega pra tela de detalhe pelo slug', async () => {
    mockedUseDiscoverArenas.mockReturnValue({ isPending: false, isError: false, data: [arena] });

    await render(<ExplorarScreen />);
    await fireEvent.press(screen.getByTestId('arena-item-arena-central'));

    expect(router.push).toHaveBeenCalledWith('/arena/arena-central');
  });
});
