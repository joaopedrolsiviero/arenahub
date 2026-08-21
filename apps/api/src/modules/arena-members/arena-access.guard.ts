import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ArenaRole } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { ArenaMembersService } from './arena-members.service';
import { REQUIRE_ARENA_ROLE_KEY } from './require-arena-role.decorator';
import type { AuthenticatedUser } from '../auth/clerk-auth.guard';

type RequestWithUser = Request & { user?: AuthenticatedUser };

/**
 * Roda depois do ClerkAuthGuard (`@UseGuards(ClerkAuthGuard, ArenaAccessGuard)`)
 * em toda rota com `:arenaId` no path. Resolve o `User` interno a partir do
 * `clerkId` já anexado ao request, e delega a decisão de acesso ao
 * ArenaMembersService — o guard em si não sabe nada sobre regras de negócio,
 * só orquestra "quem" + "qual arena" + "qual papel exigido".
 */
@Injectable()
export class ArenaAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
    private readonly arenaMembersService: ArenaMembersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles =
      this.reflector.getAllAndOverride<ArenaRole[]>(REQUIRE_ARENA_ROLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const arenaId = request.params.arenaId;

    if (!arenaId || Array.isArray(arenaId)) {
      // Programação incorreta (rota sem :arenaId, ou com :arenaId repetido,
      // usando este guard).
      throw new Error('ArenaAccessGuard usado em uma rota sem :arenaId válido.');
    }

    const authenticatedUser = request.user;
    if (!authenticatedUser) {
      // Programação incorreta (ArenaAccessGuard sem ClerkAuthGuard antes),
      // não erro de cliente — mesma lógica do @CurrentUser().
      throw new Error('ArenaAccessGuard usado sem ClerkAuthGuard antes na cadeia de guards.');
    }

    const user = await this.usersService.findByClerkId(authenticatedUser.clerkId);
    await this.arenaMembersService.assertAccess(user.id, arenaId, requiredRoles);

    return true;
  }
}
