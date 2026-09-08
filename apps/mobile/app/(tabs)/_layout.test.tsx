import type { ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import TabsLayout from './_layout';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => {
  // require(), não import — a fábrica do jest.mock roda isolada, antes de
  // qualquer import estático deste arquivo estar disponível.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText } = require('react-native') as typeof import('react-native');
  function Tabs({ children }: { children: ReactNode }) {
    return ReactLib.createElement(ReactLib.Fragment, null, children);
  }
  Tabs.Screen = ({ name, options }: { name: string; options?: { title?: string } }) =>
    ReactLib.createElement(RNText, { testID: `tab-${name}` }, options?.title ?? name);
  return { Tabs };
});

describe('Navegação inferior (Tabs)', () => {
  it('declara as quatro abas principais: Início, Explorar, Reservas, Perfil', async () => {
    const { getByText } = await render(<TabsLayout />);

    expect(getByText('Início')).toBeTruthy();
    expect(getByText('Explorar')).toBeTruthy();
    expect(getByText('Reservas')).toBeTruthy();
    expect(getByText('Perfil')).toBeTruthy();
  });
});
