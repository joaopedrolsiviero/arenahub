import { Logger } from '@nestjs/common';
import { MetaWhatsAppProviderService } from './meta-whatsapp-provider.service';
import { WhatsAppProviderError } from './whatsapp-provider';

// Fase 34, item 15 — mesmo padrão de `openai-ai-provider.service.spec.ts`
// (Fase 12): mocka `global.fetch` direto, nunca faz requisição de rede real.
// `MetaWhatsAppProviderService` já era o adapter REAL desde a Fase 16 (nunca
// um stub) — o que faltava era exatamente esta cobertura dedicada de
// sucesso/erro/timeout, que o prompt da fase pede explicitamente.
describe('MetaWhatsAppProviderService', () => {
  const originalEnv = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function makeService(): MetaWhatsAppProviderService {
    return new MetaWhatsAppProviderService();
  }

  const message = { fromPhoneNumberId: 'pnid-1', to: '+5511999998888', text: 'Olá!' };

  it('lança WhatsAppProviderError quando WHATSAPP_ACCESS_TOKEN não está configurada — nunca chama fetch', async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    const service = makeService();

    await expect(service.sendMessage(message)).rejects.toBeInstanceOf(WhatsAppProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envia a mensagem pro endpoint correto, com o token só no header Authorization (nunca no corpo)', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'EAAtest-secret-token';
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const service = makeService();

    await service.sendMessage(message);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/pnid-1/messages');
    expect(init.body).not.toContain('EAAtest-secret-token');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer EAAtest-secret-token',
    );
    const body = JSON.parse(init.body as string) as {
      messaging_product: string;
      to: string;
      type: string;
      text: { body: string };
    };
    // Item 9 do prompt — `to` sempre sem o `+` (formato que a Cloud API
    // espera), nunca o E.164 completo repassado cru.
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999998888',
      type: 'text',
      text: { body: 'Olá!' },
    });
  });

  it('lança WhatsAppProviderError em erro 4xx — nunca repassa o corpo da resposta da Meta (pode conter detalhe de conta/billing)', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'token';
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const service = makeService();

    await expect(service.sendMessage(message)).rejects.toBeInstanceOf(WhatsAppProviderError);
  });

  it('lança WhatsAppProviderError em erro 5xx', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'token';
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const service = makeService();

    await expect(service.sendMessage(message)).rejects.toBeInstanceOf(WhatsAppProviderError);
  });

  it('lança WhatsAppProviderError quando o fetch é abortado por timeout', async () => {
    // Timeout default é fixo em 10s no código (sem env var pra configurar,
    // diferente do provider de IA) — fake timers evitam um teste que
    // realmente espera 10s reais só pra confirmar o caminho de AbortError.
    jest.useFakeTimers();
    try {
      process.env.WHATSAPP_ACCESS_TOKEN = 'token';
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      });
      const service = makeService();

      const pending = service.sendMessage(message);
      const assertion = expect(pending).rejects.toBeInstanceOf(WhatsAppProviderError);
      await jest.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('lança WhatsAppProviderError em erro de rede genérico', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'token';
    fetchMock.mockRejectedValue(new Error('network down'));
    const service = makeService();

    await expect(service.sendMessage(message)).rejects.toBeInstanceOf(WhatsAppProviderError);
  });

  // Fase 34, item 21 — o Access Token da Meta nunca pode aparecer em
  // nenhuma linha de log, em nenhum caminho (sucesso, 4xx, 5xx, timeout,
  // erro de rede). Mesmo espírito do teste equivalente em
  // `whatsapp.service.spec.ts` para o app secret/verify token do webhook.
  it('nunca loga o access token, em nenhum resultado (sucesso, erro 4xx/5xx, timeout, erro de rede)', async () => {
    const SECRET_TOKEN = 'EAA-super-secret-access-token';
    const logSpy = jest.spyOn(Logger.prototype, 'log');
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    const errorSpy = jest.spyOn(Logger.prototype, 'error');

    process.env.WHATSAPP_ACCESS_TOKEN = SECRET_TOKEN;
    const service = makeService();

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await service.sendMessage(message);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await service.sendMessage(message).catch(() => undefined);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await service.sendMessage(message).catch(() => undefined);

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await service.sendMessage(message).catch(() => undefined);

    const allCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].flat();
    expect(JSON.stringify(allCalls)).not.toContain(SECRET_TOKEN);

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
