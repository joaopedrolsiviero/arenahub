import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSignIn } from '@clerk/clerk-expo';
import SignInScreen from './sign-in';

jest.mock('expo-router', () => {
  // require(), não import — a fábrica do jest.mock roda isolada (mesma
  // justificativa já usada nos mocks equivalentes de app/_layout.test.tsx).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText } = require('react-native') as typeof import('react-native');
  return {
    router: { replace: jest.fn() },
    // Mesma justificativa de app/(tabs)/_layout.test.tsx: <Link> aqui só
    // precisa renderizar seu texto — Text real, nunca uma string crua
    // solta (React Native não aceita texto fora de <Text>).
    Link: ({ children }: { children: React.ReactNode }) =>
      ReactLib.createElement(RNText, null, children),
    useLocalSearchParams: jest.fn(),
  };
});
jest.mock('@clerk/clerk-expo', () => ({ useSignIn: jest.fn() }));

const mockedUseLocalSearchParams = useLocalSearchParams as jest.Mock;
const mockedUseSignIn = useSignIn as jest.Mock;

describe('Sign in — retorno pra onde o usuário veio (M3)', () => {
  let create: jest.Mock;
  let setActive: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    create = jest.fn().mockResolvedValue({ status: 'complete', createdSessionId: 'sess-1' });
    setActive = jest.fn().mockResolvedValue(undefined);
    mockedUseSignIn.mockReturnValue({ signIn: { create }, setActive, isLoaded: true });
  });

  it('sem redirect: login bem-sucedido volta pra Início', async () => {
    mockedUseLocalSearchParams.mockReturnValue({});
    await render(<SignInScreen />);

    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'cliente@example.com');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'senha123');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(tabs)'));
  });

  it('com redirect: login bem-sucedido volta exatamente pra rota (e seleção) de onde veio', async () => {
    const redirectTarget = '/arena/arena-central/court-1?date=2026-09-07&slots=2026-09-07T13%3A00%3A00.000Z';
    mockedUseLocalSearchParams.mockReturnValue({ redirect: encodeURIComponent(redirectTarget) });
    await render(<SignInScreen />);

    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'cliente@example.com');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'senha123');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(redirectTarget));
  });

  it('nenhuma reserva é criada por este fluxo — só sessão', async () => {
    mockedUseLocalSearchParams.mockReturnValue({});
    await render(<SignInScreen />);

    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'cliente@example.com');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'senha123');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));

    await waitFor(() => expect(setActive).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
  });
});
