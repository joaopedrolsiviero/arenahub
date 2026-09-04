import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { CourtsService } from '../courts/courts.service';
import { OperatingHoursService } from '../operating-hours/operating-hours.service';
import {
  intervalContains,
  OperatingInterval,
  weekdayFromIso,
} from '../operating-hours/operating-hours.util';

export interface AvailabilitySlot {
  startsAt: Date;
  endsAt: Date;
  available: boolean;
}

export interface AvailabilityResult {
  courtId: string;
  timezone: string;
  from: Date;
  to: Date;
  slots: AvailabilitySlot[];
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Disponibilidade é somente leitura e apenas informativa (nunca cria
 * Booking, nunca é garantia de reserva — a proteção definitiva continua
 * sendo o fluxo de criação em BookingsService, com advisory lock + EXCLUDE
 * constraint).
 *
 * Fase 5: a grade de slots deixou de ser uma janela matemática ancorada em
 * `from` (decisão provisória da Fase 4) e passa a respeitar o horário de
 * funcionamento real da arena, no timezone da arena — cada slot é gerado a
 * partir do horário de ABERTURA de cada intervalo configurado
 * (`ArenaOperatingHours`), não do `from` da query, e nenhum slot é gerado
 * fora do horário de funcionamento. A regra de "esse candidato cabe no
 * intervalo, considerando o buffer?" (`intervalContains`) é a MESMA usada
 * por `BookingsService` para validar a criação — nunca duas implementações.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courtsService: CourtsService,
    private readonly operatingHoursService: OperatingHoursService,
  ) {}

  async getAvailability(
    arenaId: string,
    courtId: string,
    from: Date,
    to: Date,
  ): Promise<AvailabilityResult> {
    const court = await this.courtsService.findOne(arenaId, courtId);
    this.assertValidWindow(from, to);

    // A cadeia arena→court já foi validada acima (404 se courtId não
    // pertence a arenaId) — a arena necessariamente existe neste ponto.
    const arena = await this.prisma.arena.findUniqueOrThrow({
      where: { id: arenaId },
      select: { timezone: true },
    });
    const intervals = await this.operatingHoursService.getRawIntervalsForArena(arenaId);

    // Quadra desativada não deve aparecer como disponível (item 37 da Fase
    // 4) — a grade de slots ainda respeita o horário de funcionamento (só
    // não há razão para consultar Bookings, já que nada fica disponível).
    const bookings = court.isActive
      ? await this.prisma.booking.findMany({
          where: {
            courtId,
            status: BookingStatus.CONFIRMED,
            startsAt: { lt: to },
            // Margem de 24h: bufferMinutes é limitado a 24h (CreateCourtDto),
            // então nenhuma reserva com endsAt anterior a isso pode ter seu
            // buffer avançando para dentro da janela consultada.
            endsAt: { gt: addMinutes(from, -24 * 60) },
          },
          select: { startsAt: true, endsAt: true, bufferMinutesSnapshot: true },
        })
      : [];

    const slots = this.buildSlots(
      from,
      to,
      arena.timezone,
      intervals,
      court.slotDurationMinutes,
      court.bufferMinutes,
      (slotStart, slotEnd) => {
        if (!court.isActive) {
          return false;
        }
        const candidateOccupiedEnd = addMinutes(slotEnd, court.bufferMinutes);
        return !bookings.some((booking) =>
          overlaps(
            slotStart,
            candidateOccupiedEnd,
            booking.startsAt,
            addMinutes(booking.endsAt, booking.bufferMinutesSnapshot),
          ),
        );
      },
    );

    return { courtId, timezone: arena.timezone, from, to, slots };
  }

  private buildSlots(
    from: Date,
    to: Date,
    timezone: string,
    intervals: OperatingInterval[],
    slotDurationMinutes: number,
    courtBufferMinutes: number,
    isOccupancyFree: (slotStart: Date, slotEnd: Date) => boolean,
  ): AvailabilitySlot[] {
    const slots: AvailabilitySlot[] = [];
    const toLocal = DateTime.fromJSDate(to, { zone: timezone });

    let day = DateTime.fromJSDate(from, { zone: timezone }).startOf('day');
    while (day <= toLocal) {
      const dayOfWeek = weekdayFromIso(day.weekday);
      const dayIntervals = intervals.filter((interval) => interval.dayOfWeek === dayOfWeek);

      for (const interval of dayIntervals) {
        let startMinutes = interval.opensAt;
        // Slots ancorados na ABERTURA de cada intervalo (item 22/24 da Fase
        // 5) — nunca no `from` da query, que é arbitrário. O último slot
        // possível é aquele cujo fim nominal ainda cabe até o fechamento.
        while (startMinutes + slotDurationMinutes <= interval.closesAt) {
          const endMinutes = startMinutes + slotDurationMinutes;
          // `.set({hour, minute})`, nunca `.plus({minutes})` — plus() soma
          // duração absoluta (cruza a transição de DST deslocando o
          // horário de parede em 1h no dia da troca), enquanto set() fixa
          // o horário de parede pedido e deixa o Luxon resolver o offset
          // correto para aquele instante (item 39 da Fase 8 — achado real,
          // não só teórico: sem isso, um slot configurado para abrir às
          // 08:00 abriria às 09:00 no dia em que o DST começa).
          const slotStart = day
            .set({ hour: Math.floor(startMinutes / 60), minute: startMinutes % 60 })
            .toJSDate();
          const slotEnd = day
            .set({ hour: Math.floor(endMinutes / 60), minute: endMinutes % 60 })
            .toJSDate();

          if (slotStart.getTime() >= from.getTime() && slotEnd.getTime() <= to.getTime()) {
            // O buffer também precisa caber antes do fechamento (item 25) —
            // não assume "válido" só porque o horário nominal cabe.
            const withinHours = intervalContains(
              interval,
              startMinutes,
              endMinutes + courtBufferMinutes,
            );
            // Item "bloqueio dos horários que já passaram" — comparação
            // sempre contra o instante real (`Date.now()`, nunca o relógio
            // do navegador), com o slot já calculado no timezone da
            // ARENA (nunca o do servidor — `slotStart` acima já é um
            // instante absoluto resolvido a partir do timezone da arena,
            // então comparar dois instantes absolutos aqui é correto
            // independentemente de qual timezone o servidor roda). `>`
            // estrito: um slot cujo início é exatamente agora já está
            // começando, mesmo espírito do bloqueio de cancelamento
            // (`BookingsService.cancel`, `startsAt.getTime() <= now`).
            const hasNotStarted = slotStart.getTime() > Date.now();
            slots.push({
              startsAt: slotStart,
              endsAt: slotEnd,
              available: withinHours && hasNotStarted && isOccupancyFree(slotStart, slotEnd),
            });
          }

          startMinutes += slotDurationMinutes;
        }
      }

      day = day.plus({ days: 1 });
    }

    slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return slots;
  }

  private assertValidWindow(from: Date, to: Date): void {
    if (!(to.getTime() > from.getTime())) {
      throw new BadRequestException('O parâmetro "to" deve ser posterior a "from".');
    }
  }
}
