import { render, screen } from '@testing-library/react';
import { ArenaDetail } from './arena-detail';
import { useDiscoverArena } from '../../../hooks/use-api';

jest.mock('../../../hooks/use-api', () => ({
  useDiscoverArena: jest.fn(),
}));

const mockedUseDiscoverArena = useDiscoverArena as jest.Mock;

const readyArena = {
  id: 'arena-1',
  name: 'Arena Central',
  slug: 'arena-central',
  description: 'A melhor arena da cidade',
  phone: null,
  email: null,
  timezone: 'America/Sao_Paulo',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isReady: true,
  courts: [
    {
      id: 'court-1',
      name: 'Quadra 1',
      sport: 'BEACH_VOLLEYBALL',
      description: null,
      pricePerSlot: '100.00',
      slotDurationMinutes: 60,
      bufferMinutes: 0,
    },
  ],
};

describe('ArenaDetail (público)', () => {
  it('mostra o estado de carregamento', () => {
    mockedUseDiscoverArena.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<ArenaDetail arenaId="arena-1" />);

    expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('mostra o estado de erro', () => {
    mockedUseDiscoverArena.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<ArenaDetail arenaId="arena-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível carregar/i);
  });

  it('mostra nome, descrição e quadras de uma arena pronta', () => {
    mockedUseDiscoverArena.mockReturnValue({ data: readyArena, isPending: false, isError: false });
    render(<ArenaDetail arenaId="arena-1" />);

    expect(screen.getByText('Arena Central')).toBeInTheDocument();
    expect(screen.getByText('A melhor arena da cidade')).toBeInTheDocument();
    // Fase 32 — link da quadra usa o slug da arena (URL pública canônica),
    // nunca o id técnico, mesmo a partir de um componente que só recebe
    // `arenaId` como prop (o slug vem de dentro dos dados já carregados).
    expect(screen.getByRole('link', { name: /Quadra 1/ })).toHaveAttribute(
      'href',
      '/arenas/arena-central/courts/court-1',
    );
    // Fase 33 — pista explícita de clicabilidade (mesmo padrão de
    // BookingCard/ArenaCard), com o próximo passo real da jornada.
    expect(screen.getByText('Escolher horário')).toBeInTheDocument();
  });

  // Fase 28, item 16/Caso 11: cliente nunca é levado a uma jornada
  // impossível (quadra sem preço/horário) — vê uma explicação clara.
  it('Fase 28: arena com isReady=false mostra mensagem de "ainda sendo configurada", nunca a lista de quadras', () => {
    mockedUseDiscoverArena.mockReturnValue({
      data: { ...readyArena, isReady: false },
      isPending: false,
      isError: false,
    });
    render(<ArenaDetail arenaId="arena-1" />);

    expect(screen.getByText(/ainda está sendo configurada/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Quadra 1/ })).not.toBeInTheDocument();
  });

  it('Fase 28: arena sem nenhuma quadra e isReady=false mostra a mesma mensagem de configuração (nunca uma tela vazia sem explicação)', () => {
    mockedUseDiscoverArena.mockReturnValue({
      data: { ...readyArena, isReady: false, courts: [] },
      isPending: false,
      isError: false,
    });
    render(<ArenaDetail arenaId="arena-1" />);

    expect(screen.getByText(/ainda está sendo configurada/i)).toBeInTheDocument();
  });
});
