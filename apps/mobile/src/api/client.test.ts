import { apiRequest, ApiError, ApiNetworkError } from './client';

// jest.mock é hoisted pelo babel-jest para antes destes imports em tempo de
// build, independente da ordem no arquivo — escrito depois só para
// satisfazer import/first sem perder esse comportamento.
jest.mock('@/lib/env', () => ({
  env: { apiUrl: 'https://api.example.test/v1', clerkPublishableKey: 'pk_test_x' },
}));

describe('apiRequest', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('usa a EXPO_PUBLIC_API_URL centralizada como base', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{"ok":true}' });

    await apiRequest('/health');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('monta o header Authorization quando um token é passado', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'null' });

    await apiRequest('/users/me', { token: 'session-token-abc' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer session-token-abc');
  });

  it('nunca envia Authorization quando token é null', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'null' });

    await apiRequest('/arenas/discover', { token: null });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('converte uma resposta HTTP de erro em ApiError com o status real', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Reserva não encontrada.' }),
    });

    await expect(apiRequest('/users/me/bookings/x')).rejects.toMatchObject({
      status: 404,
      message: 'Reserva não encontrada.',
    });
    await expect(apiRequest('/users/me/bookings/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('converte falha de rede (sem resposta HTTP) em ApiNetworkError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(apiRequest('/health')).rejects.toBeInstanceOf(ApiNetworkError);
  });

  it('trata corpo vazio (204 ou texto vazio) como null, nunca lança', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    await expect(apiRequest('/users/me/bookings/x/payment')).resolves.toBeNull();
  });
});
