import { render, screen } from '@testing-library/react';
import ArenasPage from './page';
import { useDiscoverArenas } from '@/hooks/use-api';

jest.mock('@clerk/nextjs', () => ({
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    when === 'signed-in' ? children : null,
  UserButton: () => null,
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/arenas',
}));

jest.mock('../../hooks/use-api', () => ({
  useDiscoverArenas: jest.fn(),
}));

const mockedUseDiscoverArenas = useDiscoverArenas as jest.Mock;

describe('ArenasPage (discovery)', () => {
  it('mostra o estado de carregamento', () => {
    mockedUseDiscoverArenas.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<ArenasPage />);

    expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('mostra o estado de erro', () => {
    mockedUseDiscoverArenas.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<ArenasPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível carregar/i);
  });

  it('mostra o estado vazio quando não há arenas', () => {
    mockedUseDiscoverArenas.mockReturnValue({ data: [], isPending: false, isError: false });
    render(<ArenasPage />);

    expect(screen.getByText(/nenhuma arena disponível/i)).toBeInTheDocument();
  });

  it('lista as arenas retornadas', () => {
    mockedUseDiscoverArenas.mockReturnValue({
      data: [
        {
          id: 'arena-1',
          name: 'Arena Central',
          slug: 'arena-central',
          description: null,
          sports: ['BEACH_VOLLEYBALL'],
        },
      ],
      isPending: false,
      isError: false,
    });
    render(<ArenasPage />);

    // Fase 32 — URL pública canônica usa o slug da arena, nunca o id técnico.
    expect(screen.getByRole('link', { name: /Arena Central/ })).toHaveAttribute(
      'href',
      '/arenas/arena-central',
    );
  });
});
