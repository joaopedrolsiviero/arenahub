import { Request, Response } from 'express';
import { requestIdMiddleware } from './request-id.middleware';
import { RequestContext } from './request-context';

function fakeReq(headers: Record<string, string | undefined>): Request {
  return { headers } as unknown as Request;
}

function fakeRes(): Response & { setHeader: jest.Mock } {
  return { setHeader: jest.fn() } as unknown as Response & { setHeader: jest.Mock };
}

describe('requestIdMiddleware (Fase 18, item 9)', () => {
  it('gera um UUID quando não há X-Request-Id no header', () => {
    const res = fakeRes();
    const next = jest.fn();

    requestIdMiddleware(fakeReq({}), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const [, value] = res.setHeader.mock.calls[0] as [string, string];
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('ecoa um X-Request-Id externo que já é seguro (alfanumérico, curto)', () => {
    const res = fakeRes();
    requestIdMiddleware(fakeReq({ 'x-request-id': 'trace-abc-123' }), res, jest.fn());

    const [, value] = res.setHeader.mock.calls[0] as [string, string];
    expect(value).toBe('trace-abc-123');
  });

  it('nunca ecoa um X-Request-Id externo com caracteres perigosos para log', () => {
    const res = fakeRes();
    requestIdMiddleware(
      fakeReq({ 'x-request-id': 'id com espaço\ne quebra de linha' }),
      res,
      jest.fn(),
    );

    const [, value] = res.setHeader.mock.calls[0] as [string, string];
    expect(value).not.toContain(' ');
    expect(value).not.toContain('\n');
  });

  it('nunca ecoa um X-Request-Id externo maior que 128 caracteres', () => {
    const res = fakeRes();
    requestIdMiddleware(fakeReq({ 'x-request-id': 'a'.repeat(200) }), res, jest.fn());

    const [, value] = res.setHeader.mock.calls[0] as [string, string];
    expect(value.length).toBeLessThan(200);
  });

  it('disponibiliza o requestId via RequestContext dentro do next()', () => {
    const res = fakeRes();
    let seenInsideNext: string | undefined;

    requestIdMiddleware(fakeReq({ 'x-request-id': 'trace-xyz' }), res, () => {
      seenInsideNext = RequestContext.getRequestId();
    });

    expect(seenInsideNext).toBe('trace-xyz');
  });
});
