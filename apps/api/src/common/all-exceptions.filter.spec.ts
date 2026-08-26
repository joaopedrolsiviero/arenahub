import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

function fakeHost(): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => ({}),
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('mensagem interna do driver', {
    code,
    clientVersion: '6.2.1',
  });
}

describe('AllExceptionsFilter (Fase 18, itens 7/8)', () => {
  let reply: jest.Mock;
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    reply = jest.fn();
    const httpAdapterHost = { httpAdapter: { reply } } as unknown as HttpAdapterHost;
    filter = new AllExceptionsFilter(httpAdapterHost);
  });

  it('deixa uma HttpException já intencional passar com o mesmo status/corpo', () => {
    const exception = new BadRequestException('Mensagem já segura para o cliente.');
    filter.catch(exception, fakeHost());

    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      exception.getResponse(),
      exception.getStatus(),
    );
  });

  it('mapeia Prisma P2025 (registro não encontrado) para 404 genérico, sem detalhe interno', () => {
    filter.catch(prismaError('P2025'), fakeHost());

    const [, body, status] = reply.mock.calls[0] as [unknown, { message: string }, number];
    expect(status).toBe(404);
    expect(body.message).not.toContain('mensagem interna do driver');
  });

  it('mapeia Prisma P2002 (violação de unicidade) para 409 genérico', () => {
    filter.catch(prismaError('P2002'), fakeHost());

    const [, body, status] = reply.mock.calls[0] as [unknown, { message: string }, number];
    expect(status).toBe(409);
    expect(body.message).not.toContain('mensagem interna do driver');
  });

  it('qualquer erro inesperado vira 500 genérico, nunca expõe stack/message original', () => {
    filter.catch(new Error('detalhe interno sensível: senha=123'), fakeHost());

    const [, body, status] = reply.mock.calls[0] as [unknown, { message: string }, number];
    expect(status).toBe(500);
    expect(body.message).not.toContain('sensível');
    expect(body.message).not.toContain('senha');
  });

  it('valores não-Error (ex: string lançada) também caem no 500 genérico sem vazar o valor', () => {
    filter.catch('algum valor jogado diretamente', fakeHost());

    const [, body, status] = reply.mock.calls[0] as [unknown, { message: string }, number];
    expect(status).toBe(500);
    expect(body.message).not.toContain('algum valor jogado diretamente');
  });
});
