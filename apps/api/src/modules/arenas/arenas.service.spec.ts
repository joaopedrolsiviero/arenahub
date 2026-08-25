import { ConflictException, NotFoundException } from '@nestjs/common';
import { ArenaRole, Prisma, Sport } from '@prisma/client';
import { ArenasService } from './arenas.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ArenaMembersService } from '../arena-members/arena-members.service';
import { UsersService } from '../users/users.service';

describe('ArenasService', () => {
  let tx: { arena: { create: jest.Mock }; arenaMember: { create: jest.Mock } };
  let prisma: {
    $transaction: jest.Mock;
    arena: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    arenaMember: { findMany: jest.Mock };
  };
  let arenaMembersService: { listMembers: jest.Mock };
  let usersService: { findByClerkId: jest.Mock };
  let service: ArenasService;

  const dto = { name: 'Arena Central', slug: 'arena-central', timezone: 'America/Sao_Paulo' };

  beforeEach(() => {
    tx = {
      arena: { create: jest.fn() },
      arenaMember: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      arena: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      arenaMember: { findMany: jest.fn() },
    };
    arenaMembersService = { listMembers: jest.fn() };
    usersService = { findByClerkId: jest.fn().mockResolvedValue({ id: 'user-internal-1' }) };

    service = new ArenasService(
      prisma as unknown as PrismaService,
      arenaMembersService as unknown as ArenaMembersService,
      usersService as unknown as UsersService,
    );
  });

  describe('create', () => {
    it('cria a arena e o ArenaMember OWNER na mesma transação', async () => {
      const createdArena = { id: 'arena-1', ...dto, createdAt: new Date(), updatedAt: new Date() };
      tx.arena.create.mockResolvedValue(createdArena);

      const result = await service.create(dto, 'clerk_123');

      expect(usersService.findByClerkId).toHaveBeenCalledWith('clerk_123');
      expect(tx.arena.create).toHaveBeenCalledWith({ data: dto });
      expect(tx.arenaMember.create).toHaveBeenCalledWith({
        data: { arenaId: 'arena-1', userId: 'user-internal-1', role: ArenaRole.OWNER },
      });
      expect(result).toEqual({ ...createdArena, role: ArenaRole.OWNER });
    });

    it('converte violação de slug único em ConflictException', async () => {
      tx.arena.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('slug already exists', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );

      await expect(service.create(dto, 'clerk_123')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAllForUser', () => {
    it('retorna as arenas do usuário com o papel dele em cada uma', async () => {
      const arena = { id: 'arena-1', name: 'Arena Central' };
      prisma.arenaMember.findMany.mockResolvedValue([{ arena, role: ArenaRole.OWNER }]);

      const result = await service.findAllForUser('clerk_123');

      expect(prisma.arenaMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-internal-1' } }),
      );
      expect(result).toEqual([{ ...arena, role: ArenaRole.OWNER }]);
    });

    it('retorna lista vazia quando o usuário não pertence a nenhuma arena', async () => {
      prisma.arenaMember.findMany.mockResolvedValue([]);

      await expect(service.findAllForUser('clerk_123')).resolves.toEqual([]);
    });
  });

  describe('findOne', () => {
    it('lança NotFoundException quando a arena não existe', async () => {
      prisma.arena.findUnique.mockResolvedValue(null);

      await expect(service.findOne('arena-inexistente')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retorna arena com membros e quadras', async () => {
      prisma.arena.findUnique.mockResolvedValue({
        id: 'arena-1',
        name: 'Arena Central',
        courts: [{ id: 'court-1', name: 'Quadra 1' }],
      });
      arenaMembersService.listMembers.mockResolvedValue([
        { id: 'member-1', role: ArenaRole.OWNER },
      ]);

      const result = await service.findOne('arena-1');

      expect(result.courts).toEqual([{ id: 'court-1', name: 'Quadra 1' }]);
      expect(result.members).toEqual([{ id: 'member-1', role: ArenaRole.OWNER }]);
    });
  });

  describe('discoverAll', () => {
    it('deriva os esportes das quadras ativas e nunca inclui members/role', async () => {
      prisma.arena.findMany.mockResolvedValue([
        {
          id: 'arena-1',
          name: 'Arena Central',
          slug: 'arena-central',
          description: null,
          courts: [{ sport: Sport.BEACH_VOLLEYBALL }, { sport: Sport.BEACH_VOLLEYBALL }],
        },
      ]);

      const result = await service.discoverAll();

      expect(result).toEqual([
        {
          id: 'arena-1',
          name: 'Arena Central',
          slug: 'arena-central',
          description: null,
          sports: [Sport.BEACH_VOLLEYBALL],
        },
      ]);
      const [[call]] = prisma.arena.findMany.mock.calls as [
        [{ select: { courts: { where: { isActive: boolean } } } }],
      ];
      expect(call.select.courts.where).toEqual({ isActive: true });
    });
  });

  describe('discoverOne', () => {
    it('lança NotFoundException quando a arena não existe', async () => {
      prisma.arena.findUnique.mockResolvedValue(null);

      await expect(service.discoverOne('arena-inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('retorna a arena com as quadras ativas, sem members/role', async () => {
      const arena = {
        id: 'arena-1',
        name: 'Arena Central',
        slug: 'arena-central',
        description: null,
        phone: null,
        email: null,
        timezone: 'America/Sao_Paulo',
        createdAt: new Date(),
        updatedAt: new Date(),
        courts: [{ id: 'court-1', name: 'Quadra 1', sport: Sport.BEACH_VOLLEYBALL }],
      };
      prisma.arena.findUnique.mockResolvedValue(arena);

      const result = await service.discoverOne('arena-1');

      expect(result).toEqual(arena);
      const [[call]] = prisma.arena.findUnique.mock.calls as [
        [{ select: { courts: { where: { isActive: boolean } } } }],
      ];
      expect(call.select.courts.where).toEqual({ isActive: true });
    });

    it('nunca seleciona whatsappPhoneNumberId (Fase 16 — descoberta pública nunca expõe esse campo)', async () => {
      prisma.arena.findUnique.mockResolvedValue({
        id: 'arena-1',
        name: 'Arena Central',
        slug: 'arena-central',
        description: null,
        phone: null,
        email: null,
        timezone: 'America/Sao_Paulo',
        createdAt: new Date(),
        updatedAt: new Date(),
        courts: [],
      });

      await service.discoverOne('arena-1');

      const [[call]] = prisma.arena.findUnique.mock.calls as [
        [{ select: Record<string, unknown> }],
      ];
      expect(call.select).not.toHaveProperty('whatsappPhoneNumberId');
    });
  });

  describe('update', () => {
    it('atualiza os campos da arena', async () => {
      const updated = { id: 'arena-1', name: 'Novo nome' };
      prisma.arena.update.mockResolvedValue(updated);

      await expect(service.update('arena-1', { name: 'Novo nome' })).resolves.toEqual(updated);
    });

    it('converte violação de slug único em ConflictException', async () => {
      prisma.arena.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('slug already exists', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );

      await expect(service.update('arena-1', { name: 'X' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
