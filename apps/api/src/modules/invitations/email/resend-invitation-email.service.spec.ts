import { ResendInvitationEmailService } from './resend-invitation-email.service';
import { InvitationEmailPayload } from './invitation-email.service';

function payload(overrides: Partial<InvitationEmailPayload> = {}): InvitationEmailPayload {
  return {
    to: 'convidado@example.com',
    arenaName: 'Arena Central',
    invitedByName: 'Dona',
    acceptUrl: 'https://app.sivierotech.com.br/convites/token-secreto-abc123',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe('ResendInvitationEmailService', () => {
  let service: ResendInvitationEmailService;
  let fetchMock: jest.Mock;
  let loggedMessages: string[];

  beforeEach(() => {
    process.env.RESEND_API_KEY = 'resend-test-key';
    service = new ResendInvitationEmailService();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    loggedMessages = [];
    const logger = service['logger'];
    const capture = (message: unknown) => {
      loggedMessages.push(String(message));
    };
    jest.spyOn(logger, 'log').mockImplementation(capture);
    jest.spyOn(logger, 'error').mockImplementation(capture);
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    jest.restoreAllMocks();
  });

  describe('sucesso', () => {
    it('chama a API do Resend com remetente, destinatário, assunto e URL corretos', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'email-1' }) });

      await service.sendInvitation(payload());

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer resend-test-key',
            'Content-Type': 'application/json',
          }) as Record<string, string>,
        }),
      );

      const call = fetchMock.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(call[1].body) as {
        from: string;
        to: string[];
        subject: string;
        html: string;
      };
      expect(body.from).toBe('ArenaHub <convites@sivierotech.com.br>');
      expect(body.to).toEqual(['convidado@example.com']);
      expect(body.subject).toContain('Arena Central');
      expect(body.html).toContain('https://app.sivierotech.com.br/convites/token-secreto-abc123');
      expect(body.html).toContain('Arena Central');
    });

    it('nunca inclui o token (nem a URL completa) em nenhuma linha de log', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'email-1' }) });

      await service.sendInvitation(payload());

      const allLoggedText = loggedMessages.join('\n');
      expect(allLoggedText).not.toContain('token-secreto-abc123');
      expect(allLoggedText).not.toContain('resend-test-key');
    });
  });

  describe('falha', () => {
    it('provider retorna erro (não-ok): lança erro sanitizado, nunca vaza o corpo bruto da resposta', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ message: 'domain not verified: detalhe interno da conta' }),
      });

      await expect(service.sendInvitation(payload())).rejects.toThrow();
    });

    it('timeout do provider: lança erro claro, nunca trava indefinidamente', async () => {
      process.env.RESEND_TIMEOUT_MS = '5';
      fetchMock.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(
              () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              20,
            );
          }),
      );

      await expect(service.sendInvitation(payload())).rejects.toThrow(/timeout/i);
      delete process.env.RESEND_TIMEOUT_MS;
    });

    it('falha de rede: lança erro sanitizado', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(service.sendInvitation(payload())).rejects.toThrow();
    });
  });

  describe('sem RESEND_API_KEY configurada', () => {
    it('nunca chama o Resend e nunca lança — degrada pro comportamento do ConsoleInvitationEmailService', async () => {
      delete process.env.RESEND_API_KEY;

      await expect(service.sendInvitation(payload())).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
