import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdempotencyService } from './idempotency.service';
import { PrismaService } from '../../prisma/prisma.service';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('IdempotencyService', () => {
  let prisma: {
    idempotencyKey: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: IdempotencyService;

  beforeEach(() => {
    prisma = {
      idempotencyKey: { findUnique: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new IdempotencyService(prisma as unknown as PrismaService);
  });

  const params = {
    userId: 'u1',
    endpoint: 'bookings.customer.create',
    key: 'k1',
    payload: { a: 1 },
  };

  it('executa o handler e persiste a resposta quando não há chave prévia (claim-first: create antes, update depois)', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    const callOrder: string[] = [];
    const tx = {
      idempotencyKey: {
        create: jest.fn().mockImplementation(() => {
          callOrder.push('create');
          return Promise.resolve(undefined);
        }),
        update: jest.fn().mockImplementation(() => {
          callOrder.push('update');
          return Promise.resolve(undefined);
        }),
      },
    };
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const handler = jest.fn().mockImplementation(() => {
      callOrder.push('handler');
      return Promise.resolve({ status: 201, body: { id: 'b1' } });
    });
    const result = await service.execute(params, handler);

    // claim-first: o placeholder é reservado ANTES do handler rodar, e só
    // atualizado com a resposta real depois — essa ordem é o que evita a
    // corrida com a proteção de conflito do próprio handler sob concorrência
    // real (ver comentário em idempotency.service.ts).
    expect(callOrder).toEqual(['create', 'handler', 'update']);
    expect(handler).toHaveBeenCalledWith(tx);
    expect(tx.idempotencyKey.create).toHaveBeenCalledWith({
      data: {
        key: 'k1',
        userId: 'u1',
        endpoint: 'bookings.customer.create',
        requestHash: service['hashPayload'](params.payload),
        responseStatus: 0,
        responseBody: {},
      },
    });
    expect(tx.idempotencyKey.update).toHaveBeenCalledWith({
      where: {
        userId_endpoint_key: { userId: 'u1', endpoint: 'bookings.customer.create', key: 'k1' },
      },
      data: { responseStatus: 201, responseBody: { id: 'b1' } },
    });
    expect(result).toEqual({ status: 201, body: { id: 'b1' }, replayed: false });
  });

  it('replica a resposta em cache quando a chave já existe com o mesmo payload', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: service['hashPayload'](params.payload),
      responseStatus: 201,
      responseBody: { id: 'b1' },
    });

    const handler = jest.fn();
    const result = await service.execute(params, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 201, body: { id: 'b1' }, replayed: true });
  });

  it('lança ConflictException quando a chave já existe com payload diferente', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: 'hash-de-outro-payload',
      responseStatus: 201,
      responseBody: { id: 'b1' },
    });

    await expect(service.execute(params, jest.fn())).rejects.toBeInstanceOf(ConflictException);
  });

  it('sob corrida: perdedora reverte e replica a resposta da vencedora', async () => {
    prisma.idempotencyKey.findUnique
      .mockResolvedValueOnce(null) // checagem inicial: ninguém ainda
      .mockResolvedValueOnce({
        requestHash: service['hashPayload'](params.payload),
        responseStatus: 201,
        responseBody: { id: 'winner' },
      }); // segunda checagem, após perder a corrida: linha da vencedora

    prisma.$transaction.mockRejectedValue(uniqueViolation());

    const handler = jest.fn().mockResolvedValue({ status: 201, body: { id: 'loser' } });
    const result = await service.execute(params, handler);

    expect(result).toEqual({ status: 201, body: { id: 'winner' }, replayed: true });
  });

  it('sob corrida com payload diferente do vencedor: 409, não replay silencioso', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      requestHash: 'hash-diferente',
      responseStatus: 201,
      responseBody: { id: 'winner' },
    });
    prisma.$transaction.mockRejectedValue(uniqueViolation());

    await expect(
      service.execute(params, jest.fn().mockResolvedValue({ status: 201, body: {} })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('P2002 vindo de outra constraint do handler (não da idempotência) é relançado sem mascarar', async () => {
    prisma.idempotencyKey.findUnique
      .mockResolvedValueOnce(null) // checagem inicial
      .mockResolvedValueOnce(null); // segunda checagem: ninguém commitou (não era corrida de idempotência)

    const originalError = uniqueViolation();
    prisma.$transaction.mockRejectedValue(originalError);

    await expect(
      service.execute(params, jest.fn().mockResolvedValue({ status: 201, body: {} })),
    ).rejects.toBe(originalError);
  });

  it('erros que não são violação de unicidade são relançados imediatamente, sem nova checagem', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValueOnce(null);
    const otherError = new Error('falha inesperada');
    prisma.$transaction.mockRejectedValue(otherError);

    await expect(
      service.execute(params, jest.fn().mockResolvedValue({ status: 201, body: {} })),
    ).rejects.toBe(otherError);
    expect(prisma.idempotencyKey.findUnique).toHaveBeenCalledTimes(1);
  });

  it('o hash é independente da ordem das chaves do payload', () => {
    const h1 = service['hashPayload']({ a: 1, b: 2 });
    const h2 = service['hashPayload']({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it('o hash muda quando o conteúdo do payload muda', () => {
    const h1 = service['hashPayload']({ a: 1 });
    const h2 = service['hashPayload']({ a: 2 });
    expect(h1).not.toBe(h2);
  });
});
