import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ArenaRole, BookingStatus, BookingType, Prisma, Weekday } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { CourtsService } from '../courts/courts.service';
import { ArenaMembersService } from '../arena-members/arena-members.service';
import { PrismaService } from '../../prisma/prisma.service';

function exclusionViolation(): Prisma.PrismaClientUnknownRequestError {
  return new Prisma.PrismaClientUnknownRequestError(
    'conflicting key value violates exclusion constraint "Booking_no_overlap_excl" ... 23P01',
    { clientVersion: 'test' },
  );
}

describe('BookingsService', () => {
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    court: { findFirst: jest.Mock };
    booking: { create: jest.Mock };
    arenaOperatingHours: { findMany: jest.Mock };
  };
  let prisma: {
    booking: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let courtsService: { findOne: jest.Mock };
  let arenaMembersService: { getRole: jest.Mock };
  let service: BookingsService;

  // dto.startsAt nos testes abaixo cai numa quinta-feira (2026-08-20) — o
  // intervalo padrão cobre o dia quase inteiro para não ser um fator de
  // confusão nos testes que não são sobre horário de funcionamento em si
  // (esse é coberto à parte, na suíte "horário de funcionamento").
  const allDayThursday = [{ dayOfWeek: Weekday.THURSDAY, opensAt: 0, closesAt: 1439 }];

  const activeCourt = {
    id: 'court-1',
    arenaId: 'arena-1',
    isActive: true,
    slotDurationMinutes: 60,
    bufferMinutes: 15,
    pricePerSlot: 100,
    arena: { timezone: 'America/Sao_Paulo' },
  };

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      $queryRaw: jest.fn().mockResolvedValue([]),
      court: { findFirst: jest.fn() },
      booking: { create: jest.fn() },
      arenaOperatingHours: { findMany: jest.fn().mockResolvedValue(allDayThursday) },
    };
    prisma = {
      booking: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
    };
    courtsService = { findOne: jest.fn().mockResolvedValue(activeCourt) };
    arenaMembersService = { getRole: jest.fn().mockResolvedValue(null) };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      courtsService as unknown as CourtsService,
      arenaMembersService as unknown as ArenaMembersService,
    );
  });

  // Toda criação recebe a transação de fora (normalmente aberta por
  // IdempotencyService.execute() — ver comentário em bookings.service.ts) —
  // nos testes, simulamos isso passando `tx` diretamente.
  const asTx = () => tx as unknown as Prisma.TransactionClient;

  describe('createCustomerBooking', () => {
    const dto = { startsAt: '2026-08-20T19:00:00-03:00' };

    it('cria a reserva calculando endsAt/buffer/total a partir da quadra', async () => {
      tx.court.findFirst.mockResolvedValue(activeCourt);
      tx.booking.create.mockResolvedValue({ id: 'booking-1' });

      const result = await service.createCustomerBooking(
        asTx(),
        'arena-1',
        'court-1',
        'user-1',
        dto,
      );

      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.court.findFirst).toHaveBeenCalledWith({
        where: { id: 'court-1', arenaId: 'arena-1' },
        include: { arena: { select: { timezone: true } } },
      });
      expect(tx.booking.create).toHaveBeenCalledWith({
        data: {
          courtId: 'court-1',
          userId: 'user-1',
          type: BookingType.CUSTOMER,
          startsAt: new Date('2026-08-20T19:00:00-03:00'),
          endsAt: new Date('2026-08-20T20:00:00-03:00'),
          bufferMinutesSnapshot: 15,
          total: 100,
          reason: null,
        },
      });
      expect(result).toEqual({ id: 'booking-1' });
    });

    it('lança NotFoundException quando a quadra não existe nesta arena', async () => {
      tx.court.findFirst.mockResolvedValue(null);

      await expect(
        service.createCustomerBooking(asTx(), 'arena-1', 'court-inexistente', 'user-1', dto),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.booking.create).not.toHaveBeenCalled();
    });

    it('lança ConflictException quando a quadra está desativada', async () => {
      tx.court.findFirst.mockResolvedValue({ ...activeCourt, isActive: false });

      await expect(
        service.createCustomerBooking(asTx(), 'arena-1', 'court-1', 'user-1', dto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.booking.create).not.toHaveBeenCalled();
    });

    it('lança ConflictException quando o horário está fora do funcionamento da arena', async () => {
      tx.court.findFirst.mockResolvedValue(activeCourt);
      tx.arenaOperatingHours.findMany.mockResolvedValue([
        { dayOfWeek: Weekday.THURSDAY, opensAt: 480, closesAt: 1080 }, // 08:00-18:00, dto pede 19:00
      ]);

      await expect(
        service.createCustomerBooking(asTx(), 'arena-1', 'court-1', 'user-1', dto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.booking.create).not.toHaveBeenCalled();
    });

    it('lança ConflictException quando a reserva atravessaria o fechamento da arena', async () => {
      tx.court.findFirst.mockResolvedValue(activeCourt);
      // Fecha às 19:30 — a reserva 19:00-20:00 (+ buffer 15 = até 20:15)
      // não cabe inteira antes do fechamento.
      tx.arenaOperatingHours.findMany.mockResolvedValue([
        { dayOfWeek: Weekday.THURSDAY, opensAt: 480, closesAt: 1170 },
      ]);

      await expect(
        service.createCustomerBooking(asTx(), 'arena-1', 'court-1', 'user-1', dto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.booking.create).not.toHaveBeenCalled();
    });

    it('lança ConflictException quando a pré-checagem encontra sobreposição', async () => {
      tx.court.findFirst.mockResolvedValue(activeCourt);
      tx.$queryRaw.mockResolvedValue([{ id: 'booking-existente' }]);

      await expect(
        service.createCustomerBooking(asTx(), 'arena-1', 'court-1', 'user-1', dto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.booking.create).not.toHaveBeenCalled();
    });

    it('mapeia violação da EXCLUDE constraint (23P01) para ConflictException', async () => {
      tx.court.findFirst.mockResolvedValue(activeCourt);
      tx.booking.create.mockRejectedValue(exclusionViolation());

      await expect(
        service.createCustomerBooking(asTx(), 'arena-1', 'court-1', 'user-1', dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('relança erros do insert que não são violação de exclusão', async () => {
      tx.court.findFirst.mockResolvedValue(activeCourt);
      const otherError = new Error('falha inesperada de banco');
      tx.booking.create.mockRejectedValue(otherError);

      await expect(
        service.createCustomerBooking(asTx(), 'arena-1', 'court-1', 'user-1', dto),
      ).rejects.toBe(otherError);
    });
  });

  describe('createBlock / createMaintenance', () => {
    const dto = {
      startsAt: '2026-08-20T18:00:00-03:00',
      endsAt: '2026-08-20T22:00:00-03:00',
      reason: 'Evento privado',
    };

    it('BLOCK/MAINTENANCE não são restringidos pelo horário de funcionamento (decisão documentada)', async () => {
      tx.court.findFirst.mockResolvedValue(activeCourt);
      tx.booking.create.mockResolvedValue({ id: 'block-1' });
      // Arena totalmente fechada (nenhum intervalo configurado) — mesmo
      // assim BLOCK deve suceder, e a query de horário nem deve ser feita.
      tx.arenaOperatingHours.findMany.mockClear();

      await service.createBlock(asTx(), 'arena-1', 'court-1', 'admin-1', dto);

      expect(tx.arenaOperatingHours.findMany).not.toHaveBeenCalled();
      expect(tx.booking.create).toHaveBeenCalled();
    });

    it('createBlock usa endsAt do admin, buffer 0 e total 0', async () => {
      tx.court.findFirst.mockResolvedValue(activeCourt);
      tx.booking.create.mockResolvedValue({ id: 'block-1' });

      await service.createBlock(asTx(), 'arena-1', 'court-1', 'admin-1', dto);

      expect(tx.booking.create).toHaveBeenCalledWith({
        data: {
          courtId: 'court-1',
          userId: 'admin-1',
          type: BookingType.BLOCK,
          startsAt: new Date(dto.startsAt),
          endsAt: new Date(dto.endsAt),
          bufferMinutesSnapshot: 0,
          total: 0,
          reason: 'Evento privado',
        },
      });
    });

    it('createMaintenance usa type MAINTENANCE', async () => {
      tx.court.findFirst.mockResolvedValue(activeCourt);
      tx.booking.create.mockResolvedValue({ id: 'maint-1' });

      await service.createMaintenance(asTx(), 'arena-1', 'court-1', 'admin-1', dto);

      const [[call]] = tx.booking.create.mock.calls as [[{ data: { type: BookingType } }]];
      expect(call.data.type).toBe(BookingType.MAINTENANCE);
    });

    it('lança BadRequestException quando endsAt não é posterior a startsAt', async () => {
      tx.court.findFirst.mockResolvedValue(activeCourt);

      await expect(
        service.createBlock(asTx(), 'arena-1', 'court-1', 'admin-1', {
          startsAt: '2026-08-20T18:00:00-03:00',
          endsAt: '2026-08-20T18:00:00-03:00',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.booking.create).not.toHaveBeenCalled();
    });

    it('reason ausente é armazenado como null, não undefined', async () => {
      tx.court.findFirst.mockResolvedValue(activeCourt);
      tx.booking.create.mockResolvedValue({ id: 'maint-2' });

      await service.createMaintenance(asTx(), 'arena-1', 'court-1', 'admin-1', {
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
      });

      const [[call]] = tx.booking.create.mock.calls as [[{ data: { reason: string | null } }]];
      expect(call.data.reason).toBeNull();
    });
  });

  describe('findOccupancy', () => {
    const from = new Date('2026-08-20T00:00:00-03:00');
    const to = new Date('2026-08-21T00:00:00-03:00');

    it('valida a quadra via CourtsService e filtra só CONFIRMED com select restrito (sem PII)', async () => {
      prisma.booking.findMany.mockResolvedValue([
        {
          id: 'b1',
          type: BookingType.CUSTOMER,
          status: BookingStatus.CONFIRMED,
          startsAt: from,
          endsAt: to,
        },
      ]);

      const result = await service.findOccupancy('arena-1', 'court-1', from, to);

      expect(courtsService.findOne).toHaveBeenCalledWith('arena-1', 'court-1');
      expect(prisma.booking.findMany).toHaveBeenCalledWith({
        where: {
          courtId: 'court-1',
          status: BookingStatus.CONFIRMED,
          startsAt: { lt: to },
          endsAt: { gt: from },
        },
        select: { id: true, type: true, status: true, startsAt: true, endsAt: true },
        orderBy: { startsAt: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('lança BadRequestException quando "to" não é posterior a "from"', async () => {
      await expect(service.findOccupancy('arena-1', 'court-1', to, from)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
    });

    it('propaga o NotFoundException do CourtsService quando a quadra não existe na arena', async () => {
      courtsService.findOne.mockRejectedValue(new NotFoundException('Quadra não encontrada.'));

      await expect(
        service.findOccupancy('arena-1', 'court-inexistente', from, to),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findManyAdmin', () => {
    const from = new Date('2026-08-20T00:00:00-03:00');
    const to = new Date('2026-08-21T00:00:00-03:00');

    it('não filtra por status (inclui cancelados) e seleciona dados do responsável', async () => {
      prisma.booking.findMany.mockResolvedValue([]);

      await service.findManyAdmin('arena-1', 'court-1', from, to);

      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { courtId: 'court-1', startsAt: { lt: to }, endsAt: { gt: from } },
        }),
      );
      const [[call]] = prisma.booking.findMany.mock.calls as [
        [{ select: { userId: boolean; user: unknown; status: boolean } }],
      ];
      expect(call.select.userId).toBe(true);
      expect(call.select.user).toBeDefined();
    });
  });

  describe('findMyBookings', () => {
    it('filtra por userId e type CUSTOMER no banco (item 30/56 da Fase 6)', async () => {
      prisma.booking.findMany.mockResolvedValue([]);

      await service.findMyBookings('user-1');

      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', type: BookingType.CUSTOMER },
        }),
      );
    });

    it('inclui court e arena (nome, timezone) para o frontend montar a tela sem round-trip extra', async () => {
      prisma.booking.findMany.mockResolvedValue([]);

      await service.findMyBookings('user-1');

      const [[call]] = prisma.booking.findMany.mock.calls as [
        [{ select: { court: { select: { arena: { select: Record<string, boolean> } } } } }],
      ];
      expect(call.select.court.select.arena.select).toEqual({
        id: true,
        name: true,
        slug: true,
        timezone: true,
      });
    });
  });

  describe('findMyBookingDetail', () => {
    it('retorna a reserva quando pertence ao usuário e é CUSTOMER', async () => {
      const booking = { id: 'booking-1', status: BookingStatus.CONFIRMED };
      prisma.booking.findFirst.mockResolvedValue(booking);

      await expect(service.findMyBookingDetail('user-1', 'booking-1')).resolves.toEqual(booking);
      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1', userId: 'user-1', type: BookingType.CUSTOMER },
        }),
      );
    });

    it('lança NotFoundException (nunca 403) quando a reserva não é do usuário — não vaza existência', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      await expect(
        service.findMyBookingDetail('user-1', 'booking-de-outro'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // Fase 13, item 5: BLOCK/MAINTENANCE nunca aparecem em "minhas reservas"
    // de cliente, mesmo que o `userId` bata (ex: o próprio OWNER que criou o
    // bloqueio) — o filtro `type: CUSTOMER` no WHERE (já coberto acima) faz
    // o Prisma nunca devolver a linha; `findFirst` resolve `null` e o
    // resultado é o mesmo 404 "não vaza existência" de qualquer outro caso.
    it('BLOCK/MAINTENANCE nunca aparecem no detalhe de "minhas reservas", mesmo se o userId bater', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      await expect(
        service.findMyBookingDetail('owner-que-criou-o-block', 'block-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'block-1', userId: 'owner-que-criou-o-block', type: BookingType.CUSTOMER },
        }),
      );
    });
  });

  describe('cancel', () => {
    const existingBooking = {
      id: 'booking-1',
      courtId: 'court-1',
      userId: 'user-1',
      status: BookingStatus.CONFIRMED,
    };

    it('permite que o dono da reserva cancele', async () => {
      prisma.booking.findFirst.mockResolvedValue(existingBooking);
      prisma.booking.findUniqueOrThrow.mockResolvedValue({
        ...existingBooking,
        status: BookingStatus.CANCELLED,
      });

      const result = await service.cancel('arena-1', 'court-1', 'booking-1', 'user-1');

      expect(arenaMembersService.getRole).not.toHaveBeenCalled();
      const [[call]] = prisma.booking.updateMany.mock.calls as [
        [
          {
            where: { id: string; status: BookingStatus };
            data: { status: BookingStatus; cancelledByUserId: string };
          },
        ],
      ];
      expect(call.where).toEqual({ id: 'booking-1', status: BookingStatus.CONFIRMED });
      expect(call.data.status).toBe(BookingStatus.CANCELLED);
      expect(call.data.cancelledByUserId).toBe('user-1');
      expect(result.status).toBe(BookingStatus.CANCELLED);
    });

    it('permite que ADMIN/OWNER da arena cancele reserva de outro usuário', async () => {
      prisma.booking.findFirst.mockResolvedValue(existingBooking);
      prisma.booking.findUniqueOrThrow.mockResolvedValue({
        ...existingBooking,
        status: BookingStatus.CANCELLED,
      });
      arenaMembersService.getRole.mockResolvedValue(ArenaRole.ADMIN);

      await service.cancel('arena-1', 'court-1', 'booking-1', 'admin-1');

      expect(arenaMembersService.getRole).toHaveBeenCalledWith('admin-1', 'arena-1');
      expect(prisma.booking.updateMany).toHaveBeenCalled();
    });

    it('lança ForbiddenException quando quem pede não é dono nem admin/owner (nem membro)', async () => {
      prisma.booking.findFirst.mockResolvedValue(existingBooking);
      arenaMembersService.getRole.mockResolvedValue(null);

      await expect(
        service.cancel('arena-1', 'court-1', 'booking-1', 'outro-user'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    });

    it('lança NotFoundException quando a reserva não existe nesta quadra', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      await expect(
        service.cancel('arena-1', 'court-1', 'booking-inexistente', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('é idempotente (chamada sequencial): cancelar uma reserva já cancelada só a retorna, sem novo UPDATE', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        ...existingBooking,
        status: BookingStatus.CANCELLED,
      });

      const result = await service.cancel('arena-1', 'court-1', 'booking-1', 'user-1');

      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
      expect(result.status).toBe(BookingStatus.CANCELLED);
    });

    // Fase 13: a proteção contra a corrida real (duas requisições passando
    // pelo findFirst antes de qualquer uma escrever) é a condição
    // `status: CONFIRMED` no WHERE do updateMany, não uma checagem em
    // memória — `count: 0` é o sinal de que perdemos a corrida.
    it('sob concorrência real, a perdedora da corrida (updateMany count=0) devolve o mesmo estado final, sem erro', async () => {
      prisma.booking.findFirst.mockResolvedValue(existingBooking);
      prisma.booking.updateMany.mockResolvedValue({ count: 0 });
      prisma.booking.findUniqueOrThrow.mockResolvedValue({
        ...existingBooking,
        status: BookingStatus.CANCELLED,
        cancelledByUserId: 'quem-venceu-a-corrida',
      });

      const result = await service.cancel('arena-1', 'court-1', 'booking-1', 'user-1');

      expect(result.status).toBe(BookingStatus.CANCELLED);
      expect(result.cancelledByUserId).toBe('quem-venceu-a-corrida');
    });
  });
});
