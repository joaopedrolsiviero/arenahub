import { CallHandler, ExecutionContext, NotFoundException } from '@nestjs/common';
import { of, throwError, firstValueFrom } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

function fakeContext(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', path: '/v1/health', query: { secret: 'nunca-logado' } }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
}

describe('LoggingInterceptor (Fase 18, item 8)', () => {
  it('deixa a resposta de sucesso passar inalterada', async () => {
    const interceptor = new LoggingInterceptor();
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    const result = await firstValueFrom(interceptor.intercept(fakeContext(), handler));
    expect(result).toEqual({ ok: true });
  });

  it('propaga o erro original sem transformá-lo (o filtro global decide o corpo da resposta)', async () => {
    const interceptor = new LoggingInterceptor();
    const original = new NotFoundException('Recurso não encontrado.');
    const handler: CallHandler = { handle: () => throwError(() => original) };

    await expect(firstValueFrom(interceptor.intercept(fakeContext(), handler))).rejects.toBe(
      original,
    );
  });
});
