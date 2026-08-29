import { render, screen } from '@testing-library/react';
import { DashboardOverview } from './page';
import { useArena, useDashboard, useMyAdminArenas } from '../../../hooks/use-api';
import { ApiError } from '../../../lib/api';
import type { DashboardResponse } from '../../../lib/types';

const push = jest.fn();
const replace = jest.fn();
let searchParamsValue = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParamsValue,
  usePathname: () => '/dashboard/arena-1',
}));

jest.mock('../../../hooks/use-api', () => ({
  useDashboard: jest.fn(),
  useMyAdminArenas: jest.fn(),
  useArena: jest.fn(),
}));

const mockedUseDashboard = useDashboard as jest.Mock;
const mockedUseMyAdminArenas = useMyAdminArenas as jest.Mock;
const mockedUseArena = useArena as jest.Mock;

const baseDashboard: DashboardResponse = {
  arena: { id: 'arena-1', name: 'Arena Central', timezone: 'America/Sao_Paulo' },
  date: '2026-08-20',
  operatingHours: [{ id: 'oh-1', dayOfWeek: 'THURSDAY', opensAt: '08:00', closesAt: '22:00' }],
  summary: { confirmedBookings: 2, cancelledBookings: 1, blocks: 1, maintenance: 0 },
  courts: [
    {
      id: 'court-1',
      name: 'Quadra 1',
      sport: 'BEACH_VOLLEYBALL',
      isActive: true,
      occupancy: [
        {
          id: 'b1',
          courtId: 'court-1',
          courtName: 'Quadra 1',
          type: 'CUSTOMER',
          status: 'CONFIRMED',
          startsAt: '2026-08-20T13:00:00.000Z',
          endsAt: '2026-08-20T14:00:00.000Z',
          total: '100',
          reason: null,
          user: { id: 'user-1', name: 'Cliente Teste', email: 'cliente@example.com' },
        },
      ],
    },
    {
      id: 'court-2',
      name: 'Quadra Inativa',
      sport: 'BEACH_VOLLEYBALL',
      isActive: false,
      occupancy: [],
    },
  ],
  upcomingBookings: [
    {
      id: 'b1',
      courtId: 'court-1',
      courtName: 'Quadra 1',
      type: 'CUSTOMER',
      status: 'CONFIRMED',
      startsAt: '2026-08-20T13:00:00.000Z',
      endsAt: '2026-08-20T14:00:00.000Z',
      total: '100',
      reason: null,
      user: { id: 'user-1', name: 'Cliente Teste', email: 'cliente@example.com' },
    },
  ],
};

describe('DashboardOverview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    searchParamsValue = new URLSearchParams({ date: '2026-08-20' });
    mockedUseMyAdminArenas.mockReturnValue({ data: [] });
    mockedUseArena.mockReturnValue({ data: undefined });
  });

  it('mostra o estado de carregamento', () => {
    mockedUseDashboard.mockReturnValue({ isPending: true, isError: false });
    render(<DashboardOverview arenaId="arena-1" />);

    expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('mostra mensagem amigável específica para 403 (sem permissão)', () => {
    mockedUseDashboard.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiError(403, 'Você não tem permissão para esta ação nesta arena.'),
    });
    render(<DashboardOverview arenaId="arena-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
  });

  it('mostra mensagem específica para 404 (arena não encontrada)', () => {
    mockedUseDashboard.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiError(404, 'Arena não encontrada.'),
    });
    render(<DashboardOverview arenaId="arena-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/arena não encontrada/i);
  });

  it('renderiza o resumo diário com os números corretos', () => {
    mockedUseDashboard.mockReturnValue({ data: baseDashboard, isPending: false, isError: false });
    render(<DashboardOverview arenaId="arena-1" />);

    expect(screen.getByText('Arena Central')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // confirmedBookings
  });

  it('mostra o horário no timezone da ARENA, não no do navegador/teste', () => {
    mockedUseDashboard.mockReturnValue({ data: baseDashboard, isPending: false, isError: false });
    render(<DashboardOverview arenaId="arena-1" />);

    // 13:00 UTC = 10:00 em America/Sao_Paulo (UTC-3).
    expect(screen.getAllByText('10:00').length).toBeGreaterThan(0);
  });

  it('mostra "Arena fechada" quando não há operatingHours para o dia', () => {
    mockedUseDashboard.mockReturnValue({
      data: { ...baseDashboard, operatingHours: [] },
      isPending: false,
      isError: false,
    });
    render(<DashboardOverview arenaId="arena-1" />);

    expect(screen.getByText(/arena fechada/i)).toBeInTheDocument();
  });

  it('quadra inativa aparece marcada como "Inativa"', () => {
    mockedUseDashboard.mockReturnValue({ data: baseDashboard, isPending: false, isError: false });
    render(<DashboardOverview arenaId="arena-1" />);

    expect(screen.getByText('Inativa')).toBeInTheDocument();
  });

  it('lista as próximas reservas com quadra e cliente', () => {
    mockedUseDashboard.mockReturnValue({ data: baseDashboard, isPending: false, isError: false });
    render(<DashboardOverview arenaId="arena-1" />);

    expect(screen.getAllByText('Cliente Teste').length).toBeGreaterThan(0);
  });

  // Fase 28, Caso 6/7/8: o checklist reflete o `setupStatus` que já vem de
  // `useArena` — a tela não recalcula nada sozinha, só exibe.
  it('Fase 28: mostra o checklist de configuração quando a arena ainda não está pronta', () => {
    mockedUseDashboard.mockReturnValue({ data: baseDashboard, isPending: false, isError: false });
    mockedUseArena.mockReturnValue({
      data: {
        id: 'arena-1',
        setupStatus: {
          hasBasicInfo: true,
          hasActiveCourtWithPricing: false,
          hasOperatingHours: true,
          isReady: false,
        },
      },
    });
    render(<DashboardOverview arenaId="arena-1" />);

    expect(screen.getByText('Configure sua arena')).toBeInTheDocument();
    expect(screen.getByText(/pelo menos uma quadra ativa com preço definido/i)).toBeInTheDocument();
  });

  it('Fase 28: mostra "sua arena está pronta" quando setupStatus.isReady é true', () => {
    mockedUseDashboard.mockReturnValue({ data: baseDashboard, isPending: false, isError: false });
    mockedUseArena.mockReturnValue({
      data: {
        id: 'arena-1',
        setupStatus: {
          hasBasicInfo: true,
          hasActiveCourtWithPricing: true,
          hasOperatingHours: true,
          isReady: true,
        },
      },
    });
    render(<DashboardOverview arenaId="arena-1" />);

    expect(screen.getByText(/sua arena está pronta/i)).toBeInTheDocument();
  });

  it('Fase 28: sem quadra cadastrada, mostra CTA pra adicionar a primeira', () => {
    mockedUseDashboard.mockReturnValue({
      data: { ...baseDashboard, courts: [] },
      isPending: false,
      isError: false,
    });
    render(<DashboardOverview arenaId="arena-1" />);

    expect(screen.getByRole('link', { name: /adicionar primeira quadra/i })).toHaveAttribute(
      'href',
      '/dashboard/arena-1/quadras',
    );
  });
});
