import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ArenaRole } from '@prisma/client';
import { ArenaMembersService } from './arena-members.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ArenaMembersService', () => {
  let prisma: {
    arenaMember: { findUnique: jest.Mock; findMany: jest.Mock };
    arena: { findUnique: jest.Mock };
  };
  let service: ArenaMembersService;

  beforeEach(() => {
    prisma = {
      arenaMember: { findUnique: jest.fn(), findMany: jest.fn() },
      arena: { findUnique: jest.fn() },
    };
    service = new ArenaMembersService(prisma as unknown as PrismaService);
  });

  describe('getRole / isMember / hasRole / canManageArena', () => {
    it('getRole retorna null quando não há associação', async () => {
      prisma.arenaMember.findUnique.mockResolvedValue(null);
      await expect(service.getRole('user-1', 'arena-1')).resolves.toBeNull();
    });

    it('isMember é false quando getRole é null', async () => {
      prisma.arenaMember.findUnique.mockResolvedValue(null);
      await expect(service.isMember('user-1', 'arena-1')).resolves.toBe(false);
    });

    it('isMember é true quando existe associação', async () => {
      prisma.arenaMember.findUnique.mockResolvedValue({ role: ArenaRole.ADMIN });
      await expect(service.isMember('user-1', 'arena-1')).resolves.toBe(true);
    });

    it('hasRole é true só quando o papel bate com a lista exigida', async () => {
      prisma.arenaMember.findUnique.mockResolvedValue({ role: ArenaRole.ADMIN });
      await expect(
        service.hasRole('user-1', 'arena-1', [ArenaRole.OWNER, ArenaRole.ADMIN]),
      ).resolves.toBe(true);
      await expect(service.hasRole('user-1', 'arena-1', [ArenaRole.OWNER])).resolves.toBe(false);
    });

    it('canManageArena é true para OWNER e ADMIN, false para não-membro', async () => {
      prisma.arenaMember.findUnique.mockResolvedValueOnce({ role: ArenaRole.OWNER });
      await expect(service.canManageArena('user-1', 'arena-1')).resolves.toBe(true);

      prisma.arenaMember.findUnique.mockResolvedValueOnce({ role: ArenaRole.ADMIN });
      await expect(service.canManageArena('user-1', 'arena-1')).resolves.toBe(true);

      prisma.arenaMember.findUnique.mockResolvedValueOnce(null);
      await expect(service.canManageArena('user-1', 'arena-1')).resolves.toBe(false);
    });
  });

  describe('assertAccess', () => {
    it('lança NotFoundException quando a arena não existe', async () => {
      prisma.arena.findUnique.mockResolvedValue(null);

      await expect(service.assertAccess('user-1', 'arena-inexistente', [])).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.arenaMember.findUnique).not.toHaveBeenCalled();
    });

    it('lança ForbiddenException quando a arena existe mas o usuário não é membro', async () => {
      prisma.arena.findUnique.mockResolvedValue({ id: 'arena-1' });
      prisma.arenaMember.findUnique.mockResolvedValue(null);

      await expect(service.assertAccess('user-1', 'arena-1', [])).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lança ForbiddenException quando o membro não tem o papel exigido', async () => {
      prisma.arena.findUnique.mockResolvedValue({ id: 'arena-1' });
      prisma.arenaMember.findUnique.mockResolvedValue({ role: ArenaRole.ADMIN });

      await expect(
        service.assertAccess('user-1', 'arena-1', [ArenaRole.OWNER]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolve sem lançar quando o papel exigido está vazio e o usuário é membro', async () => {
      prisma.arena.findUnique.mockResolvedValue({ id: 'arena-1' });
      prisma.arenaMember.findUnique.mockResolvedValue({ role: ArenaRole.ADMIN });

      await expect(service.assertAccess('user-1', 'arena-1', [])).resolves.toBeUndefined();
    });

    it('resolve sem lançar quando o membro tem o papel exigido', async () => {
      prisma.arena.findUnique.mockResolvedValue({ id: 'arena-1' });
      prisma.arenaMember.findUnique.mockResolvedValue({ role: ArenaRole.OWNER });

      await expect(
        service.assertAccess('user-1', 'arena-1', [ArenaRole.OWNER, ArenaRole.ADMIN]),
      ).resolves.toBeUndefined();
    });
  });
});
