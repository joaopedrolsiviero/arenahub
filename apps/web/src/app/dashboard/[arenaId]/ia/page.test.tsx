import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiAssistant } from './page';
import { useAskAi, useDashboard, useMyAdminArenas } from '../../../../hooks/use-api';
import { ApiError } from '../../../../lib/api';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/arena-1/ia',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../../../hooks/use-api', () => ({
  useMyAdminArenas: jest.fn(),
  useDashboard: jest.fn(),
  useAskAi: jest.fn(),
}));

const mockedUseMyAdminArenas = useMyAdminArenas as jest.Mock;
const mockedUseDashboard = useDashboard as jest.Mock;
const mockedUseAskAi = useAskAi as jest.Mock;

describe('AiAssistant', () => {
  let mutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseMyAdminArenas.mockReturnValue({ data: [{ id: 'arena-1', role: 'OWNER' }] });
    mockedUseDashboard.mockReturnValue({
      data: { arena: { name: 'Arena Central', timezone: 'America/Sao_Paulo' } },
    });
    mutateAsync = jest.fn();
    mockedUseAskAi.mockReturnValue({ mutateAsync, isPending: false });
  });

  it('mostra o formulário com pergunta, sugestões rápidas e seletor de período', () => {
    render(<AiAssistant arenaId="arena-1" />);

    expect(screen.getByLabelText('Sua pergunta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Qual quadra está mais ocupada?' })).toBeInTheDocument();
    expect(screen.getByLabelText('Período')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Perguntar' })).toBeDisabled();
  });

  it('clicar numa pergunta rápida preenche o campo de pergunta', () => {
    render(<AiAssistant arenaId="arena-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Qual quadra está mais ocupada?' }));

    expect(screen.getByLabelText('Sua pergunta')).toHaveValue('Qual quadra está mais ocupada?');
    expect(screen.getByRole('button', { name: 'Perguntar' })).not.toBeDisabled();
  });

  it('envia a pergunta com o preset de período selecionado (default: últimos 7 dias)', async () => {
    mutateAsync.mockResolvedValue({
      answer: 'O movimento foi tranquilo hoje.',
      period: { from: '2026-08-14', to: '2026-08-20' },
      timezone: 'America/Sao_Paulo',
      generatedAt: '2026-08-20T12:00:00.000Z',
    });
    render(<AiAssistant arenaId="arena-1" />);

    fireEvent.change(screen.getByLabelText('Sua pergunta'), {
      target: { value: 'Como foi hoje?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        question: 'Como foi hoje?',
        period: { preset: 'last7days' },
      }),
    );
  });

  it('período personalizado mostra os campos de data e envia from/to explícitos', async () => {
    mutateAsync.mockResolvedValue({
      answer: 'Resposta.',
      period: { from: '2026-08-01', to: '2026-08-10' },
      timezone: 'America/Sao_Paulo',
      generatedAt: '2026-08-20T12:00:00.000Z',
    });
    render(<AiAssistant arenaId="arena-1" />);

    fireEvent.change(screen.getByLabelText('Sua pergunta'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'custom' } });

    expect(screen.getByLabelText('De')).toBeInTheDocument();
    expect(screen.getByLabelText('Até')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-08-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        question: 'x',
        period: { from: '2026-08-01', to: '2026-08-10' },
      }),
    );
  });

  it('mostra a resposta com o período analisado após sucesso', async () => {
    mutateAsync.mockResolvedValue({
      answer: 'A quadra mais ocupada foi a Quadra 1.',
      period: { from: '2026-08-14', to: '2026-08-20' },
      timezone: 'America/Sao_Paulo',
      generatedAt: '2026-08-20T12:00:00.000Z',
    });
    render(<AiAssistant arenaId="arena-1" />);

    fireEvent.change(screen.getByLabelText('Sua pergunta'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }));

    expect(await screen.findByText('A quadra mais ocupada foi a Quadra 1.')).toBeInTheDocument();
    expect(screen.getByText(/14\/08\/2026/)).toBeInTheDocument();
  });

  it('mostra estado de carregamento enquanto a pergunta está pendente', () => {
    mockedUseAskAi.mockReturnValue({ mutateAsync, isPending: true });
    render(<AiAssistant arenaId="arena-1" />);

    expect(screen.getByRole('button', { name: 'Consultando…' })).toBeDisabled();
  });

  it('mostra erro técnico amigável quando a consulta falha (diferente de resposta válida)', async () => {
    mutateAsync.mockRejectedValue(
      new ApiError(503, 'Assistente de IA temporariamente indisponível.'),
    );
    render(<AiAssistant arenaId="arena-1" />);

    fireEvent.change(screen.getByLabelText('Sua pergunta'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }));

    expect(
      await screen.findByText('Assistente de IA temporariamente indisponível.'),
    ).toBeInTheDocument();
  });
});
