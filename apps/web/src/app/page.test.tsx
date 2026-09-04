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
  // Fase de Branding — a wordmark de texto "ArenaHub" no header virou a
  // logo oficial da Siviero (`SiteBrand`); o produto continua identificado
  // pelo `aria-label="ArenaHub"` no wrapper (acessibilidade) e pelo
  // heading de valor logo abaixo, nunca removido.
  it('renders the Siviero brand mark (ArenaHub via aria-label) and the value-proposition heading', () => {
    render(<Home />);

    expect(screen.getByLabelText('ArenaHub')).toBeInTheDocument();
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

  // Fase 35 — visitante sem conta precisa de um caminho clicável até a
  // descoberta pública (Fases 29/32/33 já tornaram /arenas acessível sem
  // login; só faltava um link até lá a partir da home).
  it('shows a link to /arenas for a signed-out visitor, without requiring an account', () => {
    render(<Home />);

    expect(screen.getByRole('link', { name: 'Explorar arenas' })).toHaveAttribute(
      'href',
      '/arenas',
    );
  });
});
