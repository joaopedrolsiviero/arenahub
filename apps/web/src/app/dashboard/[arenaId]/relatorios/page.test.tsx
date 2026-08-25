import { render, screen, fireEvent } from '@testing-library/react';
import { ReportsView } from './page';
import { useArenaReport, useDashboard, useMyAdminArenas } from '../../../../hooks/use-api';
import type { ReportResponse } from '../../../../lib/types';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/arena-1/relatorios',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../../../hooks/use-api', () => ({
  useMyAdminArenas: jest.fn(),
  useDashboard: jest.fn(),
  useArenaReport: jest.fn(),
}));

const mockedUseMyAdminArenas = useMyAdminArenas as jest.Mock;
const mockedUseDashboard = useDashboard as jest.Mock;
const mockedUseArenaReport = useArenaReport as jest.Mock;

function renderPage() {
  return render(<ReportsView arenaId="arena-1" />);
}

function report(overrides: Partial<ReportResponse> = {}): ReportResponse {
  return {
    period: { from: '2026-08-14', to: '2026-08-20' },
    previousPeriod: { from: '2026-08-07', to: '2026-08-13' },
    summary: {
      revenue: 150,
      bookings: 3,
      confirmedBookings: 2,
      cancelledBookings: 1,
      occupancyRate: 0.0893,
    },
    comparison: {
      revenueDeltaPct: 275,
      confirmedBookingsDeltaPct: 100,
      cancelledBookingsDeltaPct: null,
      occupancyRateDeltaPct: 150,
    },
    series: [
      {
        date: '2026-08-14',
        revenue: 0,
        confirmedBookings: 0,
        cancelledBookings: 0,
        occupancyRate: null,
      },
      {
        date: '2026-08-20',
        revenue: 150,
        confirmedBookings: 2,
        cancelledBookings: 1,
        occupancyRate: 0.0893,
      },
    ],
    courts: [
      {
        name: 'Quadra A1',
        confirmedBookings: 1,
        cancelledBookings: 1,
        revenue: 100,
        occupancyRate: 0.0714,
      },
      {
        name: 'Quadra A2',
        confirmedBookings: 1,
        cancelledBookings: 0,
        revenue: 50,
        occupancyRate: 0.1071,
      },
    ],
    mostOccupiedCourtName: 'Quadra A2',
    leastOccupiedCourtName: 'Quadra A1',
    demand: {
      bookingsByHour: [
        { hour: 8, count: 0 },
        { hour: 10, count: 1 },
        { hour: 13, count: 1 },
      ],
      peakHour: 10,
      lowestHour: 8,
    },
    busiestDays: [{ date: '2026-08-20', count: 2 }],
    ...overrides,
  };
}

describe('RelatoriosPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseMyAdminArenas.mockReturnValue({ data: [{ id: 'arena-1', role: 'OWNER' }] });
    mockedUseDashboard.mockReturnValue({
      data: { arena: { name: 'Arena Central', timezone: 'America/Sao_Paulo' } },
    });
  });

  it('mostra o estado de carregamento', async () => {
    mockedUseArenaReport.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderPage();

    expect(await screen.findByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('mostra o estado de erro', async () => {
    mockedUseArenaReport.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderPage();

    expect(await screen.findByText('Não foi possível carregar o relatório.')).toBeInTheDocument();
  });

  it('período personalizado sem as duas datas pede as datas, sem disparar erro', async () => {
    mockedUseArenaReport.mockReturnValue({ data: undefined, isPending: false, isError: false });
    renderPage();

    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'custom' } });

    expect(
      await screen.findByText('Escolha as duas datas do período personalizado.'),
    ).toBeInTheDocument();
  });

  it('resumo mostra receita, comparação e ocupação null como "Não disponível"', async () => {
    mockedUseArenaReport.mockReturnValue({ data: report(), isPending: false, isError: false });
    renderPage();

    expect((await screen.findAllByText('R$ 150,00')).length).toBeGreaterThan(0);
    expect(screen.getByText('+275.0% vs. período anterior')).toBeInTheDocument();
    expect(screen.getByText('Sem base para comparação')).toBeInTheDocument();
  });

  it('dia sem expediente configurado aparece marcado como tal na série, nunca como 0%', async () => {
    mockedUseArenaReport.mockReturnValue({ data: report(), isPending: false, isError: false });
    renderPage();

    expect(await screen.findByText('Sem expediente configurado')).toBeInTheDocument();
  });

  it('ocupação null no resumo aparece como "Não disponível", nunca 0%', async () => {
    mockedUseArenaReport.mockReturnValue({
      data: report({
        summary: { revenue: 150, bookings: 2, confirmedBookings: 2, cancelledBookings: 0, occupancyRate: null },
      }),
      isPending: false,
      isError: false,
    });
    renderPage();

    expect(await screen.findByText('Não disponível')).toBeInTheDocument();
  });

  it('nota de "nenhuma reserva" aparece quando summary.bookings é 0', async () => {
    mockedUseArenaReport.mockReturnValue({
      data: report({
        summary: { revenue: 0, bookings: 0, confirmedBookings: 0, cancelledBookings: 0, occupancyRate: null },
      }),
      isPending: false,
      isError: false,
    });
    renderPage();

    expect(
      await screen.findByText('Nenhuma reserva neste período — os números abaixo refletem isso.'),
    ).toBeInTheDocument();
  });

  it('lista o desempenho de cada quadra e destaca a mais/menos ocupada', async () => {
    mockedUseArenaReport.mockReturnValue({ data: report(), isPending: false, isError: false });
    renderPage();

    expect(await screen.findByText('Quadra A1')).toBeInTheDocument();
    expect(screen.getByText('Quadra A2')).toBeInTheDocument();
    expect(screen.getByText(/Mais ocupada: Quadra A2/)).toBeInTheDocument();
    expect(screen.getByText(/Menos ocupada: Quadra A1/)).toBeInTheDocument();
  });

  it('lista os dias mais movimentados', async () => {
    mockedUseArenaReport.mockReturnValue({ data: report(), isPending: false, isError: false });
    renderPage();

    expect(await screen.findByText('2 reservas')).toBeInTheDocument();
  });

  it('trocar o preset dispara a query com o novo período', async () => {
    mockedUseArenaReport.mockReturnValue({ data: report(), isPending: false, isError: false });
    renderPage();

    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'thisMonth' } });

    expect(mockedUseArenaReport).toHaveBeenLastCalledWith('arena-1', { preset: 'thisMonth' });
  });

  it('período personalizado com as duas datas dispara a query com from/to', async () => {
    mockedUseArenaReport.mockReturnValue({ data: report(), isPending: false, isError: false });
    renderPage();

    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-08-10' } });

    expect(mockedUseArenaReport).toHaveBeenLastCalledWith('arena-1', {
      from: '2026-08-01',
      to: '2026-08-10',
    });
  });
});
