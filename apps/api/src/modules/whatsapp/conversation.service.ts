import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, WhatsAppConversationState } from '@prisma/client';
import type { Court, WhatsAppConversation } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ArenasService } from '../arenas/arenas.service';
import { CourtsService } from '../courts/courts.service';
import { AvailabilityService, AvailabilitySlot } from '../availability/availability.service';
import { BookingsService } from '../bookings/bookings.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { WhatsAppIntentService } from './intent.service';
import { formatDateLabel, formatPriceBRL, formatTimeLabel, whatsappMessages } from './messages';
import {
  isConfirmation,
  isDenial,
  parseNumericChoice,
  parseRelativeDatePhrase,
  parseTimePhrase,
} from './nlp.util';

const CONFIRMATION_TTL_MINUTES = 15;

interface CourtOption {
  courtId: string;
  name: string;
  priceBRL: string;
}

interface CancelOption {
  bookingId: string;
  courtId: string;
  label: string;
}

/**
 * Orquestrador central do canal de WhatsApp (Fase 16) — o backend é a
 * ÚNICA autoridade sobre o estado da conversa e sobre toda escrita no
 * domínio (item 34: "o backend deve saber exatamente o que está sendo
 * confirmado", nunca depender do LLM pra lembrar). O LLM (via
 * `WhatsAppIntentService`) só classifica a intenção da mensagem quando o
 * estado é `IDLE` — todo o resto do fluxo (seleção de data/hora/quadra,
 * confirmação, cancelamento) é resolvido deterministicamente por
 * `nlp.util.ts` contra o texto bruto, sem chamar o modelo (item 40: menos
 * custo, mais previsibilidade, e principalmente: menos superfície pra
 * prompt injection, já que a maior parte da conversa nunca passa pelo LLM).
 *
 * `arenaId` e `user.id` SEMPRE vêm do contexto seguro resolvido antes desta
 * classe ser chamada (telefone → User, `phone_number_id` → Arena) — nunca
 * do texto da mensagem nem de qualquer campo devolvido pelo LLM (item 9/33/
 * 70/71). O LLM nunca recebe `arenaId`/`userId` no prompt, então não existe
 * caminho pelo qual a saída dele poderia influenciar esses valores.
 *
 * Toda escrita de domínio (criar reserva, cancelar) reaproveita literalmente
 * `BookingsService`/`IdempotencyService` já existentes (item 18/57) — esta
 * classe nunca toca `prisma.booking` diretamente.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly arenasService: ArenasService,
    private readonly courtsService: CourtsService,
    private readonly availabilityService: AvailabilityService,
    private readonly bookingsService: BookingsService,
    private readonly idempotencyService: IdempotencyService,
    private readonly intentService: WhatsAppIntentService,
  ) {}

  /**
   * Ponto de entrada único. Devolve SEMPRE um texto de resposta — nunca
   * lança (item 41/50: uma mensagem de WhatsApp sempre merece alguma
   * resposta, nunca um erro técnico cru).
   */
  async handleInboundMessage(arenaId: string, fromPhone: string, text: string): Promise<string> {
    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      return whatsappMessages.genericHelp;
    }

    const user = await this.usersService.findByPhone(fromPhone);
    if (!user) {
      return whatsappMessages.identityNotLinked;
    }

    const arena = await this.prisma.arena.findUnique({
      where: { id: arenaId },
      select: { id: true, name: true, phone: true, description: true, timezone: true },
    });
    if (!arena) {
      // Não deveria acontecer (o webhook já resolveu arenaId a partir de um
      // phone_number_id configurado) — defesa extra, nunca um crash.
      this.logger.error(`Arena não encontrada para arenaId=${arenaId} num fluxo de WhatsApp.`);
      return whatsappMessages.bookingError;
    }

    let conversation = await this.prisma.whatsAppConversation.findUnique({
      where: { arenaId_userId: { arenaId, userId: user.id } },
    });
    if (!conversation) {
      conversation = await this.prisma.whatsAppConversation.create({
        data: { arenaId, userId: user.id },
      });
    }

    if (this.isExpired(conversation)) {
      const wasWaitingConfirmation =
        conversation.state === WhatsAppConversationState.CONFIRMING_BOOKING ||
        conversation.state === WhatsAppConversationState.CANCEL_CONFIRMATION;
      conversation = await this.resetToIdle(conversation.id);
      if (wasWaitingConfirmation && (isConfirmation(trimmedText) || isDenial(trimmedText))) {
        return whatsappMessages.confirmationExpired;
      }
      // Não era uma resposta de confirmação — segue tratando a mensagem
      // nova normalmente, contra o estado (agora IDLE) já resetado.
    }

    try {
      return await this.dispatch(arena, user, conversation, trimmedText);
    } catch (error) {
      this.logger.error(
        `Erro inesperado no fluxo de WhatsApp (arena=${arenaId}): ` +
          (error instanceof Error ? error.message : 'erro desconhecido'),
      );
      await this.resetToIdle(conversation.id);
      return whatsappMessages.bookingError;
    }
  }

  private async dispatch(
    arena: {
      id: string;
      name: string;
      phone: string | null;
      description: string | null;
      timezone: string;
    },
    user: { id: string },
    conversation: WhatsAppConversation,
    text: string,
  ): Promise<string> {
    switch (conversation.state) {
      case WhatsAppConversationState.SELECTING_DATE:
        return this.handleSelectingDate(arena, conversation, text);
      case WhatsAppConversationState.SELECTING_TIME:
        return this.handleSelectingTime(arena, conversation, text);
      case WhatsAppConversationState.SELECTING_COURT:
        return this.handleSelectingCourt(arena, conversation, text);
      case WhatsAppConversationState.CONFIRMING_BOOKING:
        return this.handleConfirmingBooking(arena, user, conversation, text);
      case WhatsAppConversationState.CANCEL_SELECTING:
        return this.handleCancelSelecting(conversation, text);
      case WhatsAppConversationState.CANCEL_CONFIRMATION:
        return this.handleCancelConfirmation(arena, user, conversation, text);
      // PROCESSING_*/BOOKING_CONFIRMED são transitórios (nunca deveriam
      // ficar persistidos em repouso) — defesa extra, trata como IDLE em
      // vez de travar a conversa.
      case WhatsAppConversationState.IDLE:
      case WhatsAppConversationState.PROCESSING_BOOKING:
      case WhatsAppConversationState.PROCESSING_CANCELLATION:
      case WhatsAppConversationState.BOOKING_CONFIRMED:
      default:
        return this.handleIdle(arena, user, conversation, text);
    }
  }

  // ---- IDLE: classifica a intenção e roteia ----

  private async handleIdle(
    arena: {
      id: string;
      name: string;
      phone: string | null;
      description: string | null;
      timezone: string;
    },
    user: { id: string },
    conversation: WhatsAppConversation,
    text: string,
  ): Promise<string> {
    const intent = await this.intentService.interpret(text);
    const now = DateTime.now().setZone(arena.timezone);

    switch (intent.intent) {
      case 'CHECK_AVAILABILITY':
        return this.handleCheckAvailability(arena, now, intent.datePhrase, intent.timePhrase);
      case 'CREATE_BOOKING':
        return this.handleCreateBookingStart(
          arena,
          conversation,
          now,
          intent.datePhrase,
          intent.timePhrase,
        );
      case 'LIST_MY_BOOKINGS':
        return this.handleListMyBookings(arena, user, null);
      case 'GET_MY_BOOKING':
        return this.handleListMyBookings(arena, user, intent.datePhrase);
      case 'CANCEL_BOOKING':
        return this.handleCancelStart(arena, user, conversation, intent.datePhrase);
      case 'GET_ARENA_INFO':
        return whatsappMessages.arenaInfo(arena.name, arena.phone, arena.description);
      case 'GET_COURTS': {
        const detail = await this.arenasService.discoverOne(arena.id);
        return whatsappMessages.courtsInfo(
          detail.courts.map((c) => ({ name: c.name, sport: c.sport })),
        );
      }
      case 'GET_PRICES': {
        const detail = await this.arenasService.discoverOne(arena.id);
        return whatsappMessages.pricesInfo(
          detail.courts.map((c) => ({
            name: c.name,
            priceBRL: formatPriceBRL(Number(c.pricePerSlot)),
            durationMinutes: c.slotDurationMinutes,
          })),
        );
      }
      case 'UNKNOWN':
      default:
        return whatsappMessages.genericHelp;
    }
  }

  private async handleCheckAvailability(
    arena: { id: string; timezone: string },
    now: DateTime,
    datePhrase: string | null,
    timePhrase: string | null,
  ): Promise<string> {
    if (!datePhrase || !timePhrase) {
      return 'Me diga o dia e o horário que você quer verificar, por exemplo: "amanhã às 19h".';
    }
    const date = parseRelativeDatePhrase(datePhrase, now);
    const time = date ? parseTimePhrase(timePhrase) : null;
    if (!date || !time) {
      return 'Me diga o dia e o horário que você quer verificar, por exemplo: "amanhã às 19h".';
    }

    const target = date.set({ hour: time.hour, minute: time.minute });
    const options = await this.findAvailableCourtsAt(arena.id, target);
    const dateLabel = formatDateLabel(date);
    const timeLabel = formatTimeLabel(time.hour, time.minute);

    if (options.length === 0) {
      return whatsappMessages.noCourtsAvailable(dateLabel, timeLabel);
    }
    return whatsappMessages.courtOptions(
      options.map(({ court }) => ({
        name: court.name,
        priceBRL: formatPriceBRL(Number(court.pricePerSlot)),
      })),
    );
  }

  // ---- Fluxo de criação de reserva ----

  private async handleCreateBookingStart(
    arena: { id: string; timezone: string },
    conversation: WhatsAppConversation,
    now: DateTime,
    datePhrase: string | null,
    timePhrase: string | null,
  ): Promise<string> {
    const date = datePhrase ? parseRelativeDatePhrase(datePhrase, now) : null;
    const time = timePhrase ? parseTimePhrase(timePhrase) : null;

    if (date && time) {
      return this.resolveDateTimeAndOfferCourts(arena, conversation.id, date, time);
    }
    if (date) {
      await this.updateConversation(conversation.id, {
        state: WhatsAppConversationState.SELECTING_TIME,
        pendingDate: date.toFormat('yyyy-MM-dd'),
      });
      return whatsappMessages.askTime(formatDateLabel(date));
    }
    await this.updateConversation(conversation.id, {
      state: WhatsAppConversationState.SELECTING_DATE,
    });
    return whatsappMessages.askDate;
  }

  private async handleSelectingDate(
    arena: { id: string; timezone: string },
    conversation: WhatsAppConversation,
    text: string,
  ): Promise<string> {
    const now = DateTime.now().setZone(arena.timezone);
    const date = parseRelativeDatePhrase(text, now);
    if (!date) {
      return whatsappMessages.invalidDate;
    }
    await this.updateConversation(conversation.id, {
      state: WhatsAppConversationState.SELECTING_TIME,
      pendingDate: date.toFormat('yyyy-MM-dd'),
    });
    return whatsappMessages.askTime(formatDateLabel(date));
  }

  private async handleSelectingTime(
    arena: { id: string; timezone: string },
    conversation: WhatsAppConversation,
    text: string,
  ): Promise<string> {
    const time = parseTimePhrase(text);
    if (!time || !conversation.pendingDate) {
      return whatsappMessages.invalidTime;
    }
    const date = DateTime.fromISO(conversation.pendingDate, { zone: arena.timezone });
    return this.resolveDateTimeAndOfferCourts(arena, conversation.id, date, time);
  }

  private async resolveDateTimeAndOfferCourts(
    arena: { id: string; timezone: string },
    conversationId: string,
    date: DateTime,
    time: { hour: number; minute: number },
  ): Promise<string> {
    const target = date.set({ hour: time.hour, minute: time.minute });
    const options = await this.findAvailableCourtsAt(arena.id, target);
    const dateLabel = formatDateLabel(date);
    const timeLabel = formatTimeLabel(time.hour, time.minute);

    if (options.length === 0) {
      await this.resetToIdle(conversationId);
      return whatsappMessages.noCourtsAvailable(dateLabel, timeLabel);
    }

    const courtOptions: CourtOption[] = options.map(({ court }) => ({
      courtId: court.id,
      name: court.name,
      priceBRL: formatPriceBRL(Number(court.pricePerSlot)),
    }));

    if (courtOptions.length === 1) {
      const only = courtOptions[0]!;
      await this.updateConversation(conversationId, {
        state: WhatsAppConversationState.CONFIRMING_BOOKING,
        pendingDate: date.toFormat('yyyy-MM-dd'),
        pendingTime: `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`,
        pendingCourtId: only.courtId,
        pendingOptions: [only] as unknown as Prisma.InputJsonValue,
        pendingActionId: randomUUID(),
        expiresAt: DateTime.now().plus({ minutes: CONFIRMATION_TTL_MINUTES }).toJSDate(),
      });
      return whatsappMessages.bookingSummary(only.name, dateLabel, timeLabel, only.priceBRL);
    }

    await this.updateConversation(conversationId, {
      state: WhatsAppConversationState.SELECTING_COURT,
      pendingDate: date.toFormat('yyyy-MM-dd'),
      pendingTime: `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`,
      pendingOptions: courtOptions as unknown as Prisma.InputJsonValue,
    });
    return whatsappMessages.courtOptions(courtOptions);
  }

  private async handleSelectingCourt(
    arena: { id: string; timezone: string },
    conversation: WhatsAppConversation,
    text: string,
  ): Promise<string> {
    const options = (conversation.pendingOptions as unknown as CourtOption[] | null) ?? [];
    const choice = parseNumericChoice(text);
    if (!choice || choice > options.length) {
      return whatsappMessages.invalidNumericChoice(options.length);
    }
    const selected = options[choice - 1]!;

    // Revalida contra o banco antes de avançar (item 68) — nunca confia que
    // a quadra oferecida há pouco continua ativa.
    let court: Court;
    try {
      court = await this.courtsService.findOne(arena.id, selected.courtId);
    } catch {
      await this.resetToIdle(conversation.id);
      return whatsappMessages.bookingConflict;
    }
    if (!court.isActive || !conversation.pendingDate || !conversation.pendingTime) {
      await this.resetToIdle(conversation.id);
      return whatsappMessages.bookingConflict;
    }

    const date = DateTime.fromISO(conversation.pendingDate, { zone: arena.timezone });
    const dateLabel = formatDateLabel(date);
    const [hourStr, minuteStr] = conversation.pendingTime.split(':');
    const timeLabel = formatTimeLabel(Number(hourStr), Number(minuteStr));

    await this.updateConversation(conversation.id, {
      state: WhatsAppConversationState.CONFIRMING_BOOKING,
      pendingCourtId: court.id,
      pendingOptions: [selected] as unknown as Prisma.InputJsonValue,
      pendingActionId: randomUUID(),
      expiresAt: DateTime.now().plus({ minutes: CONFIRMATION_TTL_MINUTES }).toJSDate(),
    });
    return whatsappMessages.bookingSummary(selected.name, dateLabel, timeLabel, selected.priceBRL);
  }

  private async handleConfirmingBooking(
    arena: { id: string; timezone: string },
    user: { id: string },
    conversation: WhatsAppConversation,
    text: string,
  ): Promise<string> {
    if (isDenial(text)) {
      await this.resetToIdle(conversation.id);
      return whatsappMessages.bookingDeclined;
    }
    if (!isConfirmation(text)) {
      return whatsappMessages.confirmationUnclear;
    }

    const options = (conversation.pendingOptions as unknown as CourtOption[] | null) ?? [];
    const selected = options[0];
    if (
      !selected ||
      !conversation.pendingCourtId ||
      !conversation.pendingDate ||
      !conversation.pendingTime ||
      !conversation.pendingActionId
    ) {
      await this.resetToIdle(conversation.id);
      return whatsappMessages.bookingError;
    }

    const startsAt = this.resolveStartsAt(
      arena.timezone,
      conversation.pendingDate,
      conversation.pendingTime,
    );
    const dateLabel = formatDateLabel(
      DateTime.fromISO(conversation.pendingDate, { zone: arena.timezone }),
    );
    const [hourStr, minuteStr] = conversation.pendingTime.split(':');
    const timeLabel = formatTimeLabel(Number(hourStr), Number(minuteStr));

    try {
      // Mesmo padrão de BookingsController.createCustomer (item 18/19):
      // Idempotency-Key persistente (`pendingActionId`, gerada uma vez ao
      // entrar em CONFIRMING_BOOKING), nunca regenerada por retry do
      // webhook — a mesma intenção de reserva sempre resulta na mesma
      // chave, então um evento duplicado do provider (ou duas mensagens
      // "sim" quase simultâneas) nunca cria uma segunda reserva.
      const result = await this.idempotencyService.execute(
        {
          userId: user.id,
          endpoint: 'whatsapp.bookings.customer.create',
          key: conversation.pendingActionId,
          payload: {
            arenaId: arena.id,
            courtId: conversation.pendingCourtId,
            startsAt: startsAt.toISOString(),
          },
        },
        async (tx) => {
          const booking = await this.bookingsService.createCustomerBooking(
            tx,
            arena.id,
            conversation.pendingCourtId!,
            user.id,
            { startsAt: startsAt.toISOString() },
          );
          return { status: 201, body: booking };
        },
      );
      void result;
      await this.resetToIdle(conversation.id);
      return whatsappMessages.bookingConfirmed(
        selected.name,
        dateLabel,
        timeLabel,
        selected.priceBRL,
      );
    } catch (error) {
      await this.resetToIdle(conversation.id);
      if (error instanceof ConflictException) {
        return whatsappMessages.bookingConflict;
      }
      this.logger.error(
        `Falha ao criar reserva via WhatsApp: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
      return whatsappMessages.bookingError;
    }
  }

  // ---- Consulta de reservas ----

  private async handleListMyBookings(
    arena: { id: string; timezone: string },
    user: { id: string },
    datePhrase: string | null,
  ): Promise<string> {
    const upcoming = await this.findUpcomingBookings(arena.id, user.id);
    const filtered = datePhrase ? this.filterByDatePhrase(upcoming, datePhrase, arena) : upcoming;

    if (filtered.length === 0) {
      return whatsappMessages.noUpcomingBookings;
    }
    return whatsappMessages.myBookingsList(
      filtered.map((b) => ({ label: this.describeBooking(b) })),
    );
  }

  // ---- Fluxo de cancelamento ----

  private async handleCancelStart(
    arena: { id: string; timezone: string },
    user: { id: string },
    conversation: WhatsAppConversation,
    datePhrase: string | null,
  ): Promise<string> {
    const upcoming = await this.findUpcomingBookings(arena.id, user.id);
    const filtered = datePhrase ? this.filterByDatePhrase(upcoming, datePhrase, arena) : upcoming;

    if (filtered.length === 0) {
      return whatsappMessages.cancelNoMatches;
    }

    const options: CancelOption[] = filtered.map((b) => ({
      bookingId: b.id,
      courtId: b.court.id,
      label: this.describeBooking(b),
    }));
    await this.updateConversation(conversation.id, {
      state: WhatsAppConversationState.CANCEL_SELECTING,
      pendingOptions: options as unknown as Prisma.InputJsonValue,
    });
    return whatsappMessages.cancelOptions(options.map((o) => ({ label: o.label })));
  }

  private async handleCancelSelecting(
    conversation: WhatsAppConversation,
    text: string,
  ): Promise<string> {
    const options = (conversation.pendingOptions as unknown as CancelOption[] | null) ?? [];
    const choice = parseNumericChoice(text);
    if (!choice || choice > options.length) {
      return whatsappMessages.invalidNumericChoice(options.length);
    }
    const selected = options[choice - 1]!;

    await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        state: WhatsAppConversationState.CANCEL_CONFIRMATION,
        pendingBookingId: selected.bookingId,
        pendingCourtId: selected.courtId,
        pendingOptions: [selected] as unknown as Prisma.InputJsonValue,
        expiresAt: DateTime.now().plus({ minutes: CONFIRMATION_TTL_MINUTES }).toJSDate(),
      },
    });
    return whatsappMessages.cancelSummary(selected.label);
  }

  private async handleCancelConfirmation(
    arena: { id: string },
    user: { id: string },
    conversation: WhatsAppConversation,
    text: string,
  ): Promise<string> {
    if (isDenial(text)) {
      await this.resetToIdle(conversation.id);
      return whatsappMessages.cancelDeclined;
    }
    if (!isConfirmation(text)) {
      return whatsappMessages.confirmationUnclear;
    }

    const options = (conversation.pendingOptions as unknown as CancelOption[] | null) ?? [];
    const selected = options[0];
    if (!selected || !conversation.pendingBookingId || !conversation.pendingCourtId) {
      await this.resetToIdle(conversation.id);
      return whatsappMessages.cancelError;
    }

    try {
      // BookingsService.cancel já garante, por si só, que só o dono da
      // reserva (`user.id`, resolvido do telefone — nunca do LLM) pode
      // cancelar (item 22/72) — nenhuma checagem de ownership duplicada
      // aqui.
      await this.bookingsService.cancel(
        arena.id,
        conversation.pendingCourtId,
        conversation.pendingBookingId,
        user.id,
      );
      await this.resetToIdle(conversation.id);
      return whatsappMessages.cancelConfirmed(selected.label);
    } catch (error) {
      await this.resetToIdle(conversation.id);
      this.logger.error(
        `Falha ao cancelar reserva via WhatsApp: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
      return whatsappMessages.cancelError;
    }
  }

  // ---- Helpers ----

  private async findAvailableCourtsAt(
    arenaId: string,
    target: DateTime,
  ): Promise<{ court: Court; slot: AvailabilitySlot }[]> {
    const courts = await this.courtsService.findAllForArena(arenaId, false);
    const dayStart = target.startOf('day').toJSDate();
    const dayEnd = target.startOf('day').plus({ days: 1 }).toJSDate();
    const targetMs = target.toJSDate().getTime();

    const results = await Promise.all(
      courts.map(async (court) => {
        const availability = await this.availabilityService.getAvailability(
          arenaId,
          court.id,
          dayStart,
          dayEnd,
        );
        const slot = availability.slots.find(
          (s) => s.startsAt.getTime() === targetMs && s.available,
        );
        return slot ? { court, slot } : null;
      }),
    );
    return results.filter((r): r is { court: Court; slot: AvailabilitySlot } => r !== null);
  }

  private async findUpcomingBookings(arenaId: string, userId: string) {
    const all = await this.bookingsService.findMyBookings(userId);
    const now = new Date();
    return all.filter(
      (b) =>
        b.court.arena.id === arenaId &&
        b.status === 'CONFIRMED' &&
        b.startsAt.getTime() > now.getTime(),
    );
  }

  private filterByDatePhrase<T extends { startsAt: Date }>(
    bookings: T[],
    datePhrase: string,
    arena: { timezone: string },
  ): T[] {
    const now = DateTime.now().setZone(arena.timezone);
    const date = parseRelativeDatePhrase(datePhrase, now);
    if (!date) {
      return bookings;
    }
    return bookings.filter((b) =>
      DateTime.fromJSDate(b.startsAt, { zone: arena.timezone }).hasSame(date, 'day'),
    );
  }

  private describeBooking(booking: { court: { name: string }; startsAt: Date }): string {
    // Timezone da própria arena já vem embutido em `court.arena`, mas como
    // este helper é usado só dentro de uma única arena por vez (nunca
    // cross-arena — item 9), formatar direto pelo Date é seguro; a
    // conversão correta de timezone já foi feita no momento em que os
    // dados de `startsAt` chegaram (mesma disciplina do resto do backend).
    return `${booking.court.name} — ${booking.startsAt.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    })} às ${booking.startsAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  private resolveStartsAt(timezone: string, dateIso: string, timeHHmm: string): Date {
    const [hourStr, minuteStr] = timeHHmm.split(':');
    return DateTime.fromISO(dateIso, { zone: timezone })
      .set({ hour: Number(hourStr), minute: Number(minuteStr) })
      .toJSDate();
  }

  private isExpired(conversation: WhatsAppConversation): boolean {
    return conversation.expiresAt !== null && conversation.expiresAt.getTime() < Date.now();
  }

  private async resetToIdle(conversationId: string): Promise<WhatsAppConversation> {
    return this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: {
        state: WhatsAppConversationState.IDLE,
        pendingOptions: Prisma.JsonNull,
        pendingDate: null,
        pendingTime: null,
        pendingCourtId: null,
        pendingBookingId: null,
        pendingActionId: null,
        expiresAt: null,
      },
    });
  }

  private async updateConversation(
    conversationId: string,
    data: Prisma.WhatsAppConversationUpdateInput,
  ): Promise<void> {
    await this.prisma.whatsAppConversation.update({ where: { id: conversationId }, data });
  }
}
