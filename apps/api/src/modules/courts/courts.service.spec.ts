import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, Sport } from '@prisma/client';
import { CourtsService } from './courts.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CourtsService', () => {
  let prisma: {
    court: { create: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  };
  let service: CourtsService;

  const dto = { name: 'Quadra 1', sport: Sport.BEACH_VOLLEYBALL };

  beforeEach(() => {
    prisma = {
      court: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new CourtsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('cria a quadra vinculada à arena', async () => {
      const created = { id: 'court-1', arenaId: 'arena-1', ...dto };
      prisma.court.create.mockResolvedValue(created);

      await expect(service.create('arena-1', dto)).resolves.toEqual(created);
      expect(prisma.court.create).toHaveBeenCalledWith({
        data: { ...dto, arenaId: 'arena-1' },
      });
    });

    it('converte nome duplicado na mesma arena em ConflictException', async () => {
      prisma.court.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );

      await expect(service.create('arena-1', dto)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAllForArena', () => {
    it('por padrão retorna só quadras ativas', async () => {
      prisma.court.findMany.mockResolvedValue([]);

      await service.findAllForArena('arena-1', false);

      expect(prisma.court.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { arenaId: 'arena-1', isActive: true } }),
      );
    });

    it('com includeInactive=true retorna todas', async () => {
      prisma.court.findMany.mockResolvedValue([]);

      await service.findAllForArena('arena-1', true);

      expect(prisma.court.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { arenaId: 'arena-1' } }),
      );
    });
  });

  describe('findOne', () => {
    it('lança NotFoundException quando a quadra não existe na arena informada', async () => {
      prisma.court.findFirst.mockResolvedValue(null);

      await expect(service.findOne('arena-1', 'court-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.court.findFirst).toHaveBeenCalledWith({
        where: { id: 'court-x', arenaId: 'arena-1' },
      });
    });

    it('lança NotFoundException quando a quadra pertence a outra arena (IDOR)', async () => {
      // findFirst com { id, arenaId } simplesmente não encontra nada quando
      // o courtId é de outra arena — é isso que este teste garante.
      prisma.court.findFirst.mockResolvedValue(null);

      await expect(service.findOne('arena-A', 'court-da-arena-B')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('retorna a quadra quando pertence à arena informada', async () => {
      const court = { id: 'court-1', arenaId: 'arena-1', ...dto };
      prisma.court.findFirst.mockResolvedValue(court);

      await expect(service.findOne('arena-1', 'court-1')).resolves.toEqual(court);
    });
  });

  describe('update', () => {
    it('atualiza campos da quadra quando ela pertence à arena', async () => {
      const court = { id: 'court-1', arenaId: 'arena-1', ...dto };
      prisma.court.findFirst.mockResolvedValue(court);
      prisma.court.update.mockResolvedValue({ ...court, isActive: false });

      const result = await service.update('arena-1', 'court-1', { isActive: false });

      expect(result.isActive).toBe(false);
      expect(prisma.court.update).toHaveBeenCalledWith({
        where: { id: 'court-1' },
        data: { isActive: false },
      });
    });

    it('lança NotFoundException ao tentar atualizar quadra de outra arena', async () => {
      prisma.court.findFirst.mockResolvedValue(null);

      await expect(
        service.update('arena-A', 'court-da-arena-B', { isActive: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.court.update).not.toHaveBeenCalled();
    });

    it('permite reativar uma quadra desativada', async () => {
      const court = { id: 'court-1', arenaId: 'arena-1', ...dto, isActive: false };
      prisma.court.findFirst.mockResolvedValue(court);
      prisma.court.update.mockResolvedValue({ ...court, isActive: true });

      const result = await service.update('arena-1', 'court-1', { isActive: true });

      expect(result.isActive).toBe(true);
    });
  });
});
