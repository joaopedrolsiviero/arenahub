import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ArenaRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ArenaMemberWithUser {
  id: string;
  role: ArenaRole;
  createdAt: Date;
  user: { id: string; name: string | null; email: string };
}

// Autorização por arena, centralizada aqui para nunca ser reimplementada
// (ou esquecida) em cada controller. "Authentication" (quem é o usuário) é
// resolvido pelo ClerkAuthGuard; este service resolve "authorization" (o que
// esse usuário pode fazer nesta arena), sempre a partir de ArenaMember.
@Injectable()
export class ArenaMembersService {
  constructor(private readonly prisma: PrismaService) {}

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
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
