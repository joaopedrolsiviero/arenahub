import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import * as Crypto from 'expo-crypto';
import { useDiscoverArena } from '@/hooks/useArenas';
import { useCourtAvailability } from '@/hooks/useAvailability';
import { useCreateBooking } from '@/hooks/useCreateBooking';
import { ApiError, ApiNetworkError } from '@/api/client';
import CourtAvailabilityScreen from './[courtId]';

jest.mock('@/lib/env', () => ({
  env: { apiUrl: 'https://api.example.test/v1', clerkPublishableKey: 'pk_test_x' },
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), setParams: jest.fn() },
  Stack: { Screen: () => null },
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@clerk/clerk-expo', () => ({ useAuth: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/hooks/useArenas', () => ({ useDiscoverArena: jest.fn() }));
jest.mock('@/hooks/useAvailability', () => ({ useCourtAvailability: jest.fn() }));
jest.mock('@/hooks/useCreateBooking', () => ({ useCreateBooking: jest.fn() }));

const mockedUseLocalSearchParams = useLocalSearchParams as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;
const mockedRandomUUID = Crypto.randomUUID as jest.Mock;
const mockedUseDiscoverArena = useDiscoverArena as jest.Mock;
const mockedUseCourtAvailability = useCourtAvailability as jest.Mock;
const mockedUseCreateBooking = useCreateBooking as jest.Mock;

const arena = {
  id: 'arena-1',
  name: 'Arena Central',
  slug: 'arena-central',
  timezone: 'America/Sao_Paulo',
  // M4 — decide o destino pós-reserva (handleConfirm); ONLINE por padrão
  // nos testes existentes (preserva o comportamento já coberto desde a M3).
  paymentMode: 'ONLINE',
  courts: [
    {
      id: 'court-1',
      name: 'Quadra 1',
      sport: 'BEACH_VOLLEYBALL',
      pricePerSlot: '100',
      slotDurationMinutes: 60,
      bufferMinutes: 0,
      imageUrl: null,
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
    { startsAt: '2026-09-07T14:00:00.000Z', endsAt: '2026-09-07T15:00:00.000Z', available: true },
    { startsAt: '2026-09-07T15:00:00.000Z', endsAt: '2026-09-07T16:00:00.000Z', available: false },
  ],
};

// IMPORTANTE: `fireEvent.press`/`fireEvent.changeText` são assíncronos
// nesta versão do @testing-library/react-native (devolvem Promise) — todo
// press que precisa refletir em algo RENDERIZADO antes da próxima asserção
// precisa de `await`, senão a asserção roda antes do re-render commitar.
describe('Quadra — seleção e reserva (M3)', () => {
  let mutateAsync: jest.Mock;
  let uuidCounter: number;

  beforeEach(() => {
    jest.clearAllMocks();
    uuidCounter = 0;
    mockedRandomUUID.mockImplementation(() => `uuid-${++uuidCounter}`);
    mockedUseLocalSearchParams.mockReturnValue({
      slug: 'arena-central',
      courtId: 'court-1',
      date: '2026-09-07',
    });
    mockedUseAuth.mockReturnValue({ userId: 'user-1', isLoaded: true });
    mockedUseDiscoverArena.mockReturnValue({ isPending: false, isError: false, data: arena });
    mockedUseCourtAvailability.mockReturnValue({
      isPending: false,
      isError: false,
      data: availability,
      refetch: jest.fn(),
    });
    mutateAsync = jest.fn();
    mockedUseCreateBooking.mockReturnValue({ mutateAsync, isPending: false });
  });

  // Coberto desde a M2 — continua válido (a busca de disponibilidade em si
  // não mudou nesta fase, só passou a permitir seleção sobre o resultado).
  describe('Disponibilidade (M2, regressão)', () => {
    it('loading: mostra o estado de carregamento dos horários', async () => {
      mockedUseCourtAvailability.mockReturnValue({ isPending: true, isError: false, data: undefined });

      await render(<CourtAvailabilityScreen />);

      expect(screen.getByText('Carregando horários…')).toBeTruthy();
    });

    it('erro: mostra a mensagem de erro com botão de tentar novamente', async () => {
      const refetch = jest.fn();
      mockedUseCourtAvailability.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch });

      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('error-retry'));

      expect(screen.getByText('Não foi possível carregar os horários disponíveis.')).toBeTruthy();
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('vazio: mostra a mensagem de nenhum horário quando a grade vem vazia', async () => {
      mockedUseCourtAvailability.mockReturnValue({
        isPending: false,
        isError: false,
        data: { courtId: 'court-1', timezone: 'America/Sao_Paulo', from: '', to: '', slots: [] },
      });

      await render(<CourtAvailabilityScreen />);

      expect(
        screen.getByText('Sem horários para esta data — a arena está fechada ou não há grade disponível.'),
      ).toBeTruthy();
    });

    it('trocar de data limpa a seleção e refaz a consulta com uma nova janela', async () => {
      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));

      await fireEvent.press(screen.getByTestId('date-next'));

      expect(router.setParams).toHaveBeenCalledWith({ date: '2026-09-08', slots: '' });
    });
  });

  describe('Seleção de horários', () => {
    it('selecionar um horário disponível marca o slot como selecionado', async () => {
      await render(<CourtAvailabilityScreen />);

      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));

      expect(screen.getByTestId('slot-2026-09-07T13:00:00.000Z').props.accessibilityState.selected).toBe(
        true,
      );
    });

    it('selecionar múltiplos horários mostra os dois no resumo', async () => {
      await render(<CourtAvailabilityScreen />);

      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T14:00:00.000Z'));

      expect(screen.getByText('10:00, 11:00')).toBeTruthy();
    });

    it('tocar de novo num horário selecionado desmarca', async () => {
      await render(<CourtAvailabilityScreen />);

      const slot = screen.getByTestId('slot-2026-09-07T13:00:00.000Z');
      await fireEvent.press(slot);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));

      expect(screen.getByTestId('slot-2026-09-07T13:00:00.000Z').props.accessibilityState.selected).toBe(
        false,
      );
      expect(screen.queryByTestId('summary-confirm')).toBeNull();
    });

    it('horário indisponível está desabilitado e nunca pode ser selecionado', async () => {
      await render(<CourtAvailabilityScreen />);

      const unavailable = screen.getByTestId('slot-2026-09-07T15:00:00.000Z');
      expect(unavailable.props.accessibilityState.disabled).toBe(true);

      await fireEvent.press(unavailable);
      expect(screen.getByTestId('slot-2026-09-07T15:00:00.000Z').props.accessibilityState.selected).toBeFalsy();
    });
  });

  describe('Resumo', () => {
    it('mostra arena, quadra, data, horário e preço', async () => {
      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));

      expect(screen.getByText('Arena Central')).toBeTruthy();
      expect(screen.getByText('Quadra 1')).toBeTruthy();
      // Duas ocorrências esperadas: o DateStepper (topo da tela) e a linha
      // "Data" do resumo mostram o mesmo rótulo.
      expect(screen.getAllByText('07/09/2026')).toHaveLength(2);
      // Idem: "10:00" aparece no chip da grade (selecionado) E na linha
      // "Horário" do resumo.
      expect(screen.getAllByText('10:00')).toHaveLength(2);
      expect(screen.getByText('R$ 100,00')).toBeTruthy();
    });

    it('usuário autenticado vê o botão de confirmar, não o link de login', async () => {
      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));

      expect(screen.getByTestId('summary-confirm')).toBeTruthy();
      expect(screen.queryByTestId('summary-sign-in')).toBeNull();
    });
  });

  describe('Autenticação — visitante sem conta', () => {
    beforeEach(() => {
      mockedUseAuth.mockReturnValue({ userId: null, isLoaded: true });
    });

    it('mostra o link de entrar em vez do botão de confirmar, preservando a seleção na URL de retorno', async () => {
      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));

      expect(screen.queryByTestId('summary-confirm')).toBeNull();
      expect(screen.getByTestId('summary-sign-in')).toBeTruthy();
      expect(mutateAsync).not.toHaveBeenCalled();
    });

    it('a seleção é escrita nos parâmetros da própria rota (sobrevive ao remount pós-login)', async () => {
      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));

      expect(router.setParams).toHaveBeenCalledWith({ slots: '2026-09-07T13:00:00.000Z' });
    });

    it('restaura a seleção a partir do parâmetro slots da URL (retorno do login)', async () => {
      mockedUseLocalSearchParams.mockReturnValue({
        slug: 'arena-central',
        courtId: 'court-1',
        date: '2026-09-07',
        slots: '2026-09-07T13:00:00.000Z,2026-09-07T14:00:00.000Z',
      });
      mockedUseAuth.mockReturnValue({ userId: 'user-1', isLoaded: true });

      await render(<CourtAvailabilityScreen />);

      expect(screen.getByText('Resumo da reserva')).toBeTruthy();
      expect(screen.getByText('10:00, 11:00')).toBeTruthy();
    });
  });

  describe('Confirmação — sucesso', () => {
    // M4, item 7/8 — arena.paymentMode decide o destino pós-reserva; nunca
    // um valor do cliente. O mock padrão desta suíte é ONLINE (ver `arena`).
    it('POST bem-sucedido com arena ONLINE navega pro fluxo de pagamento e limpa a seleção', async () => {
      mutateAsync.mockResolvedValue({
        id: 'booking-1',
        status: 'CONFIRMED',
        startsAt: '2026-09-07T13:00:00.000Z',
        endsAt: '2026-09-07T14:00:00.000Z',
        total: '100',
      });

      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));
      await fireEvent.press(screen.getByTestId('summary-confirm'));

      await waitFor(() => expect(router.replace).toHaveBeenCalled());
      const [arg] = (router.replace as jest.Mock).mock.calls[0] as [Record<string, unknown>];
      expect(arg).toMatchObject({
        pathname: '/pagamento/[bookingId]',
        params: expect.objectContaining({ bookingId: 'booking-1' }),
      });
      expect(screen.queryByTestId('summary-confirm')).toBeNull();
    });

    it('POST bem-sucedido com arena IN_PERSON navega direto pra confirmação, nunca pro pagamento', async () => {
      mockedUseDiscoverArena.mockReturnValue({
        isPending: false,
        isError: false,
        data: { ...arena, paymentMode: 'IN_PERSON' },
      });
      mutateAsync.mockResolvedValue({
        id: 'booking-1',
        status: 'CONFIRMED',
        startsAt: '2026-09-07T13:00:00.000Z',
        endsAt: '2026-09-07T14:00:00.000Z',
        total: '100',
      });

      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));
      await fireEvent.press(screen.getByTestId('summary-confirm'));

      await waitFor(() => expect(router.replace).toHaveBeenCalled());
      const [arg] = (router.replace as jest.Mock).mock.calls[0] as [Record<string, unknown>];
      expect(arg).toMatchObject({
        pathname: '/reserva-confirmada/[bookingId]',
        params: expect.objectContaining({ bookingId: 'booking-1', paymentMode: 'IN_PERSON' }),
      });
    });

    it('envia a Idempotency-Key gerada na seleção, nunca uma nova a cada toque em confirmar', async () => {
      mutateAsync.mockResolvedValue({ id: 'booking-1', status: 'CONFIRMED', startsAt: '', endsAt: '', total: '100' });

      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));
      const keyAfterSelection = `uuid-${uuidCounter}`;

      await fireEvent.press(screen.getByTestId('summary-confirm'));

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: keyAfterSelection }),
      );
    });
  });

  describe('Confirmação — conflito (409)', () => {
    it('mostra mensagem de conflito, limpa a seleção e permite tentar de novo', async () => {
      mutateAsync.mockRejectedValue(new ApiError(409, 'Horário indisponível.'));
      const refetch = jest.fn();
      mockedUseCourtAvailability.mockReturnValue({
        isPending: false,
        isError: false,
        data: availability,
        refetch,
      });

      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));
      await fireEvent.press(screen.getByTestId('summary-confirm'));

      await waitFor(() =>
        expect(
          screen.getByText(
            'Esse horário acabou de ser reservado por outra pessoa. Atualize a disponibilidade e escolha outro horário.',
          ),
        ).toBeTruthy(),
      );
      expect(refetch).toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      // Seleção limpa — o resumo (e o botão de confirmar) somem.
      expect(screen.queryByTestId('summary-confirm')).toBeNull();
    });
  });

  describe('Confirmação — sessão expirada (401)', () => {
    it('redireciona pro login preservando a seleção, nunca mostra "tente novamente"', async () => {
      mutateAsync.mockRejectedValue(new ApiError(401, 'Não autorizado.'));

      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));
      await fireEvent.press(screen.getByTestId('summary-confirm'));

      await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      const target = decodeURIComponent((router.push as jest.Mock).mock.calls[0][0] as string);
      expect(target).toContain('/(auth)/sign-in?redirect=');
      expect(target).toContain('/arena/arena-central/court-1');
      expect(target).toContain('slots=2026-09-07T13');
      expect(screen.queryByText('Não foi possível concluir a reserva. Tente novamente.')).toBeNull();
    });
  });

  describe('Confirmação — erro de rede/timeout', () => {
    it('não destrói a seleção e reutiliza a mesma Idempotency-Key no retry', async () => {
      mutateAsync.mockRejectedValueOnce(new ApiNetworkError());
      mutateAsync.mockResolvedValueOnce({ id: 'booking-1', status: 'CONFIRMED', startsAt: '', endsAt: '', total: '100' });

      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));

      await fireEvent.press(screen.getByTestId('summary-confirm'));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      expect(screen.getByText('Não foi possível concluir a reserva. Tente novamente.')).toBeTruthy();
      // Seleção continua visível — nada foi limpo por um erro de rede.
      expect(screen.getByTestId('summary-confirm')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('summary-confirm'));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));

      const firstKey = (mutateAsync.mock.calls[0] as [{ idempotencyKey: string }])[0].idempotencyKey;
      const secondKey = (mutateAsync.mock.calls[1] as [{ idempotencyKey: string }])[0].idempotencyKey;
      expect(secondKey).toBe(firstKey);
    });
  });

  describe('Proteção contra duplo toque', () => {
    it('o botão de confirmar fica desabilitado enquanto a mutation está em andamento', async () => {
      mockedUseCreateBooking.mockReturnValue({ mutateAsync, isPending: true });

      await render(<CourtAvailabilityScreen />);
      await fireEvent.press(screen.getByTestId('slot-2026-09-07T13:00:00.000Z'));

      expect(screen.getByTestId('summary-confirm').props.accessibilityState.disabled).toBe(true);
    });
  });
});
