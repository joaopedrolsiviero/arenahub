import { OpenAiAiProviderService } from './openai-ai-provider.service';
import { AiInvalidResponseError, AiProviderUnavailableError, AiTimeoutError } from './ai-provider';

describe('OpenAiAiProviderService', () => {
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

  function makeService(): OpenAiAiProviderService {
    return new OpenAiAiProviderService();
  }

  it('lança AiProviderUnavailableError quando AI_PROVIDER_API_KEY não está configurada — nunca chama fetch', async () => {
    delete process.env.AI_PROVIDER_API_KEY;
    const service = makeService();

    await expect(service.generate({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
      AiProviderUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nunca inclui a API key no corpo da requisição — só no header Authorization', async () => {
    process.env.AI_PROVIDER_API_KEY = 'sk-test-secret-key';
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
    });
    const service = makeService();

    await service.generate({ systemPrompt: 's', userPrompt: 'u' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).not.toContain('sk-test-secret-key');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-test-secret-key',
    );
  });

  it('envia system e user prompt como mensagens separadas', async () => {
    process.env.AI_PROVIDER_API_KEY = 'sk-test';
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'resposta' } }] }),
    });
    const service = makeService();

    const result = await service.generate({ systemPrompt: 'sistema', userPrompt: 'pergunta' });

    expect(result.text).toBe('resposta');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages).toEqual([
      { role: 'system', content: 'sistema' },
      { role: 'user', content: 'pergunta' },
    ]);
  });

  it('lança AiProviderUnavailableError quando o provider responde com status de erro', async () => {
    process.env.AI_PROVIDER_API_KEY = 'sk-test';
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const service = makeService();

    await expect(service.generate({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
      AiProviderUnavailableError,
    );
  });

  it('lança AiInvalidResponseError quando a resposta não tem conteúdo utilizável', async () => {
    process.env.AI_PROVIDER_API_KEY = 'sk-test';
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ choices: [] }) });
    const service = makeService();

    await expect(service.generate({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
      AiInvalidResponseError,
    );
  });

  it('lança AiTimeoutError quando o fetch é abortado por timeout', async () => {
    process.env.AI_PROVIDER_API_KEY = 'sk-test';
    process.env.AI_PROVIDER_TIMEOUT_MS = '10';
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

    await expect(service.generate({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
      AiTimeoutError,
    );
  });

  it('lança AiProviderUnavailableError em erro de rede genérico', async () => {
    process.env.AI_PROVIDER_API_KEY = 'sk-test';
    fetchMock.mockRejectedValue(new Error('network down'));
    const service = makeService();

    await expect(service.generate({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
      AiProviderUnavailableError,
    );
  });

  it('usa o modelo default (gpt-4o-mini) quando AI_PROVIDER_MODEL não está definida', async () => {
    process.env.AI_PROVIDER_API_KEY = 'sk-test';
    delete process.env.AI_PROVIDER_MODEL;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
    });
    const service = makeService();

    await service.generate({ systemPrompt: 's', userPrompt: 'u' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe('gpt-4o-mini');
  });
});
