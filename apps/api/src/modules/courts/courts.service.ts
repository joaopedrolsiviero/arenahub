import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Court } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';

@Injectable()
export class CourtsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(arenaId: string, dto: CreateCourtDto): Promise<Court> {
    try {
      return await this.prisma.court.create({ data: { ...dto, arenaId } });
    } catch (error) {
      throw this.mapPrismaError(error);
    }
  }

  async findAllForArena(arenaId: string, includeInactive: boolean): Promise<Court[]> {
    return this.prisma.court.findMany({
      where: { arenaId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { createdAt: 'asc' },
    });
  }

  // `findFirst` com arenaId no WHERE (não `findUnique` por courtId sozinho)
  // é o que garante que uma quadra de outra arena nunca "vaza" por aqui —
  // ver docs/ARCHITECTURE.md, Fase 3, e o teste de segurança correspondente.
  async findOne(arenaId: string, courtId: string): Promise<Court> {
    const court = await this.prisma.court.findFirst({ where: { id: courtId, arenaId } });

    if (!court) {
      throw new NotFoundException('Quadra não encontrada.');
    }

    return court;
  }

  async update(arenaId: string, courtId: string, dto: UpdateCourtDto): Promise<Court> {
    // Garante o mesmo escopo por arena antes de atualizar (reaproveita
    // findOne em vez de duplicar a checagem).
    await this.findOne(arenaId, courtId);

    // `imageUrl: ''` é o sinal do formulário pra "remover a foto" (o DTO
    // aceita string vazia só pra isso, ver create-court.dto.ts) — nunca
    // persistido como string vazia, sempre convertido pra `null`.
    // `undefined` (campo não enviado) passa direto: Prisma ignora campos
    // `undefined` num update, nunca zera o que não foi tocado.
    const data = { ...dto, imageUrl: dto.imageUrl === '' ? null : dto.imageUrl };

    try {
      return await this.prisma.court.update({ where: { id: courtId }, data });
    } catch (error) {
      throw this.mapPrismaError(error);
    }
  }

  private mapPrismaError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Já existe uma quadra com este nome nesta arena.');
    }
    return error as Error;
  }
}
