import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface IdempotencyParams {
  userId: string;
  /** Identificador lógico da operação (ex: "bookings.customer.create"), não a URL literal. */
  endpoint: string;
  key: string;
  /** Payload relevante da requisição — usado só para calcular o hash de comparação. */
  payload: unknown;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  /** true quando a resposta veio do cache (replay), false quando foi computada agora. */
  replayed: boolean;
}

type IdempotencyKeyRow = Prisma.IdempotencyKeyGetPayload<Record<string, never>>;

/**
 * Idempotência persistida no Postgres (nunca em memória, nunca dependente de
 * Redis — ver docs/ARCHITECTURE.md, Parte 8). Estratégia "claim-first": a
 * linha de IdempotencyKey é inserida (com um placeholder) ANTES de rodar o
 * handler, não depois.
 *
 * Isso importa porque o handler (BookingsService.create*) tem sua própria
 * proteção contra conflito (pg_advisory_xact_lock + pré-checagem +
 * EXCLUDE constraint). Se o registro de idempotência fosse feito só DEPOIS
 * do handler ("claim-last"), duas requisições concorrentes com a MESMA
 * chave (ex: retry automático de um cliente) acabariam serializadas pelo
 * advisory lock da própria quadra — e a segunda, ao ser liberada, veria a
 * reserva que a primeira acabou de commitar e a pré-checagem de conflito da
 * própria criação a rejeitaria com 409, achando que era OUTRA pessoa
 * disputando o mesmo horário. A idempotência precisa "vencer" essa corrida
 * ANTES do handler rodar, não depois — daí o claim-first: o INSERT da linha
 * (com userId+endpoint+key únicos) é o primeiro passo da transação. Duas
 * transações concorrentes com a mesma chave colidem exatamente aqui: a
 * segunda bloqueia no índice único até a primeira commitar, e então recebe
 * o erro de unicidade — sem nunca ter chegado a rodar o handler. Ela então
 * reverte por completo e replica a resposta (agora real, não mais
 * placeholder) que a vencedora gravou.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T>(
    params: IdempotencyParams,
    handler: (tx: Prisma.TransactionClient) => Promise<{ status: number; body: T }>,
  ): Promise<IdempotentResult<T>> {
    const { userId, endpoint, key, payload } = params;
    const requestHash = this.hashPayload(payload);

    const existing = await this.findExisting(userId, endpoint, key);
    if (existing) {
      return this.replayOrConflict<T>(existing, requestHash);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Placeholder: reserva a chave antes de saber o resultado real. Se
        // outra transação concorrente com a mesma chave já tiver reservado
        // (commitado) primeiro, este INSERT levanta violação de unicidade
        // aqui — antes do handler rodar.
        await tx.idempotencyKey.create({
          data: {
            key,
            userId,
            endpoint,
            requestHash,
            responseStatus: 0,
            responseBody: {},
          },
        });

        const result = await handler(tx);

        await tx.idempotencyKey.update({
          where: { userId_endpoint_key: { userId, endpoint, key } },
          data: {
            responseStatus: result.status,
            responseBody: result.body as Prisma.InputJsonValue,
          },
        });

        return { ...result, replayed: false };
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }

      // Ou perdemos a corrida de idempotência (a linha existe agora, com a
      // resposta real da vencedora — devolvemos ela), ou o P2002 veio de uma
      // constraint diferente disparada dentro do handler (ex: nome de quadra
      // duplicado) — nesse caso a transação inteira reverteu (inclusive
      // nosso próprio INSERT placeholder), nenhuma linha de idempotência
      // ficou de pé, e relançamos o erro original.
      const winner = await this.findExisting(userId, endpoint, key);
      if (!winner) {
        throw error;
      }
      return this.replayOrConflict<T>(winner, requestHash);
    }
  }

  private async findExisting(
    userId: string,
    endpoint: string,
    key: string,
  ): Promise<IdempotencyKeyRow | null> {
    return this.prisma.idempotencyKey.findUnique({
      where: { userId_endpoint_key: { userId, endpoint, key } },
    });
  }

  private replayOrConflict<T>(
    existing: IdempotencyKeyRow,
    requestHash: string,
  ): IdempotentResult<T> {
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Esta chave de idempotência já foi usada com um payload diferente.',
      );
    }
    return {
      status: existing.responseStatus,
      body: existing.responseBody as T,
      replayed: true,
    };
  }

  private hashPayload(payload: unknown): string {
    return createHash('sha256').update(this.canonicalize(payload)).digest('hex');
  }

  // JSON.stringify não garante ordem estável de chaves entre chamadas com o
  // mesmo conteúdo lógico em ordens diferentes — serializamos com chaves
  // ordenadas para que o hash dependa só do conteúdo, nunca da ordem.
  private canonicalize(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalize(item)).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const body = entries.map(([k, v]) => `${JSON.stringify(k)}:${this.canonicalize(v)}`).join(',');
    return `{${body}}`;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
