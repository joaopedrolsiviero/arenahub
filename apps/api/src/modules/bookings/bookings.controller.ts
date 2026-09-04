import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArenaRole } from '@prisma/client';
import type { Booking } from '@prisma/client';
import { type AuthenticatedUser, ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ArenaAccessGuard } from '../arena-members/arena-access.guard';
import { RequireArenaRole } from '../arena-members/require-arena-role.decorator';
import { UsersService } from '../users/users.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PaymentsService } from '../payments/payments.service';
import { BookingDetailed, BookingOccupancy, BookingsService } from './bookings.service';
import { CreateCustomerBookingDto } from './dto/create-customer-booking.dto';
import { CreateAdminBookingDto } from './dto/create-admin-booking.dto';
import { BookingWindowQueryDto } from './dto/booking-window-query.dto';

// :arenaId e :courtId sempre no path — nunca confiar em courtId isolado
// (docs/ARCHITECTURE.md, Fase 4, item 41).
//
// Decisão de autorização (perguntada e confirmada explicitamente antes desta
// fase ser implementada): criar reserva CUSTOMER exige só ClerkAuthGuard —
// um cliente comum NÃO precisa ser ArenaMember (OWNER/ADMIN) da arena para
// reservar uma quadra; o domínio atual só tem papéis administrativos
// (ArenaRole = OWNER/ADMIN), sem um papel de "cliente", e exigir
// ArenaAccessGuard no CUSTOMER inviabilizaria a própria funcionalidade.
// BLOCK, MAINTENANCE e a listagem administrativa continuam exigindo
// ArenaAccessGuard + @RequireArenaRole(OWNER, ADMIN), igual a
// CourtsController — nenhuma segunda implementação de autorização.
@Controller('arenas/:arenaId/courts/:courtId/bookings')
@UseGuards(ClerkAuthGuard)
export class BookingsController {
  private readonly logger = new Logger(BookingsController.name);

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly usersService: UsersService,
    private readonly idempotencyService: IdempotencyService,
    // Fase 27 — só o controller conhece PaymentsService; BookingsService
    // continua sem nenhuma dependência de Payment (docs/ARCHITECTURE.md).
    private readonly paymentsService: PaymentsService,
  ) {}

  // Fase 18 (item 4): criação de reserva é o endpoint de maior valor de
  // negócio para abusar (scripts tentando "grudar" em todo horário que
  // abrir) — limite dedicado. 100/min por IP é bem acima de qualquer uso
  // humano legítimo (inclusive rajadas de retry do frontend) mas barra um
  // script varrendo agendas.
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  // Item "seleção de múltiplos horários": quando `additionalStartTimes` vem
  // vazio/ausente (todo chamador existente — inclusive WhatsApp via
  // ConversationService, que nunca preenche esse campo), o retorno
  // continua sendo um único `Booking`, exatamente como antes desta fase.
  // Só quando o cliente pede mais de um horário o retorno vira um array —
  // documentado no relatório da fase, decisão deliberada pra nunca quebrar
  // o contrato de quem já espera um objeto único.
  async createCustomer(
    @CurrentUser() authUser: AuthenticatedUser,
    @Param('arenaId') arenaId: string,
    @Param('courtId') courtId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateCustomerBookingDto,
  ): Promise<Booking | Booking[]> {
    this.assertIdempotencyKey(idempotencyKey);
    const user = await this.usersService.findByClerkId(authUser.clerkId);
    const additionalStartTimes = dto.additionalStartTimes ?? [];

    const result = await this.idempotencyService.execute<Booking | Booking[]>(
      {
        userId: user.id,
        endpoint: 'bookings.customer.create',
        key: idempotencyKey,
        payload: { arenaId, courtId, ...dto },
      },
      async (tx) => {
        if (additionalStartTimes.length > 0) {
          const bookings = await this.bookingsService.createCustomerBookingBatch(
            tx,
            arenaId,
            courtId,
            user.id,
            [dto.startsAt, ...additionalStartTimes],
          );
          return { status: HttpStatus.CREATED, body: bookings };
        }
        const booking = await this.bookingsService.createCustomerBooking(
          tx,
          arenaId,
          courtId,
          user.id,
          dto,
        );
        return { status: HttpStatus.CREATED, body: booking };
      },
    );

    return result.body;
  }

  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @Post('blocks')
  @UseGuards(ArenaAccessGuard)
  @RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createBlock(
    @CurrentUser() authUser: AuthenticatedUser,
    @Param('arenaId') arenaId: string,
    @Param('courtId') courtId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateAdminBookingDto,
  ): Promise<Booking> {
    this.assertIdempotencyKey(idempotencyKey);
    const user = await this.usersService.findByClerkId(authUser.clerkId);

    const result = await this.idempotencyService.execute<Booking>(
      {
        userId: user.id,
        endpoint: 'bookings.block.create',
        key: idempotencyKey,
        payload: { arenaId, courtId, ...dto },
      },
      async (tx) => {
        const booking = await this.bookingsService.createBlock(tx, arenaId, courtId, user.id, dto);
        return { status: HttpStatus.CREATED, body: booking };
      },
    );

    return result.body;
  }

  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @Post('maintenance')
  @UseGuards(ArenaAccessGuard)
  @RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createMaintenance(
    @CurrentUser() authUser: AuthenticatedUser,
    @Param('arenaId') arenaId: string,
    @Param('courtId') courtId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateAdminBookingDto,
  ): Promise<Booking> {
    this.assertIdempotencyKey(idempotencyKey);
    const user = await this.usersService.findByClerkId(authUser.clerkId);

    const result = await this.idempotencyService.execute<Booking>(
      {
        userId: user.id,
        endpoint: 'bookings.maintenance.create',
        key: idempotencyKey,
        payload: { arenaId, courtId, ...dto },
      },
      async (tx) => {
        const booking = await this.bookingsService.createMaintenance(
          tx,
          arenaId,
          courtId,
          user.id,
          dto,
        );
        return { status: HttpStatus.CREATED, body: booking };
      },
    );

    return result.body;
  }

  // Visão de ocupação (sem PII) — qualquer usuário autenticado, mesmo lógica
  // de acesso da criação de CUSTOMER (item 32).
  @Get()
  findOccupancy(
    @Param('arenaId') arenaId: string,
    @Param('courtId') courtId: string,
    @Query() query: BookingWindowQueryDto,
  ): Promise<BookingOccupancy[]> {
    return this.bookingsService.findOccupancy(
      arenaId,
      courtId,
      new Date(query.from),
      new Date(query.to),
    );
  }

  // Visão administrativa (com dados do responsável) — só OWNER/ADMIN.
  @Get('admin')
  @UseGuards(ArenaAccessGuard)
  @RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)
  findManyAdmin(
    @Param('arenaId') arenaId: string,
    @Param('courtId') courtId: string,
    @Query() query: BookingWindowQueryDto,
  ): Promise<BookingDetailed[]> {
    return this.bookingsService.findManyAdmin(
      arenaId,
      courtId,
      new Date(query.from),
      new Date(query.to),
    );
  }

  // Sem ArenaAccessGuard: autorização é por recurso (dono da reserva OU
  // OWNER/ADMIN), resolvida dentro de BookingsService.cancel — o mesmo
  // motivo pelo qual a criação de CUSTOMER também não usa esse guard.
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @Post(':bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() authUser: AuthenticatedUser,
    @Param('arenaId') arenaId: string,
    @Param('courtId') courtId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<Booking> {
    const user = await this.usersService.findByClerkId(authUser.clerkId);
    const booking = await this.bookingsService.cancel(arenaId, courtId, bookingId, user.id);

    // Fase 27, Regra 2/5 — mesmo endpoint pra CUSTOMER, OWNER e ADMIN
    // (nenhuma regra diferente por quem cancela); `refundIfPaid` é
    // idempotente (Regra 6/7), então chamar de novo numa reserva já
    // cancelada (retry, duplo clique) é sempre seguro. Nunca deixa uma
    // falha de refund virar erro na resposta de cancelamento — o
    // cancelamento em si já está confirmado; o refund fica elegível pra
    // nova tentativa na próxima chamada.
    try {
      await this.paymentsService.refundIfPaid(booking.id);
    } catch (error) {
      this.logger.error(
        `Falha ao processar reembolso da Booking ${booking.id}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }

    return booking;
  }

  private assertIdempotencyKey(key: string | undefined): asserts key is string {
    if (!key || key.trim().length === 0) {
      throw new BadRequestException('Header Idempotency-Key é obrigatório.');
    }
  }
}
