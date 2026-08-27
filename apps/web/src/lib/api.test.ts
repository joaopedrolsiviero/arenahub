import { api, ApiError } from './api';

// `text()` é o que `request()` realmente usa desde a Fase 23 (ver
// justificativa em api.ts) — `json()` continua aqui só porque
// `extractErrorMessage` (chamado em respostas de erro) ainda usa `.json()`
// diretamente.
function mockFetchOnce(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// Reproduz o comportamento real do Nest pra um controller que retorna
// `null` (ex: GET .../payment sem nenhuma tentativa) — corpo LITERALMENTE
// vazio (Content-Length: 0), não a string "null". Um `.json()` real do
// browser lançaria `SyntaxError` nesse caso — daí `request()` ler `.text()`
// primeiro (Fase 23).
function mockFetchEmptyBody(status: number) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    text: () => Promise.resolve(''),
  });
}

describe('api.createBooking', () => {
  it('envia o token no header Authorization e a chave no Idempotency-Key', async () => {
    const fetchMock = mockFetchOnce(201, { id: 'booking-1' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await api.createBooking('token-abc', 'arena-1', 'court-1', '2026-09-07T13:00:00.000Z', 'key-123');

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/arenas/arena-1/courts/court-1/bookings');
    expect(options.method).toBe('POST');
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-abc');
    expect(headers['Idempotency-Key']).toBe('key-123');
  });

  it('lança ApiError com status e mensagem em respostas de erro (ex: 409)', async () => {
    global.fetch = mockFetchOnce(409, { message: 'Horário fora do funcionamento da arena.' }) as unknown as typeof fetch;

    await expect(
      api.createBooking('token-abc', 'arena-1', 'court-1', '2026-09-07T13:00:00.000Z', 'key-123'),
    ).rejects.toMatchObject({ status: 409, message: 'Horário fora do funcionamento da arena.' });
  });

  it('erro é uma instância de ApiError', async () => {
    global.fetch = mockFetchOnce(500, { message: 'Erro interno' }) as unknown as typeof fetch;

    await expect(
      api.createBooking('token-abc', 'arena-1', 'court-1', '2026-09-07T13:00:00.000Z', 'key-123'),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('api.getBookingPayment (Fase 23 — corpo vazio do backend)', () => {
  it('quando nunca houve tentativa de pagamento, o backend devolve corpo vazio e o client trata como null, sem lançar', async () => {
    global.fetch = mockFetchEmptyBody(200) as unknown as typeof fetch;

    await expect(api.getBookingPayment('token-abc', 'booking-1')).resolves.toBeNull();
  });

  it('quando há um pagamento real, devolve o objeto normalmente', async () => {
    const payment = { id: 'payment-1', bookingId: 'booking-1', status: 'PENDING', amount: '100' };
    global.fetch = mockFetchOnce(200, payment) as unknown as typeof fetch;

    await expect(api.getBookingPayment('token-abc', 'booking-1')).resolves.toEqual(payment);
  });
});

describe('api sem token', () => {
  it('não envia header Authorization quando o token é null', async () => {
    const fetchMock = mockFetchOnce(200, []);
    global.fetch = fetchMock as unknown as typeof fetch;

    await api.discoverArenas(null);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
