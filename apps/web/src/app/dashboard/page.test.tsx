import { render, screen } from '@testing-library/react';
import DashboardEntryPage from './page';
import { useMyAdminArenas } from '../../hooks/use-api';

const push = jest.fn();
const replace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}));

jest.mock('@clerk/nextjs', () => ({
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    when === 'signed-in' ? children : null,
}));

jest.mock('../../hooks/use-api', () => ({
  useMyAdminArenas: jest.fn(),
}));

const mockedUseMyAdminArenas = useMyAdminArenas as jest.Mock;

describe('DashboardEntryPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mostra o estado de carregamento', () => {
    mockedUseMyAdminArenas.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<DashboardEntryPage />);

    expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('usuário sem nenhuma arena administrada vê estado vazio (não erro)', () => {
    mockedUseMyAdminArenas.mockReturnValue({ data: [], isPending: false, isError: false });
    render(<DashboardEntryPage />);

    expect(screen.getByText(/não administra nenhuma arena/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('administrador de uma única arena é redirecionado direto para o dashboard dela', () => {
    mockedUseMyAdminArenas.mockReturnValue({
      data: [{ id: 'arena-1', name: 'Arena Central', slug: 'a', role: 'OWNER', timezone: 'America/Sao_Paulo' }],
      isPending: false,
      isError: false,
    });
    render(<DashboardEntryPage />);

    expect(replace).toHaveBeenCalledWith('/dashboard/arena-1');
  });

  it('administrador de várias arenas vê a lista para escolher', () => {
    mockedUseMyAdminArenas.mockReturnValue({
      data: [
        { id: 'arena-1', name: 'Arena Central', slug: 'a', role: 'OWNER', timezone: 'America/Sao_Paulo' },
        { id: 'arena-2', name: 'Arena Norte', slug: 'b', role: 'ADMIN', timezone: 'America/Sao_Paulo' },
      ],
      isPending: false,
      isError: false,
    });
    render(<DashboardEntryPage />);

    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Arena Central/ })).toHaveAttribute(
      'href',
      '/dashboard/arena-1',
    );
    expect(screen.getByRole('link', { name: /Arena Norte/ })).toHaveAttribute(
      'href',
      '/dashboard/arena-2',
    );
  });

  it('mostra o estado de erro', () => {
    mockedUseMyAdminArenas.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<DashboardEntryPage />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
