import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { CourtBooking } from './court-booking';
import { useDiscoverArena, useAvailability, useCreateBooking } from '../../../../../hooks/use-api';
import { ApiError } from '../../../../../lib/api';

const push = jest.fn();
const replace = jest.fn();
let searchParamsValue = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/arenas/arena-1/courts/court-1',
  useSearchParams: () => searchParamsValue,
}));

// Fase 29 — signed-in por padrão nos testes existentes (mesmo espírito do
// mock de `Show` em outros arquivos: assume autenticado a menos que um
// teste específico sobrescreva). Testes de visitante sem conta sobrescrevem
// `mockedUseAuth` explicitamente.
jest.mock('@clerk/nextjs', () => ({
  useAuth: jest.fn(() => ({ userId: 'user-1', isLoaded: true })),
}));

jest.mock('../../../../../hooks/use-api', () => ({
  useDiscoverArena: jest.fn(),
  useAvailability: jest.fn(),
  useCreateBooking: jest.fn(),
}));

const mockedUseDiscoverArena = useDiscoverArena as jest.Mock;
const mockedUseAvailability = useAvailability as jest.Mock;
const mockedUseCreateBooking = useCreateBooking as jest.Mock;
const mockedUseAuth = useAuth as unknown as jest.Mock;

const arena = {
  id: 'arena-1',
  name: 'Arena Central',
  slug: 'arena-central',
  description: null,
  phone: null,
  email: null,
  timezone: 'America/Sao_Paulo',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  courts: [
    {
      id: 'court-1',
      name: 'Quadra 1',
      sport: 'BEACH_VOLLEYBALL',
      description: null,
      pricePerSlot: '100',
      slotDurationMinutes: 60,
      bufferMinutes: 0,
    },
  ],
};

const availability = {
  courtId: 'court-1',
  timezone: 'America/Sao_Paulo',
  from: '2026-09-07T03:00:00.000Z',
  to: '2026-09-08T03:00:00.000Z',
  slots: [
    { startsAt: '2026-09-07T13:00:00.000Z', endsAt: '2026-09-07T14:00:00.000Z', available: true },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CourtBooking arenaId="arena-1" courtId="court-1" />
    </QueryClientProvider>,
  );
}

describe('CourtBookingPage — fluxo de confirmação de reserva', () => {
  let mutateAsync: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    searchParamsValue = new URLSearchParams({ date: '2026-09-07' });
    mockedUseDiscoverArena.mockReturnValue({ data: arena, isPending: false, isError: false });
    mockedUseAvailability.mockReturnValue({ data: availability, isPending: false, isError: false });
    mutateAsync = jest.fn();
    mockedUseCreateBooking.mockReturnValue({ mutateAsync, isPending: false });
  });

  // Fase 33, item 3/17 — quem escolheu a quadra errada precisa de um jeito
  // óbvio de voltar pra arena (comparar outras quadras), não só o botão do
  // navegador.
  it('Fase 33: nome da arena é um link de volta pra /arenas/{slug}', async () => {
    renderPage();

    expect(await screen.findByRole('link', { name: 'Arena Central' })).toHaveAttribute(
      'href',
      '/arenas/arena-central',
    );
  });

  it('exibe o resumo com Idempotency-Key estável ao selecionar um horário e confirma', async () => {
    mutateAsync.mockResolvedValue({ id: 'booking-1' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Selecionar horário 10:00/ }));
    expect(await screen.findByText('Confirmar reserva')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const firstCall = mutateAsync.mock.calls[0][0];
    expect(firstCall.startsAt).toBe('2026-09-07T13:00:00.000Z');
    expect(typeof firstCall.idempotencyKey).toBe('string');

    await waitFor(() => expect(push).toHaveBeenCalledWith('/minhas-reservas/booking-1?created=true'));
  });

  it('reaproveita a MESMA Idempotency-Key em um retry após falha genérica', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('network error'));
    mutateAsync.mockResolvedValueOnce({ id: 'booking-1' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Selecionar horário 10:00/ }));
    const confirmButton = await screen.findByRole('button', { name: 'Confirmar reserva' });

    fireEvent.click(confirmButton);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    fireEvent.click(confirmButton);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));

    const key1 = mutateAsync.mock.calls[0][0].idempotencyKey;
    const key2 = mutateAsync.mock.calls[1][0].idempotencyKey;
    expect(key1).toBe(key2);
  });

  it('trata 409 mostrando mensagem amigável e limpando a seleção', async () => {
    mutateAsync.mockRejectedValue(new ApiError(409, 'Horário fora do funcionamento da arena.'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Selecionar horário 10:00/ }));
    const confirmButton = await screen.findByRole('button', { name: 'Confirmar reserva' });
    fireEvent.click(confirmButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(/não está mais disponível/i);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Confirmar reserva' })).not.toBeInTheDocument(),
    );
  });

  it('desabilita o botão de confirmar durante o envio (protege contra duplo clique)', async () => {
    mockedUseCreateBooking.mockReturnValue({ mutateAsync, isPending: true });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Selecionar horário 10:00/ }));
    expect(await screen.findByRole('button', { name: /Confirmando/ })).toBeDisabled();
  });

  // Fase 29, Parte 5 — visitante sem conta chega até o resumo (arena,
  // quadra, data, horário são públicos desde esta fase), mas confirmar a
  // reserva continua exigindo login. Em vez do botão de confirmar, vê um
  // link de entrar que preserva a seleção via query string.
  describe('Fase 29 — visitante sem conta no momento de confirmar', () => {
    beforeEach(() => {
      mockedUseAuth.mockReturnValue({ userId: null, isLoaded: true });
    });

    it('mostra "Entrar para confirmar reserva" em vez do botão de confirmar, preservando data e horário na URL de retorno', async () => {
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: /Selecionar horário 10:00/ }));

      expect(screen.queryByRole('button', { name: 'Confirmar reserva' })).not.toBeInTheDocument();
      const signInLink = await screen.findByRole('link', { name: /entrar para confirmar reserva/i });
      const href = signInLink.getAttribute('href')!;
      expect(href.startsWith('/sign-in?redirect_url=')).toBe(true);
      const redirectTarget = decodeURIComponent(href.replace('/sign-in?redirect_url=', ''));
      expect(redirectTarget).toContain('/arenas/arena-1/courts/court-1');
      expect(redirectTarget).toContain('date=2026-09-07');
      expect(redirectTarget).toContain('slot=2026-09-07T13%3A00%3A00.000Z');
    });

    it('nunca chama createBooking a partir do link de entrar (login continua sendo o único caminho pra autenticar)', async () => {
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: /Selecionar horário 10:00/ }));
      await screen.findByRole('link', { name: /entrar para confirmar reserva/i });

      expect(mutateAsync).not.toHaveBeenCalled();
    });
  });

  // Fase 29 — cobre a volta do login: o usuário escolheu um horário antes de
  // autenticar, foi mandado pro /sign-in, e voltou pra ESTA MESMA URL (com
  // `slot` na query, gravado por handleSelectSlot antes do redirect). A
  // seleção precisa reaparecer sozinha, sem o usuário escolher de novo.
  it('Fase 29: restaura a seleção a partir do parâmetro `slot` na URL (retorno do login)', async () => {
    // Usuário já autenticado (voltou do /sign-in) — reafirma explicitamente
    // porque o describe anterior sobrescreveu mockedUseAuth com signed-out.
    mockedUseAuth.mockReturnValue({ userId: 'user-1', isLoaded: true });
    searchParamsValue = new URLSearchParams({
      date: '2026-09-07',
      slot: '2026-09-07T13:00:00.000Z',
    });
    renderPage();

    expect(await screen.findByText('Resumo da reserva')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar reserva' })).toBeInTheDocument();
  });
});
