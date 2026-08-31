import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Weekday } from '@prisma/client';
import { OperatingHoursService } from './operating-hours.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('OperatingHoursService', () => {
  let tx: {
    arenaOperatingHours: { deleteMany: jest.Mock; createMany: jest.Mock; findMany: jest.Mock };
  };
  let prisma: {
    arena: { findUnique: jest.Mock };
    arenaOperatingHours: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: OperatingHoursService;

  beforeEach(() => {
    tx = {
      arenaOperatingHours: {
        deleteMany: jest.fn().mockResolvedValue(undefined),
        createMany: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    prisma = {
      arena: { findUnique: jest.fn().mockResolvedValue({ id: 'arena-1' }) },
      arenaOperatingHours: { findMany: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    service = new OperatingHoursService(prisma as unknown as PrismaService);
  });

  describe('getForArena', () => {
    it('lança NotFoundException quando a arena não existe', async () => {
      prisma.arena.findUnique.mockResolvedValue(null);

      await expect(service.getForArena('arena-inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('converte minutos crus para HH:mm na resposta', async () => {
      prisma.arenaOperatingHours.findMany.mockResolvedValue([
        { id: 'oh-1', dayOfWeek: Weekday.MONDAY, opensAt: 480, closesAt: 1080 },
      ]);

      const result = await service.getForArena('arena-1');

      expect(result).toEqual([
        { id: 'oh-1', dayOfWeek: Weekday.MONDAY, opensAt: '08:00', closesAt: '18:00' },
      ]);
    });
  });

  // Fase 33 — usado por `ArenasService.discoverAll` pra expor `isReady` na
  // listagem pública sem N+1 (uma consulta pra todas as arenas de uma vez).
  describe('hasAnyForArenas', () => {
    it('retorna um Set só com os ids que têm pelo menos um horário configurado', async () => {
      prisma.arenaOperatingHours.findMany.mockResolvedValue([
        { arenaId: 'arena-1' },
        { arenaId: 'arena-3' },
      ]);

      const result = await service.hasAnyForArenas(['arena-1', 'arena-2', 'arena-3']);

      expect(result).toEqual(new Set(['arena-1', 'arena-3']));
      expect(prisma.arenaOperatingHours.findMany).toHaveBeenCalledWith({
        where: { arenaId: { in: ['arena-1', 'arena-2', 'arena-3'] } },
        select: { arenaId: true },
        distinct: ['arenaId'],
      });
    });

    it('retorna um Set vazio sem consultar o banco quando a lista de ids está vazia', async () => {
      const result = await service.hasAnyForArenas([]);

      expect(result).toEqual(new Set());
      expect(prisma.arenaOperatingHours.findMany).not.toHaveBeenCalled();
    });
  });

  describe('replaceForArena', () => {
    it('valida, apaga e recria dentro da mesma transação', async () => {
      tx.arenaOperatingHours.findMany.mockResolvedValue([
        { id: 'oh-1', dayOfWeek: Weekday.MONDAY, opensAt: 480, closesAt: 1080 },
      ]);

      const result = await service.replaceForArena('arena-1', [
        { dayOfWeek: Weekday.MONDAY, opensAt: '08:00', closesAt: '18:00' },
      ]);

      expect(tx.arenaOperatingHours.deleteMany).toHaveBeenCalledWith({
        where: { arenaId: 'arena-1' },
      });
      expect(tx.arenaOperatingHours.createMany).toHaveBeenCalledWith({
        data: [{ arenaId: 'arena-1', dayOfWeek: Weekday.MONDAY, opensAt: 480, closesAt: 1080 }],
      });
      expect(result).toEqual([
        { id: 'oh-1', dayOfWeek: Weekday.MONDAY, opensAt: '08:00', closesAt: '18:00' },
      ]);
    });

    it('lista vazia apaga tudo sem chamar createMany (todos os dias ficam fechados)', async () => {
      await service.replaceForArena('arena-1', []);

      expect(tx.arenaOperatingHours.deleteMany).toHaveBeenCalledWith({
        where: { arenaId: 'arena-1' },
      });
      expect(tx.arenaOperatingHours.createMany).not.toHaveBeenCalled();
    });

    it('rejeita a operação inteira (sem tocar o banco) quando há um intervalo inválido', async () => {
      await expect(
        service.replaceForArena('arena-1', [
          { dayOfWeek: Weekday.MONDAY, opensAt: '18:00', closesAt: '08:00' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.arenaOperatingHours.deleteMany).not.toHaveBeenCalled();
    });

    it('lança NotFoundException quando a arena não existe', async () => {
      prisma.arena.findUnique.mockResolvedValue(null);

      await expect(
        service.replaceForArena('arena-inexistente', [
          { dayOfWeek: Weekday.MONDAY, opensAt: '08:00', closesAt: '18:00' },
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
