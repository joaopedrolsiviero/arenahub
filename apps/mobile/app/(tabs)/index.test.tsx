import { render, screen, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import HomeScreen from './index';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  Link: 'Link',
}));

describe('Home (Início)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mostra o título de valor do produto', async () => {
    await render(<HomeScreen />);

    expect(screen.getByText('Reserve sua quadra em segundos.')).toBeTruthy();
  });

  it('mostra o botão "Explorar arenas"', async () => {
    await render(<HomeScreen />);

    expect(screen.getByTestId('home-explore-button')).toBeTruthy();
  });

  it('pressionar "Explorar arenas" navega pra aba Explorar', async () => {
    await render(<HomeScreen />);

    await fireEvent.press(screen.getByTestId('home-explore-button'));

    expect(router.push).toHaveBeenCalledWith('/(tabs)/explorar');
  });
});
