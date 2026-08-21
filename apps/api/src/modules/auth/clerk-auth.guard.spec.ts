import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ClerkAuthGuard } from './clerk-auth.guard';

function createContext(authorizationHeader?: string): {
  context: ExecutionContext;
  request: { headers: Record<string, string | undefined>; user?: unknown };
} {
  const request: { headers: Record<string, string | undefined>; user?: unknown } = {
    headers: { authorization: authorizationHeader },
  };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('ClerkAuthGuard', () => {
  let clerkService: { verifySessionToken: jest.Mock };
  let guard: ClerkAuthGuard;

  beforeEach(() => {
    clerkService = { verifySessionToken: jest.fn() };
    guard = new ClerkAuthGuard(clerkService);
  });

  it('rejeita quando não há header Authorization', async () => {
    const { context } = createContext(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clerkService.verifySessionToken).not.toHaveBeenCalled();
  });

  it('rejeita quando o header não é "Bearer <token>"', async () => {
    const { context } = createContext('Basic abc123');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clerkService.verifySessionToken).not.toHaveBeenCalled();
  });

  it('rejeita quando a verificação do token falha (assinatura inválida, expirado, etc.)', async () => {
    clerkService.verifySessionToken.mockRejectedValue(new Error('token expired'));
    const { context } = createContext('Bearer some.invalid.jwt');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('nunca vaza o motivo interno da falha de verificação', async () => {
    clerkService.verifySessionToken.mockRejectedValue(new Error('detalhe interno sensível'));
    const { context } = createContext('Bearer some.invalid.jwt');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      message: expect.not.stringContaining('detalhe interno sensível') as unknown,
    });
  });

  it('autentica e anexa o clerkId ao request quando o token é válido', async () => {
    clerkService.verifySessionToken.mockResolvedValue({ sub: 'user_123' });
    const { context, request } = createContext('Bearer valid.jwt.token');

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.user).toEqual({ clerkId: 'user_123' });
  });
});
