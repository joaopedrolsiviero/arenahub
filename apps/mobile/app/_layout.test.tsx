import type { ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import { usePushNotificationsSetup } from '@/hooks/usePushNotifications';
import RootLayout from './_layout';

jest.mock('@/lib/env', () => ({
  env: { apiUrl: 'https://api.example.test/v1', clerkPublishableKey: 'pk_test_x' },
}));
jest.mock('@clerk/clerk-expo', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  ClerkLoaded: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
// M7 — a orquestração de push (registro de token, listeners de deep link)
// já tem sua própria suíte dedicada (usePushNotifications.test.tsx); aqui
// importa só confirmar que a árvore de rotas monta sem lançar com o
// bootstrap presente, nunca reexercitar a lógica interna do hook.
jest.mock('@/hooks/usePushNotifications', () => ({ usePushNotificationsSetup: jest.fn() }));
jest.mock('expo-router', () => {
  // require(), não import — mesma justificativa do mock equivalente em
  // app/(tabs)/_layout.test.tsx.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText } = require('react-native') as typeof import('react-native');
  function Stack({ children }: { children: ReactNode }) {
    return ReactLib.createElement(ReactLib.Fragment, null, children);
  }
  Stack.Screen = ({ name }: { name: string }) =>
    ReactLib.createElement(RNText, { testID: `route-${name}` }, name);
  return { Stack };
});

describe('App root (_layout)', () => {
  it('renderiza sem lançar, com Clerk e TanStack Query montados', async () => {
    await expect(render(<RootLayout />)).resolves.toBeTruthy();
  });

  it('declara os seis grupos de navegação de nível raiz: (tabs), (auth), arena, reserva-confirmada, pagamento e reservas', async () => {
    const { getByTestId } = await render(<RootLayout />);

    expect(getByTestId('route-(tabs)')).toBeTruthy();
    expect(getByTestId('route-(auth)')).toBeTruthy();
    expect(getByTestId('route-arena')).toBeTruthy();
    expect(getByTestId('route-reserva-confirmada')).toBeTruthy();
    expect(getByTestId('route-pagamento')).toBeTruthy();
    expect(getByTestId('route-reservas')).toBeTruthy();
  });

  it('M7 — monta o bootstrap de notificações push (usePushNotificationsSetup é chamado)', async () => {
    await render(<RootLayout />);

    expect(usePushNotificationsSetup).toHaveBeenCalled();
  });
});
