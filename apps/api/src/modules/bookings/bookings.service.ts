import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArenaRole, BookingStatus, BookingType, PaymentMode, Prisma, Sport } from '@prisma/client';
import type { Booking, Court } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CourtsService } from '../courts/courts.service';
import { ArenaMembersService } from '../arena-members/arena-members.service';
import { isWithinOperatingHours } from '../operating-hours/operating-hours.util';
import { CreateCustomerBookingDto } from './dto/create-customer-booking.dto';
import { CreateAdminBookingDto } from './dto/create-admin-booking.dto';

type CourtWithArenaTimezone = Court & { arena: { timezone: string } };

// "Ocupação" — o suficiente para responder "este horário está livre?" sem
// vazar dados pessoais de quem fez a reserva (docs/ARCHITECTURE.md, Fase 4,
// item 32). Nunca inclui `userId`, `reason` ou `total`.
export interface BookingOccupancy {
  id: string;
  type: BookingType;
  status: BookingStatus;
  startsAt: Date;
  endsAt: Date;
}

// Visão administrativa — só para quem já passou por autorização de
// OWNER/ADMIN no controller. Inclui o responsável pela reserva.
export interface BookingDetailed extends BookingOccupancy {
  courtId: string;
  userId: string | null;
  total: Prisma.Decimal;
  reason: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  createdAt: Date;
  user: { id: string; name: string | null; email: string } | null;
}

// "Minhas reservas" (Fase 6) — enriquecido com court/arena (nome, sport,
// arenaId/timezone) porque, diferente do resto de BookingsController, esta
// consulta é cross-arena: o cliente não chega aqui a partir de uma URL
// /arenas/:arenaId/courts/:courtId já conhecida, e precisa dos IDs (e do
// timezone, para exibir o horário) para montar a tela — inclusive a própria
// URL de cancelamento, que continua sendo a rota já existente, nunca uma
// segunda implementação.
export interface MyBooking {
  id: string;
  status: BookingStatus;
  startsAt: Date;
  endsAt: Date;
  total: Prisma.Decimal;
  court: {
    id: string;
    name: string;
    sport: Sport;
    arena: {
      id: string;
      name: string;
      slug: string;
      timezone: string;
      // Fase de melhorias no fluxo de reserva — o cliente (e o
      // PaymentsService, que reaproveita esta mesma consulta) precisam
      // saber se esta arena usa pagamento online ou presencial.
      paymentMode: PaymentMode;
    };
  };
}

interface BookingCreationSpec {
  type: BookingType;
  userId: string;
  startsAt: Date;
  reason: string | null;
  // CUSTOMER precisa caber num intervalo de funcionamento configurado
  // (Fase 5, item 26); BLOCK/MAINTENANCE são operações administrativas e
  // não são restringidas pelo horário de funcionamento — mesma lógica já
  // usada para buffer=0 administrativo na Fase 4 (decisão documentada em
  // docs/ARCHITECTURE.md).
  respectsOperatingHours: boolean;
  computeEndsAt(court: Court): Date;
  computeBuffer(court: Court): number;
  computeTotal(court: Court): Prisma.Decimal.Value;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * Criação de Booking (CUSTOMER/BLOCK/MAINTENANCE) — ver docs/ARCHITECTURE.md,
 * Parte 8. As três variantes de criação recebem a transação de fora
 * (`tx: Prisma.TransactionClient`) em vez de abri-la internamente: toda
 * criação de Booking é protegida por Idempotency-Key (item 23), e o registro
 * da chave de idempotência precisa fazer parte da MESMA transação que a
 * criação do Booking — só assim uma requisição perdedora sob concorrência
 * (mesma chave, corrida real) tem o Booking que ela criou revertido junto
 * com o registro de idempotência que falhou (ver IdempotencyService). Quem
 * abre essa transação é sempre `IdempotencyService.execute()`, chamado pelo
 * controller.
 *
 * A defesa contra double-booking em si tem duas camadas dentro dessa
 * transação:
 * 1. `pg_advisory_xact_lock(hashtext(courtId))` serializa criações
 *    concorrentes para a MESMA quadra (outras quadras não são afetadas —
 *    hashtext dá um lock com granularidade por quadra, não global).
 * 2. Uma pré-checagem via `booking_occupied_range(...) &&` (a mesma função
 *    IMMUTABLE usada pela EXCLUDE constraint) dá uma resposta 409 rápida e
 *    amigável — mas quem garante a ausência de conflito de verdade é a
 *    EXCLUDE USING GIST no Postgres: se duas transações concorrentes ainda
 *    assim tentarem inserir ranges sobrepostos (ex: pré-checagem passou para
 *    ambas antes de qualquer uma commitar), o INSERT de uma delas é
 *    fisicamente rejeitado pela constraint, e esse erro é mapeado para 409.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courtsService: CourtsService,
    private readonly arenaMembersService: ArenaMembersService,
  ) {}

  async createCustomerBooking(
    tx: Prisma.TransactionClient,
    arenaId: string,
    courtId: string,
    userId: string,
    dto: CreateCustomerBookingDto,
  ): Promise<Booking> {
    const startsAt = new Date(dto.startsAt);
    this.assertNotPast(startsAt);
    return this.createBooking(tx, arenaId, courtId, {
      type: BookingType.CUSTOMER,
      userId,
      startsAt,
      reason: null,
      respectsOperatingHours: true,
      computeEndsAt: (court) => addMinutes(startsAt, court.slotDurationMinutes),
      computeBuffer: (court) => court.bufferMinutes,
      // Congelado no momento da criação — mudanças futuras em
      // Court.pricePerSlot nunca afetam Bookings já criados.
      computeTotal: (court) => court.pricePerSlot,
    });
  }

  /**
   * Seleção de múltiplos horários numa única reserva. Decisão de
   * representação (documentada no relatório da fase): horários
   * CONSECUTIVOS (ex: 09:00+10:00+11:00, com slots de 60min) viram um
   * único `Booking` contínuo de 09:00 até 12:00 — reaproveita o modelo
   * existente (um intervalo `startsAt`/`endsAt`) exatamente como ele já
   * representa uma reserva de 1 slot, sem nenhuma abstração nova.
   * Horários NÃO consecutivos (ex: 09:00 + 11:00, pulando 10:00) viram
   * Bookings SEPARADOS — um único Booking não pode representar dois
   * intervalos disjuntos sem também ocupar (incorretamente) o intervalo
   * entre eles.
   *
   * Atomicidade (item explícito do prompt): todos os Bookings desta
   * chamada são criados dentro da MESMA `tx` recebida de
   * `IdempotencyService.execute` — se qualquer horário do pedido não
   * puder ser reservado (conflito, fora do funcionamento, já passou), o
   * método correspondente de `createBooking` lança, a exceção propaga
   * daqui pra fora, e o Postgres reverte a transação inteira (inclusive
   * Bookings de runs anteriores já inseridos nesta mesma chamada) — nunca
   * uma reserva parcial. Nenhum mecanismo novo de atomicidade: é o mesmo
   * rollback de transação que já protege a criação de um único Booking.
   */
  async createCustomerBookingBatch(
    tx: Prisma.TransactionClient,
    arenaId: string,
    courtId: string,
    userId: string,
    startTimes: string[],
  ): Promise<Booking[]> {
    // findOne (fora da tx) só pra saber a duração do slot e agrupar os
    // horários — leitura informativa, nunca a autoridade: cada run ainda
    // passa pela validação completa (lock, horário de funcionamento,
    // conflito) dentro de `createBooking`, sob a `tx`.
    const court = await this.courtsService.findOne(arenaId, courtId);
    const slotMs = court.slotDurationMinutes * 60_000;

    const starts = [...new Set(startTimes)]
      .map((iso) => new Date(iso))
      .sort((a, b) => a.getTime() - b.getTime());
    for (const start of starts) {
      this.assertNotPast(start);
    }

    const runs: Date[][] = [];
    for (const start of starts) {
      const lastRun = runs.at(-1);
      const lastStart = lastRun?.at(-1);
      if (lastStart && start.getTime() === lastStart.getTime() + slotMs) {
        lastRun!.push(start);
      } else {
        runs.push([start]);
      }
    }

    const bookings: Booking[] = [];
    for (const run of runs) {
      const runStart = run[0]!;
      const slotCount = run.length;
      bookings.push(
        await this.createBooking(tx, arenaId, courtId, {
          type: BookingType.CUSTOMER,
          userId,
          startsAt: runStart,
          reason: null,
          respectsOperatingHours: true,
          computeEndsAt: (c) => addMinutes(runStart, c.slotDurationMinutes * slotCount),
          computeBuffer: (c) => c.bufferMinutes,
          computeTotal: (c) => c.pricePerSlot.times(slotCount),
        }),
      );
    }
    return bookings;
  }

  // Item 3 do prompt da fase: "um horário que já começou não pode ser
  // selecionado". Mesmo espírito (e mesma comparação `<=`) do bloqueio de
  // cancelamento já existente (`cancel`, mais abaixo) — nunca confia só na
  // UI, que já filtra isso via AvailabilityService, mas um cliente
  // poderia chamar este endpoint direto.
  private assertNotPast(startsAt: Date): void {
    if (startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Não é possível reservar um horário que já passou.');
    }
  }

  async createBlock(
    tx: Prisma.TransactionClient,
    arenaId: string,
    courtId: string,
    userId: string,
    dto: CreateAdminBookingDto,
  ): Promise<Booking> {
    return this.createAdminBooking(tx, arenaId, courtId, userId, BookingType.BLOCK, dto);
  }

  async createMaintenance(
    tx: Prisma.TransactionClient,
    arenaId: string,
    courtId: string,
    userId: string,
    dto: CreateAdminBookingDto,
  ): Promise<Booking> {
    return this.createAdminBooking(tx, arenaId, courtId, userId, BookingType.MAINTENANCE, dto);
  }

  // Janela de tempo é obrigatória (docs/ARCHITECTURE.md, Fase 4, item 31) —
  // nunca lista o histórico inteiro de uma quadra por padrão.
  async findOccupancy(
    arenaId: string,
    courtId: string,
    from: Date,
    to: Date,
  ): Promise<BookingOccupancy[]> {
    await this.courtsService.findOne(arenaId, courtId);
    this.assertValidWindow(from, to);

    return this.prisma.booking.findMany({
      where: {
        courtId,
        status: BookingStatus.CONFIRMED,
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      select: { id: true, type: true, status: true, startsAt: true, endsAt: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  // Visão completa (inclui cancelados, para preservar histórico — item 38) —
  // só deve ser exposta pelo controller a OWNER/ADMIN.
  async findManyAdmin(
    arenaId: string,
    courtId: string,
    from: Date,
    to: Date,
  ): Promise<BookingDetailed[]> {
    await this.courtsService.findOne(arenaId, courtId);
    this.assertValidWindow(from, to);

    return this.prisma.booking.findMany({
      where: { courtId, startsAt: { lt: to }, endsAt: { gt: from } },
      select: {
        id: true,
        courtId: true,
        type: true,
        status: true,
        startsAt: true,
        endsAt: true,
        total: true,
        reason: true,
        userId: true,
        cancelledAt: true,
        cancelledByUserId: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  // "Minhas reservas" (Fase 6, item 56-57): filtra por userId NO BANCO
  // (nunca busca tudo e filtra em JS), e por `type: CUSTOMER` — sem isso, um
  // admin que criou BLOCK/MAINTENANCE (que também tem `userId` preenchido,
  // ver Parte 7) veria bloqueios/manutenções administrativos na própria
  // lista de "minhas reservas de cliente", o que o item 30 proíbe
  // explicitamente.
  private readonly myBookingSelect = {
    id: true,
    status: true,
    startsAt: true,
    endsAt: true,
    total: true,
    court: {
      select: {
        id: true,
        name: true,
        sport: true,
        arena: {
          select: { id: true, name: true, slug: true, timezone: true, paymentMode: true },
        },
      },
    },
  } satisfies Prisma.BookingSelect;

  async findMyBookings(userId: string): Promise<MyBooking[]> {
    return this.prisma.booking.findMany({
      where: { userId, type: BookingType.CUSTOMER },
      select: this.myBookingSelect,
      orderBy: { startsAt: 'desc' },
    });
  }

  // 404 (nunca 403) quando a reserva não é do usuário — mesmo padrão de
  // "não vazar existência" já usado para o cross-tenant de courtId (Fase 4):
  // uma reserva de outro cliente, ou um BLOCK/MAINTENANCE, simplesmente não
  // existe do ponto de vista de "minhas reservas".
  async findMyBookingDetail(userId: string, bookingId: string): Promise<MyBooking> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId, type: BookingType.CUSTOMER },
      select: this.myBookingSelect,
    });

    if (!booking) {
      throw new NotFoundException('Reserva não encontrada.');
    }

    return booking;
  }

  // Cancelamento básico (item 38): mantém histórico, nunca apaga fisicamente,
  // libera a quadra (um CANCELLED não participa da EXCLUDE constraint).
  // Autorizado para o dono da reserva OU OWNER/ADMIN da arena — checagem de
  // recurso, não expressável pelo @RequireArenaRole estático do controller,
  // por isso vive aqui (mesmo padrão de 404 vs 403 do ArenaMembersService).
  // `requesterId` pode não ser ArenaMember (um CUSTOMER comum não precisa
  // ser membro da arena para reservar — ver docs/ARCHITECTURE.md, Fase 4,
  // "Autorização"), por isso o papel é resolvido aqui via getRole, que
  // retorna null nesse caso em vez de lançar.
  //
  // Fase 13: idempotência por natureza do state machine (CONFIRMED->CANCELLED
  // é uma transição terminal), não pelo mecanismo formal de Idempotency-Key
  // (esse existe para proteger CRIAÇÃO — uma operação que sem proteção geraria
  // dois registros distintos a cada retry; cancelar duas vezes já converge
  // pro mesmo estado por construção, então o header não é necessário aqui —
  // decisão registrada em docs/ARCHITECTURE.md, Fase 13). A chamada
  // sequencial repetida já era coberta pelo early-return abaixo; o que
  // faltava era a corrida real: duas requisições concorrentes podem passar
  // pela leitura acima antes de qualquer uma escrever. Por isso a escrita em
  // si é condicional (`updateMany` com `status: CONFIRMED` no WHERE, mesmo
  // espírito do CAS usado no aceite de convite/transferência de ownership da
  // Fase 11) — a perdedora da corrida nunca sobrescreve
  // `cancelledAt`/`cancelledByUserId` da vencedora, só relê o estado final já
  // definido por ela.
  // M7, item 8 do prompt (idempotência de notificações): o retorno passou a
  // incluir `cancelledNow` — true SÓ quando ESTA chamada é quem realmente
  // executou a transição CONFIRMED->CANCELLED (nunca em replay de uma
  // reserva já cancelada, nem quando outra requisição venceu a corrida).
  // BookingsController usa esse sinal pra nunca disparar duas notificações
  // de cancelamento pra uma mesma transição de negócio (retry, duplo
  // clique) — reaproveita a MESMA proteção que já existia (o CAS
  // `status: CONFIRMED` no WHERE), nunca um segundo mecanismo de
  // idempotência.
  async cancel(
    arenaId: string,
    courtId: string,
    bookingId: string,
    requesterId: string,
  ): Promise<{ booking: Booking; cancelledNow: boolean }> {
    await this.courtsService.findOne(arenaId, courtId);

    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, courtId } });
    if (!booking) {
      throw new NotFoundException('Reserva não encontrada.');
    }

    const isOwner = booking.userId === requesterId;
    if (!isOwner) {
      const role = await this.arenaMembersService.getRole(requesterId, arenaId);
      const isAdmin = role === ArenaRole.OWNER || role === ArenaRole.ADMIN;
      if (!isAdmin) {
        throw new ForbiddenException('Você não pode cancelar esta reserva.');
      }
    }

    if (booking.status === BookingStatus.CANCELLED) {
      return { booking, cancelledNow: false };
    }

    // Fase 27, Regra 3/4 — instante real (`Date.now()`), nunca comparação
    // de string/data local: uma reserva que já começou (ou já passou) nunca
    // pode ser cancelada, mesmo por OWNER/ADMIN. O frontend nunca é
    // autoridade sobre isso (item 5 do prompt) — só esta checagem no
    // backend vale.
    if (booking.startsAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Não é possível cancelar uma reserva que já começou ou já foi concluída.',
      );
    }

    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: BookingStatus.CONFIRMED },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledByUserId: requesterId,
      },
    });

    // Sempre relê: se `count` foi 1, é o estado que acabamos de gravar; se
    // foi 0, outra requisição venceu a corrida entre o findFirst acima e
    // este updateMany — o resultado devolvido é o mesmo de qualquer forma
    // (a reserva já está CANCELLED), nunca um erro.
    const finalBooking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    return { booking: finalBooking, cancelledNow: result.count === 1 };
  }

  private assertValidWindow(from: Date, to: Date): void {
    if (!(to.getTime() > from.getTime())) {
      throw new BadRequestException('O parâmetro "to" deve ser posterior a "from".');
    }
  }

  private async createAdminBooking(
    tx: Prisma.TransactionClient,
    arenaId: string,
    courtId: string,
    userId: string,
    type: BookingType,
    dto: CreateAdminBookingDto,
  ): Promise<Booking> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    return this.createBooking(tx, arenaId, courtId, {
      type,
      userId,
      startsAt,
      reason: dto.reason ?? null,
      respectsOperatingHours: false,
      computeEndsAt: () => endsAt,
      // Bloqueio/manutenção sempre ocupam exatamente o intervalo declarado —
      // buffer 0 (ver docs/ARCHITECTURE.md, Fase 4, item 20/11).
      computeBuffer: () => 0,
      computeTotal: () => 0,
    });
  }

  private async createBooking(
    tx: Prisma.TransactionClient,
    arenaId: string,
    courtId: string,
    spec: BookingCreationSpec,
  ): Promise<Booking> {
    // Lock por quadra (não global): hashtext(courtId) dá uma chave
    // determinística de 32 bits; duas quadras diferentes praticamente
    // nunca colidem, e mesmo que colidissem o pior caso é serialização
    // extra (nunca perda de segurança — a EXCLUDE constraint continua
    // sendo a autoridade final).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${courtId}))`;

    const court: CourtWithArenaTimezone | null = await tx.court.findFirst({
      where: { id: courtId, arenaId },
      include: { arena: { select: { timezone: true } } },
    });
    if (!court) {
      throw new NotFoundException('Quadra não encontrada.');
    }
    if (!court.isActive) {
      throw new ConflictException('Quadra desativada não aceita novas reservas.');
    }

    const endsAt = spec.computeEndsAt(court);
    if (!(endsAt.getTime() > spec.startsAt.getTime())) {
      throw new BadRequestException('O horário de término deve ser posterior ao de início.');
    }

    const bufferMinutesSnapshot = spec.computeBuffer(court);
    const total = spec.computeTotal(court);

    if (spec.respectsOperatingHours) {
      const intervals = await tx.arenaOperatingHours.findMany({
        where: { arenaId },
        select: { dayOfWeek: true, opensAt: true, closesAt: true },
      });
      if (
        !isWithinOperatingHours(
          intervals,
          court.arena.timezone,
          spec.startsAt,
          endsAt,
          bufferMinutesSnapshot,
        )
      ) {
        throw new ConflictException('Horário fora do funcionamento da arena.');
      }
    }

    const conflicts = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Booking"
      WHERE "courtId" = ${courtId}
        AND status = 'CONFIRMED'::"BookingStatus"
        AND booking_occupied_range("startsAt", "endsAt", "bufferMinutesSnapshot")
            && booking_occupied_range(${spec.startsAt}::timestamptz, ${endsAt}::timestamptz, ${bufferMinutesSnapshot}::int)
      LIMIT 1
    `;
    if (conflicts.length > 0) {
      throw new ConflictException('Horário indisponível para esta quadra.');
    }

    try {
      return await tx.booking.create({
        data: {
          courtId,
          userId: spec.userId,
          type: spec.type,
          startsAt: spec.startsAt,
          endsAt,
          bufferMinutesSnapshot,
          total,
          reason: spec.reason,
        },
      });
    } catch (error) {
      if (this.isExclusionViolation(error)) {
        throw new ConflictException('Horário indisponível para esta quadra.');
      }
      throw error;
    }
  }

  // A violação da EXCLUDE constraint chega como PrismaClientUnknownRequestError
  // (SQLSTATE 23P01, exclusion_violation) — Prisma não tem um P-code dedicado
  // para exclusion constraints (diferente de P2002 para unique). Confirmado
  // empiricamente contra o Postgres real desta migration antes de escrever
  // este método. A pré-checagem acima torna este catch um caso raro (só
  // ocorre sob corrida real entre duas transações), não o caminho principal.
  private isExclusionViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes('23P01')
    );
  }
}
