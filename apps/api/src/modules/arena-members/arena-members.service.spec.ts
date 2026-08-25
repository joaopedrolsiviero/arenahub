import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ArenaRole, Prisma } from '@prisma/client';
import { ArenaMembersService } from './arena-members.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';

describe('ArenaMembersService', () => {
  let tx: { arenaMember: { updateMany: jest.Mock } };
  let prisma: {
    $transaction: jest.Mock;
    arenaMember: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    arena: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let usersService: { findByClerkId: jest.Mock };
  let service: ArenaMembersService;

  beforeEach(() => {
    tx = { arenaMember: { updateMany: jest.fn() } };
    prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      arenaMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      arena: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    usersService = { findByClerkId: jest.fn() };
    service = new ArenaMembersService(
      prisma as unknown as PrismaService,
      usersService as unknown as UsersService,
    );
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

  describe('listMembers', () => {
    it('lista membros da arena ordenados por createdAt', async () => {
      const members = [{ id: 'm1', userId: 'u1', role: ArenaRole.OWNER, createdAt: new Date() }];
      prisma.arenaMember.findMany.mockResolvedValue(members);

      await expect(service.listMembers('arena-1')).resolves.toBe(members);
      expect(prisma.arenaMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { arenaId: 'arena-1' }, orderBy: { createdAt: 'asc' } }),
      );
    });
  });

  describe('addMember', () => {
    it('adiciona um usuário existente como ADMIN', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2', email: 'novo@example.com' });
      const created = { id: 'm2', userId: 'user-2', role: ArenaRole.ADMIN, createdAt: new Date() };
      prisma.arenaMember.create.mockResolvedValue(created);

      const result = await service.addMember('arena-1', {
        email: 'novo@example.com',
        role: 'ADMIN',
      });

      expect(result).toBe(created);
      expect(prisma.arenaMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { arenaId: 'arena-1', userId: 'user-2', role: ArenaRole.ADMIN },
        }),
      );
    });

    it('normaliza o email para minúsculas antes de buscar', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.addMember('arena-1', { email: 'Novo@Example.com', role: 'ADMIN' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'novo@example.com' } });
    });

    it('lança NotFoundException quando o usuário não existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.addMember('arena-1', { email: 'inexistente@example.com', role: 'ADMIN' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.arenaMember.create).not.toHaveBeenCalled();
    });

    it('lança ConflictException quando o usuário já é membro (P2002)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2', email: 'ja-membro@example.com' });
      prisma.arenaMember.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('conflito', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.addMember('arena-1', { email: 'ja-membro@example.com', role: 'ADMIN' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateMemberRole', () => {
    it('mantém/atualiza como ADMIN um membro existente que não é OWNER', async () => {
      prisma.arenaMember.findUnique.mockResolvedValue({ id: 'm2', role: ArenaRole.ADMIN });
      const updated = { id: 'm2', userId: 'user-2', role: ArenaRole.ADMIN, createdAt: new Date() };
      prisma.arenaMember.update.mockResolvedValue(updated);

      const result = await service.updateMemberRole('arena-1', 'user-2', { role: 'ADMIN' });

      expect(result).toBe(updated);
      expect(prisma.arenaMember.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'm2' }, data: { role: ArenaRole.ADMIN } }),
      );
    });

    it('lança NotFoundException quando o membro não existe nesta arena', async () => {
      prisma.arenaMember.findUnique.mockResolvedValue(null);

      await expect(
        service.updateMemberRole('arena-1', 'user-inexistente', { role: 'ADMIN' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lança ForbiddenException ao tentar alterar o papel do OWNER', async () => {
      prisma.arenaMember.findUnique.mockResolvedValue({ id: 'm1', role: ArenaRole.OWNER });

      await expect(
        service.updateMemberRole('arena-1', 'owner-user', { role: 'ADMIN' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.arenaMember.update).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('OWNER remove um ADMIN com sucesso', async () => {
      usersService.findByClerkId.mockResolvedValue({ id: 'owner-user' });
      prisma.arenaMember.findUnique
        .mockResolvedValueOnce({ role: ArenaRole.OWNER }) // getRole do requester
        .mockResolvedValueOnce({ id: 'm2', role: ArenaRole.ADMIN }); // membro alvo

      await service.removeMember('arena-1', 'admin-user', 'clerk-owner');

      expect(prisma.arenaMember.delete).toHaveBeenCalledWith({
        where: { arenaId_userId: { arenaId: 'arena-1', userId: 'admin-user' } },
      });
    });

    it('nunca permite remover o OWNER, nem por si mesmo', async () => {
      usersService.findByClerkId.mockResolvedValue({ id: 'owner-user' });
      prisma.arenaMember.findUnique
        .mockResolvedValueOnce({ role: ArenaRole.OWNER }) // getRole do requester
        .mockResolvedValueOnce({ id: 'm1', role: ArenaRole.OWNER }); // alvo é o próprio OWNER

      await expect(
        service.removeMember('arena-1', 'owner-user', 'clerk-owner'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.arenaMember.delete).not.toHaveBeenCalled();
    });

    it('ADMIN não pode remover outro membro', async () => {
      usersService.findByClerkId.mockResolvedValue({ id: 'admin-user' });
      prisma.arenaMember.findUnique
        .mockResolvedValueOnce({ role: ArenaRole.ADMIN }) // getRole do requester
        .mockResolvedValueOnce({ id: 'm3', role: ArenaRole.ADMIN }); // outro ADMIN

      await expect(
        service.removeMember('arena-1', 'outro-admin', 'clerk-admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.arenaMember.delete).not.toHaveBeenCalled();
    });

    it('ADMIN pode remover a si mesmo (self-removal)', async () => {
      usersService.findByClerkId.mockResolvedValue({ id: 'admin-user' });
      prisma.arenaMember.findUnique
        .mockResolvedValueOnce({ role: ArenaRole.ADMIN }) // getRole do requester
        .mockResolvedValueOnce({ id: 'm2', role: ArenaRole.ADMIN }); // ele mesmo

      await service.removeMember('arena-1', 'admin-user', 'clerk-admin');

      expect(prisma.arenaMember.delete).toHaveBeenCalledWith({
        where: { arenaId_userId: { arenaId: 'arena-1', userId: 'admin-user' } },
      });
    });

    it('lança NotFoundException quando o alvo não é membro desta arena', async () => {
      usersService.findByClerkId.mockResolvedValue({ id: 'owner-user' });
      prisma.arenaMember.findUnique
        .mockResolvedValueOnce({ role: ArenaRole.OWNER })
        .mockResolvedValueOnce(null);

      await expect(
        service.removeMember('arena-1', 'nao-e-membro', 'clerk-owner'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('transferOwnership', () => {
    beforeEach(() => {
      usersService.findByClerkId.mockResolvedValue({ id: 'owner-user' });
    });

    it('OWNER transfere para um ADMIN da mesma arena', async () => {
      tx.arenaMember.updateMany
        .mockResolvedValueOnce({ count: 1 }) // demote do requester
        .mockResolvedValueOnce({ count: 1 }); // promote do destinatário

      const result = await service.transferOwnership(
        'arena-1',
        { newOwnerUserId: 'admin-user' },
        'clerk-owner',
      );

      expect(result).toMatchObject({
        arenaId: 'arena-1',
        previousOwnerUserId: 'owner-user',
        newOwnerUserId: 'admin-user',
      });
      expect(tx.arenaMember.updateMany).toHaveBeenNthCalledWith(1, {
        where: { arenaId: 'arena-1', userId: 'owner-user', role: ArenaRole.OWNER },
        data: { role: ArenaRole.ADMIN },
      });
      expect(tx.arenaMember.updateMany).toHaveBeenNthCalledWith(2, {
        where: { arenaId: 'arena-1', userId: 'admin-user', role: ArenaRole.ADMIN },
        data: { role: ArenaRole.OWNER },
      });
    });

    it('rejeita quando o requisitante não é (mais) o OWNER', async () => {
      tx.arenaMember.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.transferOwnership('arena-1', { newOwnerUserId: 'admin-user' }, 'clerk-owner'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejeita quando o destinatário não é ADMIN desta arena (não-membro, CUSTOMER ou cross-tenant)', async () => {
      tx.arenaMember.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await expect(
        service.transferOwnership('arena-1', { newOwnerUserId: 'nao-membro' }, 'clerk-owner'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejeita self-transfer sem tocar no banco', async () => {
      await expect(
        service.transferOwnership('arena-1', { newOwnerUserId: 'owner-user' }, 'clerk-owner'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
