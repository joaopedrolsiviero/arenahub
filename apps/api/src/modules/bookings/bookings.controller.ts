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
import { PushNotificationsService } from '../notifications/push-notifications.service';
import { WhatsAppNotificationsService } from '../notifications/whatsapp-notifications.service';
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
    // M7 — mesmo padrão: só o controller conhece PushNotificationsService;
    // BookingsService continua sem nenhuma dependência de notificações.
    private readonly pushNotificationsService: PushNotificationsService,
    // W2 — mesmo padrão, canal WhatsApp: só o controller conhece
    // WhatsAppNotificationsService.
    private readonly whatsappNotificationsService: WhatsAppNotificationsService,
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

    // M7, item 8 (idempotência): `replayed` já é o sinal oficial de
    // "isto é um retry de uma requisição já processada" — IdempotencyService
    // só devolve `replayed: false` na execução que realmente criou a(s)
    // Booking(s) agora. Nunca notifica num replay (retry de rede, duplo
    // clique com a mesma Idempotency-Key), nenhum mecanismo novo de
    // deduplicação. Falha ao notificar nunca vira erro pro cliente —
    // PushNotificationsService já nunca lança, mas o try/catch aqui é
    // defesa em profundidade explícita no ponto de disparo.
    if (!result.replayed) {
      const bookings = Array.isArray(result.body) ? result.body : [result.body];
      for (const booking of bookings) {
        try {
          await this.pushNotificationsService.notifyBookingConfirmed(booking);
        } catch (error) {
          this.logger.error(
            `Falha ao notificar confirmação da Booking ${booking.id}: ${
              error instanceof Error ? error.message : 'erro desconhecido'
            }`,
          );
        }
        // W2 — mesmo guard exato do push acima (!result.replayed): nunca
        // notifica num replay de uma requisição já processada (retry HTTP,
        // duplo clique com a mesma Idempotency-Key). Falha de envio nunca
        // vira erro pro cliente — mesma defesa em profundidade.
        try {
          await this.whatsappNotificationsService.notifyBookingConfirmed(booking);
        } catch (error) {
          this.logger.error(
            `Falha ao notificar confirmação via WhatsApp da Booking ${booking.id}: ${
              error instanceof Error ? error.message : 'erro desconhecido'
            }`,
          );
        }
      }
    }

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
    const { booking, cancelledNow } = await this.bookingsService.cancel(
      arenaId,
      courtId,
      bookingId,
      user.id,
    );

    // Fase 27, Regra 2/5 — mesmo endpoint pra CUSTOMER, OWNER e ADMIN
    // (nenhuma regra diferente por quem cancela); `refundIfPaid` é
    // idempotente (Regra 6/7), então chamar de novo numa reserva já
    // cancelada (retry, duplo clique) é sempre seguro. Nunca deixa uma
    // falha de refund virar erro na resposta de cancelamento — o
    // cancelamento em si já está confirmado; o refund fica elegível pra
    // nova tentativa na próxima chamada.
    // W2 — `refunded` só é `true` quando ESTA chamada confirmou REFUNDED
    // agora (nunca um "solicitado"/"em processamento" — ver
    // PaymentsService.refundIfPaid); é o sinal que decide a notificação de
    // reembolso abaixo, sem duplicar nenhuma lógica de reembolso aqui.
    let refunded = false;
    try {
      const refundResult = await this.paymentsService.refundIfPaid(booking.id);
      refunded = refundResult.refunded;
    } catch (error) {
      this.logger.error(
        `Falha ao processar reembolso da Booking ${booking.id}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }

    // M7 — só notifica quando ESTA chamada realmente cancelou (nunca num
    // replay de uma reserva já cancelada, ver BookingsService.cancel).
    if (cancelledNow) {
      try {
        await this.pushNotificationsService.notifyBookingCancelled(booking);
      } catch (error) {
        this.logger.error(
          `Falha ao notificar cancelamento da Booking ${booking.id}: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      }
      // W2 — mesmo guard (cancelledNow): nunca notifica num replay.
      try {
        await this.whatsappNotificationsService.notifyBookingCancelled(booking);
      } catch (error) {
        this.logger.error(
          `Falha ao notificar cancelamento via WhatsApp da Booking ${booking.id}: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      }
    }

    // W2 — reembolso é um evento financeiro distinto do cancelamento da
    // reserva (docs/ARCHITECTURE.md: ciclo financeiro sempre separado do
    // operacional) — notifica independentemente de `cancelledNow` (um
    // reembolso só pode acontecer depois de um cancelamento, mas
    // `refunded` já garante, sozinho, que isto só dispara na chamada que
    // realmente confirmou o reembolso agora).
    if (refunded) {
      try {
        await this.whatsappNotificationsService.notifyRefundConfirmed(booking);
      } catch (error) {
        this.logger.error(
          `Falha ao notificar reembolso via WhatsApp da Booking ${booking.id}: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      }
    }

    return booking;
  }

  private assertIdempotencyKey(key: string | undefined): asserts key is string {
    if (!key || key.trim().length === 0) {
      throw new BadRequestException('Header Idempotency-Key é obrigatório.');
    }
  }
}
