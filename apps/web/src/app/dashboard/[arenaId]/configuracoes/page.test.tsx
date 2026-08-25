import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArenaSettings } from './page';
import { useArena, useDashboard, useMyAdminArenas, useUpdateArena } from '../../../../hooks/use-api';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/arena-1/configuracoes',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../../../hooks/use-api', () => ({
  useMyAdminArenas: jest.fn(),
  useDashboard: jest.fn(),
  useArena: jest.fn(),
  useUpdateArena: jest.fn(),
}));

const mockedUseMyAdminArenas = useMyAdminArenas as jest.Mock;
const mockedUseDashboard = useDashboard as jest.Mock;
const mockedUseArena = useArena as jest.Mock;
const mockedUseUpdateArena = useUpdateArena as jest.Mock;

const ARENA = {
  id: 'arena-1',
  name: 'Arena Central',
  slug: 'arena-central',
  description: null,
  phone: null,
  email: null,
  timezone: 'America/Sao_Paulo',
  whatsappPhoneNumberId: null,
  role: 'OWNER',
};

function renderPage() {
  return render(<ArenaSettings arenaId="arena-1" />);
}

describe('ArenaSettingsPage — campo de WhatsApp (Fase 16)', () => {
  let mutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseMyAdminArenas.mockReturnValue({ data: [{ id: 'arena-1', role: 'OWNER' }] });
    mockedUseDashboard.mockReturnValue({
      data: { arena: { name: 'Arena Central', timezone: 'America/Sao_Paulo' } },
    });
    mockedUseArena.mockReturnValue({ data: ARENA, isPending: false, isError: false });
    mutateAsync = jest.fn().mockResolvedValue(ARENA);
    mockedUseUpdateArena.mockReturnValue({ mutateAsync, isPending: false });
  });

  it('mostra o campo do phone_number_id, vazio quando a arena ainda não tem WhatsApp configurado', async () => {
    renderPage();

    const field = await screen.findByLabelText(/id do número/i);
    expect(field).toHaveValue('');
  });

  it('pré-popula o campo quando a arena já tem um número configurado', async () => {
    mockedUseArena.mockReturnValue({
      data: { ...ARENA, whatsappPhoneNumberId: '109876543210123' },
      isPending: false,
      isError: false,
    });
    renderPage();

    expect(await screen.findByLabelText(/id do número/i)).toHaveValue('109876543210123');
  });

  it('salvar envia whatsappPhoneNumberId preenchido no PATCH', async () => {
    renderPage();

    fireEvent.change(await screen.findByLabelText(/id do número/i), {
      target: { value: '109876543210123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ whatsappPhoneNumberId: '109876543210123' }),
      );
    });
  });

  it('campo vazio envia undefined (nunca sobrescreve com string vazia)', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ whatsappPhoneNumberId: undefined }),
      );
    });
  });
});
