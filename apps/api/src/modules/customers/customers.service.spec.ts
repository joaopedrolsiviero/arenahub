import { NotFoundException } from '@nestjs/common';
import { BookingStatus, BookingType } from '@prisma/client';
import { CustomersService } from './customers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

describe('CustomersService', () => {
  let prisma: {
    booking: { groupBy: jest.Mock; aggregate: jest.Mock; findMany: jest.Mock };
    user: { findMany: jest.Mock; findUnique: jest.Mock };
  };
  let service: CustomersService;

  beforeEach(() => {
    prisma = {
      booking: {
        groupBy: jest.fn(),
        aggregate: jest.fn(),
        findMany: jest.fn(),
      },
      user: { findMany: jest.fn(), findUnique: jest.fn() },
    };
    service = new CustomersService(prisma as unknown as PrismaService);
  });

  function query(overrides: Partial<ListCustomersQueryDto> = {}): ListCustomersQueryDto {
    return { page: 1, limit: 20, ...overrides };
  }

  describe('listCustomers', () => {
    it('filtra por arena e type=CUSTOMER na query de agrupamento', async () => {
      prisma.booking.groupBy.mockResolvedValue([]);

      await service.listCustomers('arena-1', query());

      const [[firstCall]] = prisma.booking.groupBy.mock.calls as [
        [{ where: { court: { arenaId: string }; type: BookingType } }],
      ];
      expect(firstCall.where.court).toEqual({ arenaId: 'arena-1' });
      expect(firstCall.where.type).toBe(BookingType.CUSTOMER);
    });

    it('pagina via skip/take derivados de page/limit, ordenado pela reserva mais recente', async () => {
      prisma.booking.groupBy.mockResolvedValue([]);

      await service.listCustomers('arena-1', query({ page: 3, limit: 10 }));

      const [[pageCall]] = prisma.booking.groupBy.mock.calls as [
        [{ skip: number; take: number; orderBy: unknown }],
      ];
      expect(pageCall.skip).toBe(20); // (3-1)*10
      expect(pageCall.take).toBe(10);
      expect(pageCall.orderBy).toEqual({ _max: { startsAt: 'desc' } });
    });

    it('sem clientes, devolve lista vazia com total 0', async () => {
      prisma.booking.groupBy.mockResolvedValue([]);

      const result = await service.listCustomers('arena-1', query());

      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('combina contagens/receita por status e nome/e-mail do usuário', async () => {
      const firstBookingAt = new Date('2026-05-10T12:00:00Z');
      const lastBookingAt = new Date('2026-08-24T12:00:00Z');

      prisma.booking.groupBy
        .mockResolvedValueOnce([
          {
            userId: 'user-1',
            _min: { startsAt: firstBookingAt },
            _max: { startsAt: lastBookingAt },
          },
        ])
        .mockResolvedValueOnce([{ userId: 'user-1' }]) // allGroups (total)
        .mockResolvedValueOnce([
          {
            userId: 'user-1',
            status: BookingStatus.CONFIRMED,
            _count: { _all: 15 },
            _sum: { total: 1125 },
          },
          {
            userId: 'user-1',
            status: BookingStatus.CANCELLED,
            _count: { _all: 3 },
            _sum: { total: 225 },
          },
        ]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-1', name: 'João Pedro', email: 'joao@example.com' },
      ]);

      const result = await service.listCustomers('arena-1', query());

      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        {
          userId: 'user-1',
          name: 'João Pedro',
          email: 'joao@example.com',
          totalBookings: 18,
          confirmedBookings: 15,
          cancelledBookings: 3,
          totalRevenue: 1125, // nunca soma a receita das canceladas
          firstBookingAt,
          lastBookingAt,
        },
      ]);
    });

    it('busca resolve userIds por nome/e-mail antes de agrupar — sem resultado, nem consulta o Booking', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.listCustomers('arena-1', query({ search: 'ninguem' }));

      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
      expect(prisma.booking.groupBy).not.toHaveBeenCalled();
    });

    it('busca restringe o groupBy aos userIds encontrados', async () => {
      prisma.user.findMany.mockResolvedValueOnce([{ id: 'user-1' }, { id: 'user-2' }]);
      prisma.booking.groupBy.mockResolvedValue([]);

      await service.listCustomers('arena-1', query({ search: 'joão' }));

      const [[firstCall]] = prisma.booking.groupBy.mock.calls as [
        [{ where: { userId: { in: string[] } } }],
      ];
      expect(firstCall.where.userId).toEqual({ in: ['user-1', 'user-2'] });
    });
  });

  describe('getCustomerSummary', () => {
    it('combina confirmadas/canceladas/receita/primeira/última reserva', async () => {
      prisma.booking.groupBy.mockResolvedValue([
        { status: BookingStatus.CONFIRMED, _count: { _all: 15 }, _sum: { total: 1125 } },
        { status: BookingStatus.CANCELLED, _count: { _all: 3 }, _sum: { total: 225 } },
      ]);
      prisma.booking.aggregate.mockResolvedValue({
        _min: { startsAt: new Date('2026-05-10T12:00:00Z') },
        _max: { startsAt: new Date('2026-08-24T12:00:00Z') },
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'João Pedro',
        email: 'joao@example.com',
      });

      const result = await service.getCustomerSummary('arena-1', 'user-1');

      expect(result).toEqual({
        userId: 'user-1',
        name: 'João Pedro',
        email: 'joao@example.com',
        totalBookings: 18,
        confirmedBookings: 15,
        cancelledBookings: 3,
        totalRevenue: 1125,
        firstBookingAt: new Date('2026-05-10T12:00:00Z'),
        lastBookingAt: new Date('2026-08-24T12:00:00Z'),
      });
    });

    it('lança NotFoundException quando o usuário não tem nenhuma Booking CUSTOMER nesta arena', async () => {
      prisma.booking.groupBy.mockResolvedValue([]);
      prisma.booking.aggregate.mockResolvedValue({
        _min: { startsAt: null },
        _max: { startsAt: null },
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'João',
        email: 'joao@example.com',
      });

      await expect(service.getCustomerSummary('arena-1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('filtra a agregação por arena e userId específicos (isolamento multi-tenant/multi-arena)', async () => {
      prisma.booking.groupBy.mockResolvedValue([]);
      prisma.booking.aggregate.mockResolvedValue({
        _min: { startsAt: null },
        _max: { startsAt: null },
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getCustomerSummary('arena-1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      const [[call]] = prisma.booking.groupBy.mock.calls as [
        [{ where: { court: { arenaId: string }; userId: string; type: BookingType } }],
      ];
      expect(call.where).toEqual({
        court: { arenaId: 'arena-1' },
        userId: 'user-1',
        type: BookingType.CUSTOMER,
      });
    });
  });

  describe('getCustomerBookings', () => {
    it('retorna só CUSTOMER da arena e do usuário, ordenado por startsAt desc', async () => {
      prisma.booking.findMany.mockResolvedValue([
        {
          id: 'b1',
          status: BookingStatus.CONFIRMED,
          startsAt: new Date(),
          endsAt: new Date(),
          total: 75,
          court: { id: 'court-1', name: 'Quadra 1' },
        },
      ]);

      await service.getCustomerBookings('arena-1', 'user-1');

      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { court: { arenaId: 'arena-1' }, type: BookingType.CUSTOMER, userId: 'user-1' },
          orderBy: { startsAt: 'desc' },
        }),
      );
    });

    it('lança NotFoundException quando o cliente não tem reservas nesta arena', async () => {
      prisma.booking.findMany.mockResolvedValue([]);

      await expect(service.getCustomerBookings('arena-1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
