import { Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, BookingType, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import {
  paymentDisplaySelect,
  resolveAdminPaymentStatus,
} from '../payments/payment-display-status';

// Fase 14: "cliente da arena" — usuário que possui ou possuiu pelo menos uma
// Booking type=CUSTOMER numa quadra desta arena. Nunca uma entidade nova no
// schema (nenhuma migration nesta fase) — é uma VISÃO derivada de
// User+Booking já existentes, a mesma técnica de "status derivado" já usada
// para ArenaInvitation (Fase 11) e para as métricas da IA (Fase 12): nunca
// um dado que possa dessincronizar do que já existe.
export interface CustomerSummary {
  userId: string;
  name: string | null;
  email: string;
  totalBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  totalRevenue: number;
  firstBookingAt: Date;
  lastBookingAt: Date;
}

export interface CustomerListResult {
  items: CustomerSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface CustomerBookingItem {
  id: string;
  status: BookingStatus;
  startsAt: Date;
  endsAt: Date;
  total: Prisma.Decimal;
  court: { id: string; name: string };
  // Status do pagamento (só leitura); `null` = sem Payment.
  paymentStatus: PaymentStatus | null;
}

interface StatusAggregate {
  count: number;
  revenue: number;
}

/**
 * Camada de domínio para a visão operacional de clientes da arena (Fase 14).
 * Toda métrica é calculada direto do Postgres, sempre filtrada por
 * `arenaId` — nunca uma segunda implementação da regra de receita já
 * estabelecida na Fase 12 (`CUSTOMER`+`CONFIRMED`, nunca `CANCELLED`/
 * `BLOCK`/`MAINTENANCE`).
 *
 * Evita N+1 deliberadamente: uma listagem de N clientes nunca dispara N
 * queries de agregação — usa `groupBy` (agregação no próprio Postgres) em
 * duas chamadas, sempre delimitadas pela página atual, nunca pelo total de
 * clientes da arena. Ver docs/ARCHITECTURE.md, Fase 14, para o detalhe de
 * cada consulta.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async listCustomers(arenaId: string, query: ListCustomersQueryDto): Promise<CustomerListResult> {
    const { page, limit } = query;

    let userIdFilter: string[] | undefined;
    if (query.search) {
      const matches = await this.prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      userIdFilter = matches.map((u) => u.id);
      if (userIdFilter.length === 0) {
        return { items: [], total: 0, page, limit };
      }
    }

    const baseWhere: Prisma.BookingWhereInput = {
      court: { arenaId },
      type: BookingType.CUSTOMER,
      userId: userIdFilter ? { in: userIdFilter } : { not: null },
    };

    // Query 1: só pra decidir QUAIS clientes entram nesta página — group by
    // userId (sem status), ordenado pela reserva mais recente. `total` conta
    // quantos clientes distintos existem no total (não quantas reservas) —
    // delimitado pelo número de CLIENTES da arena, não pelo histórico
    // inteiro de reservas; aceitável na escala desta fase ("não é um CRM
    // completo"), documentado como possível otimização futura se o volume
    // justificar.
    const [pageGroups, allGroups] = await Promise.all([
      this.prisma.booking.groupBy({
        by: ['userId'],
        where: baseWhere,
        _min: { startsAt: true },
        _max: { startsAt: true },
        orderBy: { _max: { startsAt: 'desc' } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.booking.groupBy({ by: ['userId'], where: baseWhere }),
    ]);

    if (pageGroups.length === 0) {
      return { items: [], total: allGroups.length, page, limit };
    }

    const pageUserIds = pageGroups.map((g) => g.userId as string);

    // Query 2: só pra ESTA página (nunca todos os clientes da arena) — conta
    // confirmadas/canceladas e soma a receita (só CONFIRMED, regra da Fase
    // 12) por status, agregado no banco.
    const [byStatus, users] = await Promise.all([
      this.prisma.booking.groupBy({
        by: ['userId', 'status'],
        where: { ...baseWhere, userId: { in: pageUserIds } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: pageUserIds } },
        select: { id: true, name: true, email: true },
      }),
    ]);

    const usersById = new Map(users.map((u) => [u.id, u]));
    const statusByUser = this.groupStatusAggregates(byStatus);

    const items: CustomerSummary[] = pageGroups.map((group) => {
      const userId = group.userId as string;
      const user = usersById.get(userId);
      const confirmed = statusByUser.get(userId)?.get(BookingStatus.CONFIRMED) ?? {
        count: 0,
        revenue: 0,
      };
      const cancelled = statusByUser.get(userId)?.get(BookingStatus.CANCELLED) ?? {
        count: 0,
        revenue: 0,
      };

      return {
        userId,
        name: user?.name ?? null,
        email: user?.email ?? '',
        totalBookings: confirmed.count + cancelled.count,
        confirmedBookings: confirmed.count,
        cancelledBookings: cancelled.count,
        totalRevenue: confirmed.revenue,
        firstBookingAt: group._min.startsAt!,
        lastBookingAt: group._max.startsAt!,
      };
    });

    return { items, total: allGroups.length, page, limit };
  }

  async getCustomerSummary(arenaId: string, userId: string): Promise<CustomerSummary> {
    const baseWhere: Prisma.BookingWhereInput = {
      court: { arenaId },
      type: BookingType.CUSTOMER,
      userId,
    };

    const [byStatus, minMax, user] = await Promise.all([
      this.prisma.booking.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.booking.aggregate({
        where: baseWhere,
        _min: { startsAt: true },
        _max: { startsAt: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      }),
    ]);

    const confirmed = byStatus.find((row) => row.status === BookingStatus.CONFIRMED);
    const cancelled = byStatus.find((row) => row.status === BookingStatus.CANCELLED);
    const totalBookings = (confirmed?._count._all ?? 0) + (cancelled?._count._all ?? 0);

    // Nunca "não encontrado" por não existir globalmente, e sim por não ter
    // NENHUMA Booking CUSTOMER nesta arena — o mesmo usuário pode ser
    // cliente de outra arena (item 4/25/26 do prompt) e isso nunca deve
    // aparecer aqui. `!minMax._min.startsAt` é o sinal de "zero reservas
    // nesta arena" (agregação sem linhas devolve null, não erro).
    if (totalBookings === 0 || !minMax._min.startsAt || !minMax._max.startsAt) {
      throw new NotFoundException('Cliente não encontrado nesta arena.');
    }

    return {
      userId,
      name: user?.name ?? null,
      email: user?.email ?? '',
      totalBookings,
      confirmedBookings: confirmed?._count._all ?? 0,
      cancelledBookings: cancelled?._count._all ?? 0,
      totalRevenue: Number(confirmed?._sum.total ?? 0),
      firstBookingAt: minMax._min.startsAt,
      lastBookingAt: minMax._max.startsAt,
    };
  }

  async getCustomerBookings(arenaId: string, userId: string): Promise<CustomerBookingItem[]> {
    const bookings = await this.prisma.booking.findMany({
      where: { court: { arenaId }, type: BookingType.CUSTOMER, userId },
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        total: true,
        court: { select: { id: true, name: true } },
        payments: { select: paymentDisplaySelect },
      },
      orderBy: { startsAt: 'desc' },
    });

    if (bookings.length === 0) {
      throw new NotFoundException('Cliente não encontrado nesta arena.');
    }

    return bookings.map(({ payments, ...booking }) => ({
      ...booking,
      paymentStatus: resolveAdminPaymentStatus(payments),
    }));
  }

  private groupStatusAggregates(
    rows: {
      userId: string | null;
      status: BookingStatus;
      _count: { _all: number };
      _sum: { total: Prisma.Decimal | null };
    }[],
  ): Map<string, Map<BookingStatus, StatusAggregate>> {
    const result = new Map<string, Map<BookingStatus, StatusAggregate>>();
    for (const row of rows) {
      if (!row.userId) continue;
      const byStatus = result.get(row.userId) ?? new Map<BookingStatus, StatusAggregate>();
      byStatus.set(row.status, {
        count: row._count._all,
        revenue: Number(row._sum.total ?? 0),
      });
      result.set(row.userId, byStatus);
    }
    return result;
  }
}
