import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ArenaRole } from '@prisma/client';
import { ArenaAccessGuard } from './arena-access.guard';
import { ArenaMembersService } from './arena-members.service';
import { UsersService } from '../users/users.service';

function createContext(params: { arenaId?: string }, hasUser: boolean): ExecutionContext {
  const request = {
    params,
    user: hasUser ? { clerkId: 'clerk_123' } : undefined,
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('ArenaAccessGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let usersService: { findByClerkId: jest.Mock };
  let arenaMembersService: { assertAccess: jest.Mock };
  let guard: ArenaAccessGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue([]) };
    usersService = { findByClerkId: jest.fn().mockResolvedValue({ id: 'user-internal-1' }) };
    arenaMembersService = { assertAccess: jest.fn().mockResolvedValue(undefined) };

    guard = new ArenaAccessGuard(
      reflector as unknown as Reflector,
      usersService as unknown as UsersService,
      arenaMembersService as unknown as ArenaMembersService,
    );
  });

  it('resolve o User interno a partir do clerkId e delega ao ArenaMembersService', async () => {
    const context = createContext({ arenaId: 'arena-1' }, true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(usersService.findByClerkId).toHaveBeenCalledWith('clerk_123');
    expect(arenaMembersService.assertAccess).toHaveBeenCalledWith('user-internal-1', 'arena-1', []);
  });

  it('lê os papéis exigidos via @RequireArenaRole() e repassa ao ArenaMembersService', async () => {
    reflector.getAllAndOverride.mockReturnValue([ArenaRole.OWNER, ArenaRole.ADMIN]);
    const context = createContext({ arenaId: 'arena-1' }, true);

    await guard.canActivate(context);

    expect(arenaMembersService.assertAccess).toHaveBeenCalledWith('user-internal-1', 'arena-1', [
      ArenaRole.OWNER,
      ArenaRole.ADMIN,
    ]);
  });

  it('propaga a exceção lançada pelo ArenaMembersService (404/403)', async () => {
    const context = createContext({ arenaId: 'arena-1' }, true);
    const error = new Error('assert access failed');
    arenaMembersService.assertAccess.mockRejectedValue(error);

    await expect(guard.canActivate(context)).rejects.toBe(error);
  });

  it('lança erro se usado sem ClerkAuthGuard antes (request.user ausente)', async () => {
    const context = createContext({ arenaId: 'arena-1' }, false);

    await expect(guard.canActivate(context)).rejects.toThrow(
      /ArenaAccessGuard usado sem ClerkAuthGuard/,
    );
    expect(usersService.findByClerkId).not.toHaveBeenCalled();
  });
});
