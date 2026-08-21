import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CourtBooking } from './page';
import { useDiscoverArena, useAvailability, useCreateBooking } from '../../../../../hooks/use-api';
import { ApiError } from '../../../../../lib/api';

const push = jest.fn();
const replace = jest.fn();
let searchParamsValue = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParamsValue,
}));

jest.mock('../../../../../hooks/use-api', () => ({
  useDiscoverArena: jest.fn(),
  useAvailability: jest.fn(),
  useCreateBooking: jest.fn(),
}));

const mockedUseDiscoverArena = useDiscoverArena as jest.Mock;
const mockedUseAvailability = useAvailability as jest.Mock;
const mockedUseCreateBooking = useCreateBooking as jest.Mock;

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
});
