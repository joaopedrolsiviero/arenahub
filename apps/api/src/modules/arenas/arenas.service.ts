import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ArenaRole, PaymentMode, Prisma, Sport } from '@prisma/client';
import type { Court } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ArenaMembersService, ArenaMemberWithUser } from '../arena-members/arena-members.service';
import { OperatingHoursService } from '../operating-hours/operating-hours.service';
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
  // Fase 16 — nunca exposto pelos endpoints de descoberta pública
  // (`ArenaDiscoveryDetail` abaixo é um tipo deliberadamente separado, sem
  // este campo), só nas respostas administrativas (OWNER/ADMIN) já
  // protegidas por `ArenaAccessGuard`.
  whatsappPhoneNumberId: string | null;
  // Ao contrário de `whatsappPhoneNumberId`, este campo é PÚBLICO
  // deliberadamente — o cliente final (nunca autenticado como membro da
  // arena) precisa saber, antes de confirmar uma reserva, se vai ser
  // levado ao pagamento online ou se o pagamento é presencial.
  paymentMode: PaymentMode;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArenaSummary extends ArenaFields {
  role: ArenaRole;
}

// Fase 28 — deliberadamente DERIVADO em cada leitura, nunca persistido
// (`Arena.isSetupComplete` foi considerado e descartado: tudo aqui já é
// calculável a partir de dados que já existem — Court.isActive/pricePerSlot
// e a presença de ArenaOperatingHours — então uma coluna redundante só
// criaria uma segunda fonte de verdade pra manter sincronizada). Cada campo
// é exposto separadamente (não só `isReady`) pra alimentar o checklist do
// dashboard sem o frontend precisar recalcular a mesma lógica sozinho.
export interface ArenaSetupStatus {
  // Sempre true hoje — nome e timezone já são obrigatórios na criação da
  // arena (CreateArenaDto). Mantido explícito (não hardcoded `true` na
  // resposta) porque é exatamente o item "✓ Dados básicos" do checklist, e
  // documenta a intenção mesmo que hoje seja trivial.
  hasBasicInfo: boolean;
  // Pelo menos uma Court ativa com pricePerSlot > 0 — preço zerado (default
  // do schema) nunca conta como "configurado", só como "ainda não definido".
  hasActiveCourtWithPricing: boolean;
  // Pelo menos uma linha em ArenaOperatingHours — zero linhas = arena
  // fechada todo dia (comportamento já existente desde a Fase 5), nunca
  // reservável de fato mesmo com quadra e preço configurados.
  hasOperatingHours: boolean;
  isReady: boolean;
}

export interface ArenaDetail extends ArenaFields {
  members: ArenaMemberWithUser[];
  courts: Court[];
  setupStatus: ArenaSetupStatus;
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
  // Fase 33 — mesmo booleano final de `ArenaDiscoveryDetail.isReady`
  // (nunca o checklist granular, que é informação do OWNER), agora também
  // na listagem: sem isso, o visitante só descobria que uma arena ainda
  // está em configuração DEPOIS de clicar nela.
  isReady: boolean;
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
  imageUrl: string | null;
}

// Omit<..., 'whatsappPhoneNumberId'>: descoberta pública nunca expõe esse
// campo (Fase 16) — `discoverOne` nem o seleciona no Prisma, então o tipo
// precisa refletir isso, não só a intenção em prosa.
export interface ArenaDiscoveryDetail extends Omit<ArenaFields, 'whatsappPhoneNumberId'> {
  courts: CourtPublic[];
  // Fase 28 — só o booleano final, nunca o checklist granular
  // (`ArenaSetupStatus`) exposto ao público: o motivo exato de uma arena
  // não estar pronta é informação operacional do OWNER, não do cliente.
  // Usado pra distinguir "esta arena ainda está sendo configurada" de um
  // erro genérico na página pública.
  isReady: boolean;
}

@Injectable()
export class ArenasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arenaMembersService: ArenaMembersService,
    private readonly operatingHoursService: OperatingHoursService,
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

    const [members, hasOperatingHours] = await Promise.all([
      this.arenaMembersService.listMembers(arenaId),
      this.operatingHoursService.hasAnyForArena(arenaId),
    ]);
    const { courts, ...fields } = arena;
    const setupStatus = this.computeSetupStatus(fields, courts, hasOperatingHours);

    return { ...fields, courts, members, setupStatus };
  }

  // Fase 28 — única implementação da regra "o que falta pra essa arena
  // aceitar reservas de verdade"; reutilizada tanto pelo checklist
  // administrativo (`findOne`) quanto pelo sinal público (`discoverOne`),
  // nunca duas versões da mesma lógica.
  private computeSetupStatus(
    arena: Pick<ArenaFields, 'name' | 'timezone'>,
    courts: Pick<Court, 'isActive' | 'pricePerSlot'>[],
    hasOperatingHours: boolean,
  ): ArenaSetupStatus {
    const hasBasicInfo = Boolean(arena.name) && Boolean(arena.timezone);
    const hasActiveCourtWithPricing = courts.some(
      (court) => court.isActive && court.pricePerSlot.greaterThan(0),
    );
    return {
      hasBasicInfo,
      hasActiveCourtWithPricing,
      hasOperatingHours,
      isReady: hasBasicInfo && hasActiveCourtWithPricing && hasOperatingHours,
    };
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
        courts: { where: { isActive: true }, select: { sport: true, pricePerSlot: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Uma única consulta pra todas as arenas (nunca N+1) — mesma regra de
    // `computeSetupStatus`/`discoverByWhere`: só conta "pronta" quem tem
    // quadra ativa com preço válido E pelo menos um horário configurado.
    const arenasWithHours = await this.operatingHoursService.hasAnyForArenas(
      arenas.map((arena) => arena.id),
    );

    return arenas.map(({ courts, ...fields }) => ({
      ...fields,
      sports: [...new Set(courts.map((court) => court.sport))],
      isReady:
        courts.some((court) => court.pricePerSlot.greaterThan(0)) && arenasWithHours.has(fields.id),
    }));
  }

  async discoverOne(arenaId: string): Promise<ArenaDiscoveryDetail> {
    return this.discoverByWhere({ id: arenaId });
  }

  // Fase 32 — URL pública canônica passa a ser `/arenas/:slug` (item já
  // existente no schema desde sempre, nunca usado como rota até aqui). Mesma
  // forma de resposta de `discoverOne`, só muda a cláusula de busca — nunca
  // duas implementações da mesma projeção/regra de `isReady`.
  async discoverBySlug(slug: string): Promise<ArenaDiscoveryDetail> {
    return this.discoverByWhere({ slug });
  }

  private async discoverByWhere(
    where: Prisma.ArenaWhereUniqueInput,
  ): Promise<ArenaDiscoveryDetail> {
    const arena = await this.prisma.arena.findUnique({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        phone: true,
        email: true,
        timezone: true,
        paymentMode: true,
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
            imageUrl: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!arena) {
      throw new NotFoundException('Arena não encontrada.');
    }

    // `courts` aqui já veio filtrado `isActive: true` no select acima —
    // basta checar preço, mesma regra de `computeSetupStatus` (sem
    // reimplementar o `.some(isActive && pricePerSlot>0)` duas vezes).
    const hasOperatingHours = await this.operatingHoursService.hasAnyForArena(arena.id);
    const isReady =
      arena.courts.some((court) => court.pricePerSlot.greaterThan(0)) && hasOperatingHours;

    return { ...arena, isReady };
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
