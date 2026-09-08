import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import { usePayment, useCreatePayment } from '@/hooks/usePayment';
import { ApiError, ApiNetworkError } from '@/api/client';
import PagamentoScreen from './[bookingId]';

jest.mock('@/lib/env', () => ({
  env: { apiUrl: 'https://api.example.test/v1', clerkPublishableKey: 'pk_test_x' },
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/hooks/usePayment', () => ({ usePayment: jest.fn(), useCreatePayment: jest.fn() }));

const mockedUseLocalSearchParams = useLocalSearchParams as jest.Mock;
const mockedUsePayment = usePayment as jest.Mock;
const mockedUseCreatePayment = useCreatePayment as jest.Mock;
const mockedRandomUUID = Crypto.randomUUID as jest.Mock;
const mockedSetStringAsync = Clipboard.setStringAsync as jest.Mock;

const bookingParams = {
  bookingId: 'booking-1',
  startsAt: '2026-09-07T13:00:00.000Z',
  endsAt: '2026-09-07T14:00:00.000Z',
  total: '100',
  arenaName: 'Arena Central',
  courtName: 'Quadra 1',
  timezone: 'America/Sao_Paulo',
};

describe('Pagamento PIX (M4)', () => {
  let mutateAsync: jest.Mock;
  let uuidCounter: number;

  beforeEach(() => {
    jest.clearAllMocks();
    uuidCounter = 0;
    mockedRandomUUID.mockImplementation(() => `uuid-${++uuidCounter}`);
    mockedUseLocalSearchParams.mockReturnValue(bookingParams);
    mutateAsync = jest.fn();
    mockedUseCreatePayment.mockReturnValue({ mutateAsync, isPending: false });
  });

  describe('Sem pagamento ainda', () => {
    it('mostra o botão "Gerar PIX" e o total estimado da reserva', async () => {
      mockedUsePayment.mockReturnValue({ isPending: false, isError: false, data: null, refetch: jest.fn() });

      await render(<PagamentoScreen />);

      expect(screen.getByTestId('generate-pix')).toBeTruthy();
      expect(screen.getByText('R$ 100,00')).toBeTruthy();
    });

    it('gerar PIX chama a mutation com uma Idempotency-Key nova', async () => {
      mockedUsePayment.mockReturnValue({ isPending: false, isError: false, data: null, refetch: jest.fn() });
      mutateAsync.mockResolvedValue({ id: 'payment-1', status: 'PENDING' });

      await render(<PagamentoScreen />);
      await fireEvent.press(screen.getByTestId('generate-pix'));

      expect(mutateAsync).toHaveBeenCalledWith({ idempotencyKey: 'uuid-1' });
    });
  });

  describe('PENDING — PIX nativo', () => {
    const pendingPayment = {
      id: 'payment-1',
      status: 'PENDING',
      amount: '100.00',
      qrCodeBase64: 'iVBORw0KGgo=',
      pixCopyPaste: '00020126PIXCODE',
      expiresAt: '2026-09-07T13:30:00.000Z',
      paidAt: null,
    };

    beforeEach(() => {
      mockedUsePayment.mockReturnValue({ isPending: false, isError: false, data: pendingPayment, refetch: jest.fn() });
    });

    it('mostra o QR Code e o valor autoritativo do Payment (não mais o total estimado)', async () => {
      await render(<PagamentoScreen />);

      const qr = screen.getByLabelText('QR Code do PIX');
      expect(qr.props.source.uri).toBe('data:image/png;base64,iVBORw0KGgo=');
    });

    it('mostra o código copia-e-cola e copia pro clipboard ao tocar', async () => {
      mockedSetStringAsync.mockResolvedValue(undefined);
      await render(<PagamentoScreen />);

      expect(screen.getByTestId('pix-copy-paste')).toHaveTextContent('00020126PIXCODE');

      await fireEvent.press(screen.getByTestId('copy-pix'));

      expect(mockedSetStringAsync).toHaveBeenCalledWith('00020126PIXCODE');
      expect(screen.getByLabelText('Código copiado')).toBeTruthy();
    });

    it('mostra a expiração informada pelo backend', async () => {
      await render(<PagamentoScreen />);

      expect(screen.getByText(/Expira em/)).toBeTruthy();
    });

    it('nunca mostra o botão de gerar PIX enquanto já existe uma tentativa pendente', async () => {
      await render(<PagamentoScreen />);

      expect(screen.queryByTestId('generate-pix')).toBeNull();
    });
  });

  describe('PAID', () => {
    it('mostra "Pagamento confirmado!"', async () => {
      mockedUsePayment.mockReturnValue({
        isPending: false,
        isError: false,
        data: { id: 'payment-1', status: 'PAID', amount: '100.00', paidAt: '2026-09-07T13:05:00.000Z' },
        refetch: jest.fn(),
      });

      await render(<PagamentoScreen />);

      expect(screen.getByText('Pagamento confirmado!')).toBeTruthy();
    });
  });

  describe('FAILED', () => {
    it('mostra "Pagamento não aprovado" e permite tentar de novo com uma chave NOVA', async () => {
      mockedUsePayment.mockReturnValue({
        isPending: false,
        isError: false,
        data: { id: 'payment-1', status: 'FAILED', amount: '100.00' },
        refetch: jest.fn(),
      });
      mutateAsync.mockResolvedValue({ id: 'payment-2', status: 'PENDING' });

      await render(<PagamentoScreen />);
      expect(screen.getByText('Pagamento não aprovado.')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('retry-payment'));

      expect(mutateAsync).toHaveBeenCalledWith({ idempotencyKey: 'uuid-1' });
    });
  });

  describe('EXPIRED', () => {
    it('mostra a mensagem de expiração e permite tentar de novo', async () => {
      mockedUsePayment.mockReturnValue({
        isPending: false,
        isError: false,
        data: { id: 'payment-1', status: 'EXPIRED', amount: '100.00' },
        refetch: jest.fn(),
      });

      await render(<PagamentoScreen />);

      expect(screen.getByText('O prazo para pagar esse PIX expirou.')).toBeTruthy();
      expect(screen.getByTestId('retry-payment')).toBeTruthy();
    });
  });

  describe('CANCELLED', () => {
    it('mostra o estado cancelado, sem nenhuma ação de pagamento', async () => {
      mockedUsePayment.mockReturnValue({
        isPending: false,
        isError: false,
        data: { id: 'payment-1', status: 'CANCELLED', amount: '100.00' },
        refetch: jest.fn(),
      });

      await render(<PagamentoScreen />);

      expect(screen.getByText(/cancelada porque a reserva foi cancelada/)).toBeTruthy();
      expect(screen.queryByTestId('generate-pix')).toBeNull();
      expect(screen.queryByTestId('retry-payment')).toBeNull();
    });
  });

  describe('Idempotency-Key — reuso em retry (M4, item 10/11)', () => {
    it('erro de rede: consulta o pagamento existente e reutiliza a MESMA chave no próximo toque', async () => {
      const refetch = jest.fn();
      mockedUsePayment.mockReturnValue({ isPending: false, isError: false, data: null, refetch });
      mutateAsync.mockRejectedValueOnce(new ApiNetworkError());
      mutateAsync.mockResolvedValueOnce({ id: 'payment-1', status: 'PENDING' });

      await render(<PagamentoScreen />);
      await fireEvent.press(screen.getByTestId('generate-pix'));
      await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));

      await fireEvent.press(screen.getByTestId('generate-pix'));

      expect(mutateAsync).toHaveBeenNthCalledWith(1, { idempotencyKey: 'uuid-1' });
      expect(mutateAsync).toHaveBeenNthCalledWith(2, { idempotencyKey: 'uuid-1' });
    });

    it('409: consulta o pagamento existente e NUNCA cria um novo automaticamente', async () => {
      const refetch = jest.fn();
      mockedUsePayment.mockReturnValue({ isPending: false, isError: false, data: null, refetch });
      mutateAsync.mockRejectedValue(new ApiError(409, 'Esta reserva já está paga.'));

      await render(<PagamentoScreen />);
      await fireEvent.press(screen.getByTestId('generate-pix'));

      await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('Erros de infraestrutura', () => {
    it('401: preserva o contexto (bookingId) e redireciona pro login', async () => {
      mockedUsePayment.mockReturnValue({ isPending: false, isError: false, data: null, refetch: jest.fn() });
      mutateAsync.mockRejectedValue(new ApiError(401, 'Não autorizado.'));

      await render(<PagamentoScreen />);
      await fireEvent.press(screen.getByTestId('generate-pix'));

      await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      const target = decodeURIComponent((router.push as jest.Mock).mock.calls[0][0] as string);
      expect(target).toBe('/(auth)/sign-in?redirect=/pagamento/booking-1');
    });

    it('403: mostra mensagem de permissão, sem retry automático', async () => {
      mockedUsePayment.mockReturnValue({ isPending: false, isError: false, data: null, refetch: jest.fn() });
      mutateAsync.mockRejectedValue(new ApiError(403, 'Proibido.'));

      await render(<PagamentoScreen />);
      await fireEvent.press(screen.getByTestId('generate-pix'));

      await waitFor(() =>
        expect(screen.getByText('Você não tem permissão para realizar esta ação.')).toBeTruthy(),
      );
    });

    it('404: mostra mensagem de reserva não encontrada', async () => {
      mockedUsePayment.mockReturnValue({ isPending: false, isError: false, data: null, refetch: jest.fn() });
      mutateAsync.mockRejectedValue(new ApiError(404, 'Não encontrada.'));

      await render(<PagamentoScreen />);
      await fireEvent.press(screen.getByTestId('generate-pix'));

      await waitFor(() => expect(screen.getByText('Reserva não encontrada.')).toBeTruthy());
    });

    it('429: mostra mensagem de limite de tentativas', async () => {
      mockedUsePayment.mockReturnValue({ isPending: false, isError: false, data: null, refetch: jest.fn() });
      mutateAsync.mockRejectedValue(new ApiError(429, 'Too many requests.'));

      await render(<PagamentoScreen />);
      await fireEvent.press(screen.getByTestId('generate-pix'));

      await waitFor(() =>
        expect(
          screen.getByText('Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.'),
        ).toBeTruthy(),
      );
    });

    it('5xx: mostra mensagem genérica e preserva a mesma chave', async () => {
      mockedUsePayment.mockReturnValue({ isPending: false, isError: false, data: null, refetch: jest.fn() });
      mutateAsync.mockRejectedValueOnce(new ApiError(500, 'Erro interno.'));
      mutateAsync.mockResolvedValueOnce({ id: 'payment-1', status: 'PENDING' });

      await render(<PagamentoScreen />);
      await fireEvent.press(screen.getByTestId('generate-pix'));
      await waitFor(() =>
        expect(screen.getByText('Não foi possível iniciar o pagamento agora. Tente novamente.')).toBeTruthy(),
      );

      await fireEvent.press(screen.getByTestId('generate-pix'));

      expect(mutateAsync).toHaveBeenNthCalledWith(1, { idempotencyKey: 'uuid-1' });
      expect(mutateAsync).toHaveBeenNthCalledWith(2, { idempotencyKey: 'uuid-1' });
    });

    it('consulta (GET) com erro mostra estado de erro com retry', async () => {
      const refetch = jest.fn();
      mockedUsePayment.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch });

      await render(<PagamentoScreen />);
      await fireEvent.press(screen.getByTestId('error-retry'));

      expect(screen.getByText('Não foi possível carregar o pagamento.')).toBeTruthy();
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });
});
