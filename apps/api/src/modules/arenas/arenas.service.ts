import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ArenaRole, Prisma, Sport } from '@prisma/client';
import type { Court } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ArenaMembersService, ArenaMemberWithUser } from '../arena-members/arena-members.service';
import { UsersService } from '../users/users.service';
import { CreateArenaDto } from './dto/create-arena.dto';
import { UpdateArenaDto } from './dto/update-arena.dto';

export interface ArenaFields {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  // Presente na resposta desde a Fase 5 (Arena.timezone), só não estava
  // declarado aqui — corrigido agora que a Fase 6 passa a depender disso no
  // frontend.
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArenaSummary extends ArenaFields {
  role: ArenaRole;
}

export interface ArenaDetail extends ArenaFields {
  members: ArenaMemberWithUser[];
  courts: Court[];
}

// Visão pública de descoberta (Fase 6) — nunca inclui `members`/`role`
// (dados administrativos da Fase 3) nem quadras inativas. Deliberadamente
// mais enxuta que `ArenaDetail`: a listagem só precisa dos esportes
// oferecidos (derivados das quadras ativas), não da lista de quadras em si.
export interface ArenaDiscoverySummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sports: Sport[];
}

// Quadra como o cliente a vê — sem `arenaId`/`isActive` (implícito: só
// quadras ativas aparecem aqui, item 12 da Fase 6) nem qualquer dado
// administrativo.
export interface CourtPublic {
  id: string;
  name: string;
  sport: Sport;
  description: string | null;
  pricePerSlot: Prisma.Decimal;
  slotDurationMinutes: number;
  bufferMinutes: number;
}

export interface ArenaDiscoveryDetail extends ArenaFields {
  courts: CourtPublic[];
}

@Injectable()
export class ArenasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arenaMembersService: ArenaMembersService,
    private readonly usersService: UsersService,
  ) {}

  // O criador vira OWNER automaticamente, na mesma transação — nunca existe
  // um instante em que a arena tenha zero proprietários (ARCHITECTURE.md /
  // regra "uma arena deve possuir pelo menos um proprietário no fluxo de
  // criação").
  async create(dto: CreateArenaDto, clerkId: string): Promise<ArenaSummary> {
    const user = await this.usersService.findByClerkId(clerkId);

    try {
      const arena = await this.prisma.$transaction(async (tx) => {
        const created = await tx.arena.create({ data: dto });
        await tx.arenaMember.create({
          data: { arenaId: created.id, userId: user.id, role: ArenaRole.OWNER },
        });
        return created;
      });

      return { ...arena, role: ArenaRole.OWNER };
    } catch (error) {
      throw this.mapPrismaError(error);
    }
  }

  async findAllForUser(clerkId: string): Promise<ArenaSummary[]> {
    const user = await this.usersService.findByClerkId(clerkId);

    const memberships = await this.prisma.arenaMember.findMany({
      where: { userId: user.id },
      include: { arena: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({ ...membership.arena, role: membership.role }));
  }

  // Assume que o acesso já foi verificado pelo ArenaAccessGuard — aqui só
  // resolve os dados. O check de existência é mantido mesmo assim (defesa
  // extra barata, não duplica a decisão de autorização em si).
  async findOne(arenaId: string): Promise<ArenaDetail> {
    const arena = await this.prisma.arena.findUnique({
      where: { id: arenaId },
      include: { courts: true },
    });

    if (!arena) {
      throw new NotFoundException('Arena não encontrada.');
    }

    const members = await this.arenaMembersService.listMembers(arenaId);
    const { courts, ...fields } = arena;

    return { ...fields, courts, members };
  }

  // Descoberta pública (Fase 6) — deliberadamente separado de
  // `findAllForUser` ("minhas arenas", Fase 3): não exige ArenaMember, e
  // nunca expõe `role`/`members`. Sem paginação: a arquitetura ainda não
  // implementa paginação cursor-based em nenhum endpoint existente (Parte 9
  // do ARCHITECTURE.md a prevê como eventual) — não introduzida aqui só
  // para esta fase.
  async discoverAll(): Promise<ArenaDiscoverySummary[]> {
    const arenas = await this.prisma.arena.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        courts: { where: { isActive: true }, select: { sport: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return arenas.map(({ courts, ...fields }) => ({
      ...fields,
      sports: [...new Set(courts.map((court) => court.sport))],
    }));
  }

  async discoverOne(arenaId: string): Promise<ArenaDiscoveryDetail> {
    const arena = await this.prisma.arena.findUnique({
      where: { id: arenaId },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        phone: true,
        email: true,
        timezone: true,
        createdAt: true,
        updatedAt: true,
        courts: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            sport: true,
            description: true,
            pricePerSlot: true,
            slotDurationMinutes: true,
            bufferMinutes: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!arena) {
      throw new NotFoundException('Arena não encontrada.');
    }

    return arena;
  }

  async update(arenaId: string, dto: UpdateArenaDto): Promise<ArenaFields> {
    try {
      return await this.prisma.arena.update({ where: { id: arenaId }, data: dto });
    } catch (error) {
      throw this.mapPrismaError(error);
    }
  }

  private mapPrismaError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Já existe uma arena com este slug.');
    }
    return error as Error;
  }
}
