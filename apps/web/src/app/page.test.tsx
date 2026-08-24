import { render, screen } from '@testing-library/react';

import Home from './page';

// Smoke test: não precisa de uma sessão Clerk real, só confirma que a
// página renderiza o estado "deslogado" (o padrão para um visitante novo).
// CurrentUserCard (que chama a API) só monta dentro de <Show when="signed-in">,
// então nem precisa ser mockado aqui.
jest.mock('@clerk/nextjs', () => ({
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    when === 'signed-out' ? children : null,
  UserButton: () => null,
}));

describe('Home', () => {
  it('renders the ArenaHub wordmark and the value-proposition heading', () => {
    render(<Home />);

    expect(screen.getByText('ArenaHub')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Reserve sua quadra em segundos.' }),
    ).toBeInTheDocument();
  });

  it('shows sign-in/sign-up actions when signed out', () => {
    render(<Home />);

    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/sign-in');
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });
});
