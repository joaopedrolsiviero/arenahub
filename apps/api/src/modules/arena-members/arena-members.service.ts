import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArenaRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';

export interface OwnershipTransferResult {
  arenaId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
  completedAt: Date;
}

export interface ArenaMemberWithUser {
  id: string;
  userId: string;
  role: ArenaRole;
  createdAt: Date;
  user: { id: string; name: string | null; email: string };
}

const MEMBER_SELECT = {
  id: true,
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

// Autorização por arena, centralizada aqui para nunca ser reimplementada
// (ou esquecida) em cada controller. "Authentication" (quem é o usuário) é
// resolvido pelo ClerkAuthGuard; este service resolve "authorization" (o que
// esse usuário pode fazer nesta arena), sempre a partir de ArenaMember.
//
// Fase 10: também passa a ser o dono da gestão de equipe (adicionar/alterar/
// remover ArenaMember) — mesma responsabilidade de domínio, não um novo
// módulo paralelo (item 60 do prompt da fase: minimalismo arquitetural).
@Injectable()
export class ArenaMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async getRole(userId: string, arenaId: string): Promise<ArenaRole | null> {
    const member = await this.prisma.arenaMember.findUnique({
      where: { arenaId_userId: { arenaId, userId } },
      select: { role: true },
    });
    return member?.role ?? null;
  }

  async isMember(userId: string, arenaId: string): Promise<boolean> {
    return (await this.getRole(userId, arenaId)) !== null;
  }

  async hasRole(userId: string, arenaId: string, roles: ArenaRole[]): Promise<boolean> {
    const role = await this.getRole(userId, arenaId);
    return role !== null && roles.includes(role);
  }

  async canManageArena(userId: string, arenaId: string): Promise<boolean> {
    return this.hasRole(userId, arenaId, [ArenaRole.OWNER, ArenaRole.ADMIN]);
  }

  /**
   * Usado pelo ArenaAccessGuard. Distingue deliberadamente dois erros
   * diferentes (ver docs/ARCHITECTURE.md, Fase 3):
   * - arena não existe -> 404 (NotFoundException)
   * - arena existe mas o usuário não é membro, ou é membro sem o papel
   *   exigido -> 403 (ForbiddenException)
   *
   * `requiredRoles` vazio significa "qualquer membro serve" (rotas de
   * leitura); não vazio exige um dos papéis listados (rotas de escrita).
   */
  async assertAccess(userId: string, arenaId: string, requiredRoles: ArenaRole[]): Promise<void> {
    const arena = await this.prisma.arena.findUnique({
      where: { id: arenaId },
      select: { id: true },
    });
    if (!arena) {
      throw new NotFoundException('Arena não encontrada.');
    }

    const role = await this.getRole(userId, arenaId);
    if (role === null) {
      throw new ForbiddenException('Você não tem acesso a esta arena.');
    }

    if (requiredRoles.length > 0 && !requiredRoles.includes(role)) {
      throw new ForbiddenException('Você não tem permissão para esta ação nesta arena.');
    }
  }

  async listMembers(arenaId: string): Promise<ArenaMemberWithUser[]> {
    return this.prisma.arenaMember.findMany({
      where: { arenaId },
      select: MEMBER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  // OWNER adiciona um usuário JÁ EXISTENTE como ADMIN (item 8/9 — sem
  // convite por email nesta fase). Identifica o usuário por e-mail, não por
  // userId: o OWNER nunca teria como conhecer o cuid interno de outra
  // pessoa, e isso evita criar qualquer endpoint de busca/enumeração de
  // usuários (item 28/29) — é um lookup exato, gated pela própria
  // autorização de OWNER da arena, não uma busca aberta.
  async addMember(arenaId: string, dto: AddMemberDto): Promise<ArenaMemberWithUser> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException('Não foi possível encontrar esse usuário.');
    }

    try {
      return await this.prisma.arenaMember.create({
        data: { arenaId, userId: user.id, role: ArenaRole.ADMIN },
        select: MEMBER_SELECT,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Este usuário já faz parte da equipe desta arena.');
      }
      throw error;
    }
  }

  // Só promove/mantém ADMIN (item 12) — a linha do OWNER nunca é um destino
  // válido aqui, transferência de ownership é deliberadamente fora de
  // escopo desta fase (item 16). `dto.role` só pode ser 'ADMIN' (único
  // valor aceito pelo próprio DTO), mas usamos o valor validado em vez de
  // hardcode — se este DTO ganhar mais valores um dia, o service já reflete
  // isso sem precisar de outra alteração aqui.
  async updateMemberRole(
    arenaId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<ArenaMemberWithUser> {
    const member = await this.prisma.arenaMember.findUnique({
      where: { arenaId_userId: { arenaId, userId: targetUserId } },
    });
    if (!member) {
      throw new NotFoundException('Membro não encontrado nesta arena.');
    }
    if (member.role === ArenaRole.OWNER) {
      throw new ForbiddenException('O proprietário da arena não pode ter o papel alterado.');
    }

    return this.prisma.arenaMember.update({
      where: { id: member.id },
      data: { role: dto.role },
      select: MEMBER_SELECT,
    });
  }

  // Regra combinada (ver docs/ARCHITECTURE.md, Fase 10 — o prompt desta fase
  // dizia simultaneamente "DELETE: somente OWNER" e "ADMIN pode remover a si
  // próprio"; a leitura consistente das duas é: qualquer membro pode chamar
  // a rota, mas só o OWNER remove OUTRO membro — um ADMIN só pode remover a
  // si mesmo. O OWNER nunca é removível, nem por si mesmo (item 15), o que
  // cai de graça da regra "role === OWNER nunca é removível" abaixo).
  async removeMember(
    arenaId: string,
    targetUserId: string,
    requesterClerkId: string,
  ): Promise<void> {
    const requester = await this.usersService.findByClerkId(requesterClerkId);
    const requesterRole = await this.getRole(requester.id, arenaId);

    const target = await this.prisma.arenaMember.findUnique({
      where: { arenaId_userId: { arenaId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException('Membro não encontrado nesta arena.');
    }
    if (target.role === ArenaRole.OWNER) {
      throw new ForbiddenException('O proprietário da arena não pode ser removido.');
    }
    if (requesterRole === ArenaRole.ADMIN && requester.id !== targetUserId) {
      throw new ForbiddenException('Você só pode remover a si mesmo da equipe.');
    }

    await this.prisma.arenaMember.delete({
      where: { arenaId_userId: { arenaId, userId: targetUserId } },
    });
  }

  // Fase 11 (item 43-55): operação explícita, nunca via PATCH /members —
  // troca de papel A(OWNER)->ADMIN e B(ADMIN)->OWNER, nunca deixando a
  // arena momentaneamente sem OWNER de forma persistida. Cada passo é um
  // `updateMany` condicionado ao papel ATUAL (compare-and-swap): sob duas
  // transferências concorrentes do mesmo OWNER, a segunda chega ao primeiro
  // `updateMany` depois que a primeira já commitou e mudou o papel do
  // requisitante — a condição `role: OWNER` não bate mais, count=0, aborta
  // com 403 em vez de prosseguir sobre um estado que não é mais verdade
  // (item 50). O índice único parcial da Fase 10 continua sendo a
  // autoridade final contra dois OWNER simultâneos.
  async transferOwnership(
    arenaId: string,
    dto: TransferOwnershipDto,
    requesterClerkId: string,
  ): Promise<OwnershipTransferResult> {
    const requester = await this.usersService.findByClerkId(requesterClerkId);

    if (dto.newOwnerUserId === requester.id) {
      throw new ConflictException('Você já é o proprietário desta arena.');
    }

    const completedAt = await this.prisma.$transaction(async (tx) => {
      const demoted = await tx.arenaMember.updateMany({
        where: { arenaId, userId: requester.id, role: ArenaRole.OWNER },
        data: { role: ArenaRole.ADMIN },
      });
      if (demoted.count === 0) {
        throw new ForbiddenException('Você não é o proprietário desta arena.');
      }

      // Destinatário precisa já ser ADMIN DESTA arena (itens 45-46, 52-53) —
      // a condição do WHERE cobre "não é membro", "é CUSTOMER" (sem linha),
      // "é membro de outra arena só" e "cross-tenant" com a MESMA checagem:
      // nenhum desses casos tem uma linha ArenaMember(arenaId, userId,
      // role=ADMIN) pra bater.
      const promoted = await tx.arenaMember.updateMany({
        where: { arenaId, userId: dto.newOwnerUserId, role: ArenaRole.ADMIN },
        data: { role: ArenaRole.OWNER },
      });
      if (promoted.count === 0) {
        throw new ConflictException('O novo proprietário precisa ser administrador desta arena.');
      }

      return new Date();
    });

    return {
      arenaId,
      previousOwnerUserId: requester.id,
      newOwnerUserId: dto.newOwnerUserId,
      completedAt,
    };
  }
}
