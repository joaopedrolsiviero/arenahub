import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ArenaRole, Prisma } from '@prisma/client';
import { InvitationsService } from './invitations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ArenaMembersService } from '../arena-members/arena-members.service';

describe('InvitationsService', () => {
  let tx: { arenaInvitation: { updateMany: jest.Mock }; arenaMember: { create: jest.Mock } };
  let prisma: {
    $transaction: jest.Mock;
    arenaInvitation: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    arena: { findUniqueOrThrow: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let usersService: { findByClerkId: jest.Mock };
  let arenaMembersService: { isMember: jest.Mock };
  let emailService: { sendInvitation: jest.Mock };
  let service: InvitationsService;

  beforeEach(() => {
    tx = { arenaInvitation: { updateMany: jest.fn() }, arenaMember: { create: jest.fn() } };
    prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      arenaInvitation: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      arena: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Arena Central' }) },
      user: { findUnique: jest.fn() },
    };
    usersService = { findByClerkId: jest.fn() };
    arenaMembersService = { isMember: jest.fn().mockResolvedValue(false) };
    emailService = { sendInvitation: jest.fn().mockResolvedValue(undefined) };

    service = new InvitationsService(
      prisma as unknown as PrismaService,
      usersService as unknown as UsersService,
      arenaMembersService as unknown as ArenaMembersService,
      emailService,
    );
  });

  describe('createInvitation', () => {
    beforeEach(() => {
      usersService.findByClerkId.mockResolvedValue({
        id: 'owner-1',
        name: 'Dona',
        email: 'dona@example.com',
      });
      prisma.arenaInvitation.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
    });

    it('normaliza o email (trim + lowercase) antes de criar e enviar', async () => {
      prisma.arenaInvitation.create.mockResolvedValue({
        id: 'inv-1',
        email: 'novo@example.com',
        role: ArenaRole.ADMIN,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        acceptedAt: null,
        revokedAt: null,
      });

      await service.createInvitation(
        'arena-1',
        { email: '  Novo@Example.com  ', role: 'ADMIN' },
        'clerk-owner',
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'novo@example.com' } });
      expect(prisma.arenaInvitation.create).toHaveBeenCalledWith({
        data: {
          arenaId: 'arena-1',
          email: 'novo@example.com',
          role: ArenaRole.ADMIN,
          tokenHash: expect.any(String) as string,
          expiresAt: expect.any(Date) as Date,
          invitedByUserId: 'owner-1',
        },
      });
      expect(emailService.sendInvitation).toHaveBeenCalledWith({
        to: 'novo@example.com',
        arenaName: 'Arena Central',
        invitedByName: 'Dona',
        acceptUrl: expect.any(String) as string,
        expiresAt: expect.any(Date) as Date,
      });
    });

    it('rejeita quando o email já pertence a um membro da arena (item 15-17)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
      arenaMembersService.isMember.mockResolvedValue(true);

      await expect(
        service.createInvitation(
          'arena-1',
          { email: 'membro@example.com', role: 'ADMIN' },
          'clerk-owner',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.arenaInvitation.create).not.toHaveBeenCalled();
    });

    it('rejeita quando já existe um convite aberto para o mesmo email (item 14)', async () => {
      prisma.arenaInvitation.findFirst.mockResolvedValue({ id: 'inv-existente' });

      await expect(
        service.createInvitation(
          'arena-1',
          { email: 'ja-convidado@example.com', role: 'ADMIN' },
          'clerk-owner',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.arenaInvitation.create).not.toHaveBeenCalled();
    });

    it('mapeia conflito de constraint (P2002) pra ConflictException amigável', async () => {
      prisma.arenaInvitation.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('conflito', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createInvitation(
          'arena-1',
          { email: 'corrida@example.com', role: 'ADMIN' },
          'clerk-owner',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('revokeInvitation', () => {
    it('revoga um convite pendente', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        arenaId: 'arena-1',
        acceptedAt: null,
        revokedAt: null,
      });
      prisma.arenaInvitation.updateMany.mockResolvedValue({ count: 1 });

      await service.revokeInvitation('arena-1', 'inv-1');

      expect(prisma.arenaInvitation.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', arenaId: 'arena-1', acceptedAt: null, revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });

    it('rejeita revogar um convite já aceito', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        arenaId: 'arena-1',
        acceptedAt: new Date(),
        revokedAt: null,
      });

      await expect(service.revokeInvitation('arena-1', 'inv-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('lança NotFoundException para convite de outra arena (nunca 403 — item 106)', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        arenaId: 'arena-outra',
        acceptedAt: null,
        revokedAt: null,
      });

      await expect(service.revokeInvitation('arena-1', 'inv-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('resendInvitation', () => {
    it('gera um novo token no mesmo registro para convite pendente/expirado', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        arenaId: 'arena-1',
        acceptedAt: null,
        revokedAt: null,
      });
      prisma.arenaInvitation.update.mockResolvedValue({
        id: 'inv-1',
        email: 'convidado@example.com',
        role: ArenaRole.ADMIN,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        acceptedAt: null,
        revokedAt: null,
        invitedBy: { id: 'owner-1', name: 'Dona', email: 'dona@example.com' },
      });

      await service.resendInvitation('arena-1', 'inv-1');

      expect(prisma.arenaInvitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { tokenHash: expect.any(String) as string, expiresAt: expect.any(Date) as Date },
        include: { invitedBy: { select: { id: true, name: true, email: true } } },
      });
      expect(emailService.sendInvitation).toHaveBeenCalled();
    });

    it('rejeita reenviar convite já aceito', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        arenaId: 'arena-1',
        acceptedAt: new Date(),
        revokedAt: null,
      });

      await expect(service.resendInvitation('arena-1', 'inv-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejeita reenviar convite revogado', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        arenaId: 'arena-1',
        acceptedAt: null,
        revokedAt: new Date(),
      });

      await expect(service.resendInvitation('arena-1', 'inv-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('getPublicByToken', () => {
    it('retorna 404 genérico pra token que não resolve a nenhum convite', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue(null);

      await expect(service.getPublicByToken('token-invalido')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deriva status EXPIRED quando expiresAt já passou', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue({
        role: ArenaRole.ADMIN,
        email: 'convidado@example.com',
        expiresAt: new Date(Date.now() - 1000),
        acceptedAt: null,
        revokedAt: null,
        arena: { id: 'arena-1', name: 'Arena Central' },
      });

      const result = await service.getPublicByToken('token-valido');
      expect(result.status).toBe('EXPIRED');
    });
  });

  describe('acceptInvitation', () => {
    const invitation = {
      id: 'inv-1',
      arenaId: 'arena-1',
      email: 'convidado@example.com',
      role: ArenaRole.ADMIN,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      acceptedAt: null,
      revokedAt: null,
    };

    it('aceita e cria o ArenaMember de forma atômica', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue(invitation);
      usersService.findByClerkId.mockResolvedValue({
        id: 'user-1',
        email: 'convidado@example.com',
      });
      tx.arenaInvitation.updateMany.mockResolvedValue({ count: 1 });

      await service.acceptInvitation('token-valido', 'clerk-convidado');

      expect(tx.arenaMember.create).toHaveBeenCalledWith({
        data: { arenaId: 'arena-1', userId: 'user-1', role: ArenaRole.ADMIN },
      });
    });

    it('rejeita quando o email autenticado é diferente do convidado (item 26)', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue(invitation);
      usersService.findByClerkId.mockResolvedValue({
        id: 'user-2',
        email: 'outra-pessoa@example.com',
      });

      await expect(
        service.acceptInvitation('token-valido', 'clerk-outra-pessoa'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.arenaMember.create).not.toHaveBeenCalled();
    });

    it('rejeita convite expirado', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue({
        ...invitation,
        expiresAt: new Date(Date.now() - 1000),
      });
      usersService.findByClerkId.mockResolvedValue({
        id: 'user-1',
        email: 'convidado@example.com',
      });

      await expect(
        service.acceptInvitation('token-expirado', 'clerk-convidado'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejeita convite revogado', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue({ ...invitation, revokedAt: new Date() });
      usersService.findByClerkId.mockResolvedValue({
        id: 'user-1',
        email: 'convidado@example.com',
      });

      await expect(
        service.acceptInvitation('token-revogado', 'clerk-convidado'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejeita reuso de token já aceito (fora da corrida)', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue({
        ...invitation,
        acceptedAt: new Date(),
      });
      usersService.findByClerkId.mockResolvedValue({
        id: 'user-1',
        email: 'convidado@example.com',
      });

      await expect(
        service.acceptInvitation('token-usado', 'clerk-convidado'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('concorrência: duas aceitações do mesmo token — a segunda falha (updateMany count=0)', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue(invitation);
      usersService.findByClerkId.mockResolvedValue({
        id: 'user-1',
        email: 'convidado@example.com',
      });
      tx.arenaInvitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.acceptInvitation('token-valido', 'clerk-convidado'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.arenaMember.create).not.toHaveBeenCalled();
    });

    it('rejeita quando o usuário já é membro da arena', async () => {
      prisma.arenaInvitation.findUnique.mockResolvedValue(invitation);
      usersService.findByClerkId.mockResolvedValue({
        id: 'user-1',
        email: 'convidado@example.com',
      });
      arenaMembersService.isMember.mockResolvedValue(true);

      await expect(
        service.acceptInvitation('token-valido', 'clerk-convidado'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
