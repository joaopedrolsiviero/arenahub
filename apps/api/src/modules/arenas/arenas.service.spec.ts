import { ConflictException, NotFoundException } from '@nestjs/common';
import { ArenaRole, Prisma, Sport } from '@prisma/client';
import { ArenasService } from './arenas.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ArenaMembersService } from '../arena-members/arena-members.service';
import { OperatingHoursService } from '../operating-hours/operating-hours.service';
import { UsersService } from '../users/users.service';

describe('ArenasService', () => {
  let tx: { arena: { create: jest.Mock }; arenaMember: { create: jest.Mock } };
  let prisma: {
    $transaction: jest.Mock;
    arena: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    arenaMember: { findMany: jest.Mock };
  };
  let arenaMembersService: { listMembers: jest.Mock };
  let operatingHoursService: { hasAnyForArena: jest.Mock; hasAnyForArenas: jest.Mock };
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
    operatingHoursService = {
      hasAnyForArena: jest.fn().mockResolvedValue(false),
      hasAnyForArenas: jest.fn().mockResolvedValue(new Set()),
    };
    usersService = { findByClerkId: jest.fn().mockResolvedValue({ id: 'user-internal-1' }) };

    service = new ArenasService(
      prisma as unknown as PrismaService,
      arenaMembersService as unknown as ArenaMembersService,
      operatingHoursService as unknown as OperatingHoursService,
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
        timezone: 'America/Sao_Paulo',
        courts: [{ id: 'court-1', name: 'Quadra 1', isActive: false, pricePerSlot: undefined }],
      });
      arenaMembersService.listMembers.mockResolvedValue([
        { id: 'member-1', role: ArenaRole.OWNER },
      ]);

      const result = await service.findOne('arena-1');

      expect(result.courts).toEqual([
        { id: 'court-1', name: 'Quadra 1', isActive: false, pricePerSlot: undefined },
      ]);
      expect(result.members).toEqual([{ id: 'member-1', role: ArenaRole.OWNER }]);
    });

    // Fase 28, Caso 6/7: "arena pronta" é SEMPRE derivado (nunca lido de uma
    // coluna) — estes casos provam a derivação nos dois sentidos, incompleta
    // e completa, e que cada item do checklist é reportado individualmente
    // (não só o booleano final).
    it('Fase 28: arena sem quadra ativa/preço e sem horários é reportada como incompleta, item a item', async () => {
      prisma.arena.findUnique.mockResolvedValue({
        id: 'arena-1',
        name: 'Arena Central',
        timezone: 'America/Sao_Paulo',
        courts: [],
      });
      arenaMembersService.listMembers.mockResolvedValue([]);
      operatingHoursService.hasAnyForArena.mockResolvedValue(false);

      const result = await service.findOne('arena-1');

      expect(result.setupStatus).toEqual({
        hasBasicInfo: true,
        hasActiveCourtWithPricing: false,
        hasOperatingHours: false,
        isReady: false,
      });
    });

    it('Fase 28: quadra ativa com preço R$0 (default do schema) nunca conta como "configurada"', async () => {
      prisma.arena.findUnique.mockResolvedValue({
        id: 'arena-1',
        name: 'Arena Central',
        timezone: 'America/Sao_Paulo',
        courts: [{ id: 'court-1', isActive: true, pricePerSlot: new Prisma.Decimal(0) }],
      });
      arenaMembersService.listMembers.mockResolvedValue([]);
      operatingHoursService.hasAnyForArena.mockResolvedValue(true);

      const result = await service.findOne('arena-1');

      expect(result.setupStatus.hasActiveCourtWithPricing).toBe(false);
      expect(result.setupStatus.isReady).toBe(false);
    });

    it('Fase 28: quadra inativa com preço válido nunca conta como "configurada" (só quadra ATIVA)', async () => {
      prisma.arena.findUnique.mockResolvedValue({
        id: 'arena-1',
        name: 'Arena Central',
        timezone: 'America/Sao_Paulo',
        courts: [{ id: 'court-1', isActive: false, pricePerSlot: new Prisma.Decimal(50) }],
      });
      arenaMembersService.listMembers.mockResolvedValue([]);
      operatingHoursService.hasAnyForArena.mockResolvedValue(true);

      const result = await service.findOne('arena-1');

      expect(result.setupStatus.hasActiveCourtWithPricing).toBe(false);
      expect(result.setupStatus.isReady).toBe(false);
    });

    it('Fase 28: quadra ativa com preço válido + horários configurados => arena pronta', async () => {
      prisma.arena.findUnique.mockResolvedValue({
        id: 'arena-1',
        name: 'Arena Central',
        timezone: 'America/Sao_Paulo',
        courts: [{ id: 'court-1', isActive: true, pricePerSlot: new Prisma.Decimal(50) }],
      });
      arenaMembersService.listMembers.mockResolvedValue([]);
      operatingHoursService.hasAnyForArena.mockResolvedValue(true);

      const result = await service.findOne('arena-1');

      expect(result.setupStatus).toEqual({
        hasBasicInfo: true,
        hasActiveCourtWithPricing: true,
        hasOperatingHours: true,
        isReady: true,
      });
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
          courts: [
            { sport: Sport.BEACH_VOLLEYBALL, pricePerSlot: new Prisma.Decimal(50) },
            { sport: Sport.BEACH_VOLLEYBALL, pricePerSlot: new Prisma.Decimal(50) },
          ],
        },
      ]);
      operatingHoursService.hasAnyForArenas.mockResolvedValue(new Set(['arena-1']));

      const result = await service.discoverAll();

      expect(result).toEqual([
        {
          id: 'arena-1',
          name: 'Arena Central',
          slug: 'arena-central',
          description: null,
          sports: [Sport.BEACH_VOLLEYBALL],
          isReady: true,
        },
      ]);
      const [[call]] = prisma.arena.findMany.mock.calls as [
        [{ select: { courts: { where: { isActive: boolean } } } }],
      ];
      expect(call.select.courts.where).toEqual({ isActive: true });
    });

    // Fase 33 — a listagem pública passou a expor `isReady` (item 2 do
    // prompt da fase: o visitante precisa saber ANTES de clicar se a arena
    // já aceita reservas). Mesma regra de `discoverByWhere`/
    // `computeSetupStatus`: preço zerado nunca conta, e falta de horário
    // configurado também deixa a arena não-pronta mesmo com preço válido.
    it('Fase 33: isReady=false quando não há quadra com preço válido, mesmo com horários configurados', async () => {
      prisma.arena.findMany.mockResolvedValue([
        {
          id: 'arena-1',
          name: 'Arena Central',
          slug: 'arena-central',
          description: null,
          courts: [{ sport: Sport.BEACH_VOLLEYBALL, pricePerSlot: new Prisma.Decimal(0) }],
        },
      ]);
      operatingHoursService.hasAnyForArenas.mockResolvedValue(new Set(['arena-1']));

      const result = await service.discoverAll();

      expect(result[0]?.isReady).toBe(false);
    });

    it('Fase 33: isReady=false quando há quadra com preço válido mas nenhum horário configurado', async () => {
      prisma.arena.findMany.mockResolvedValue([
        {
          id: 'arena-1',
          name: 'Arena Central',
          slug: 'arena-central',
          description: null,
          courts: [{ sport: Sport.BEACH_VOLLEYBALL, pricePerSlot: new Prisma.Decimal(50) }],
        },
      ]);
      operatingHoursService.hasAnyForArenas.mockResolvedValue(new Set());

      const result = await service.discoverAll();

      expect(result[0]?.isReady).toBe(false);
    });

    it('Fase 33: nunca faz N+1 — hasAnyForArenas é chamado uma única vez, com todas as arenas de uma vez', async () => {
      prisma.arena.findMany.mockResolvedValue([
        { id: 'arena-1', name: 'A', slug: 'a', description: null, courts: [] },
        { id: 'arena-2', name: 'B', slug: 'b', description: null, courts: [] },
        { id: 'arena-3', name: 'C', slug: 'c', description: null, courts: [] },
      ]);

      await service.discoverAll();

      expect(operatingHoursService.hasAnyForArenas).toHaveBeenCalledTimes(1);
      expect(operatingHoursService.hasAnyForArenas).toHaveBeenCalledWith([
        'arena-1',
        'arena-2',
        'arena-3',
      ]);
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
        courts: [
          {
            id: 'court-1',
            name: 'Quadra 1',
            sport: Sport.BEACH_VOLLEYBALL,
            pricePerSlot: new Prisma.Decimal(50),
          },
        ],
      };
      prisma.arena.findUnique.mockResolvedValue(arena);
      operatingHoursService.hasAnyForArena.mockResolvedValue(true);

      const result = await service.discoverOne('arena-1');

      expect(result).toEqual({ ...arena, isReady: true });
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

    // Fase 28, Caso 11: cliente precisa de um sinal claro de "esta arena
    // ainda está sendo configurada" — nunca o checklist granular (isso é
    // informação do OWNER), só o booleano final.
    it('Fase 28: isReady=false quando não há quadra com preço válido, mesmo com horários configurados', async () => {
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
      operatingHoursService.hasAnyForArena.mockResolvedValue(true);

      const result = await service.discoverOne('arena-1');

      expect(result.isReady).toBe(false);
    });

    it('Fase 28: isReady=false quando há quadra com preço válido mas nenhum horário configurado', async () => {
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
        courts: [{ id: 'court-1', pricePerSlot: new Prisma.Decimal(50) }],
      });
      operatingHoursService.hasAnyForArena.mockResolvedValue(false);

      const result = await service.discoverOne('arena-1');

      expect(result.isReady).toBe(false);
    });
  });

  // Fase 32 — mesma implementação interna de `discoverOne` (só troca a
  // cláusula `where`), então só cobrimos o que é realmente diferente: busca
  // por `slug`, não por `id`, e o 404 correspondente.
  describe('discoverBySlug', () => {
    it('lança NotFoundException quando nenhuma arena tem esse slug', async () => {
      prisma.arena.findUnique.mockResolvedValue(null);

      await expect(service.discoverBySlug('slug-inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('busca por slug (nunca por id) e retorna o mesmo formato de discoverOne', async () => {
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
        courts: [
          {
            id: 'court-1',
            name: 'Quadra 1',
            sport: Sport.BEACH_VOLLEYBALL,
            pricePerSlot: new Prisma.Decimal(50),
          },
        ],
      };
      prisma.arena.findUnique.mockResolvedValue(arena);
      operatingHoursService.hasAnyForArena.mockResolvedValue(true);

      const result = await service.discoverBySlug('arena-central');

      expect(result).toEqual({ ...arena, isReady: true });
      const [[call]] = prisma.arena.findUnique.mock.calls as [[{ where: Record<string, unknown> }]];
      expect(call.where).toEqual({ slug: 'arena-central' });
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
