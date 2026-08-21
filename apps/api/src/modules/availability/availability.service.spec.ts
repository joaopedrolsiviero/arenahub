import { BadRequestException } from '@nestjs/common';
import { BookingStatus, Weekday } from '@prisma/client';
import { AvailabilityService } from './availability.service';
import { CourtsService } from '../courts/courts.service';
import { OperatingHoursService } from '../operating-hours/operating-hours.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AvailabilityService', () => {
  let prisma: { booking: { findMany: jest.Mock }; arena: { findUniqueOrThrow: jest.Mock } };
  let courtsService: { findOne: jest.Mock };
  let operatingHoursService: { getRawIntervalsForArena: jest.Mock };
  let service: AvailabilityService;

  const activeCourt = {
    id: 'court-1',
    arenaId: 'arena-1',
    isActive: true,
    slotDurationMinutes: 60,
    bufferMinutes: 15,
  };

  const timezone = 'America/Sao_Paulo';
  // Arena aberta quinta-feira 08:00-22:00 — cobre toda a janela usada pelos
  // testes abaixo (2026-08-20 é uma quinta-feira) com folga suficiente para
  // buffer não ser um fator de confusão nos testes que não são sobre isso.
  const thursdayAllDay = [{ dayOfWeek: Weekday.THURSDAY, opensAt: 480, closesAt: 1320 }];

  beforeEach(() => {
    prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      arena: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone }) },
    };
    courtsService = { findOne: jest.fn().mockResolvedValue(activeCourt) };
    operatingHoursService = {
      getRawIntervalsForArena: jest.fn().mockResolvedValue(thursdayAllDay),
    };
    service = new AvailabilityService(
      prisma as unknown as PrismaService,
      courtsService as unknown as CourtsService,
      operatingHoursService as unknown as OperatingHoursService,
    );
  });

  const from = new Date('2026-08-20T08:00:00-03:00');
  const to = new Date('2026-08-20T11:00:00-03:00');

  it('gera slots de slotDurationMinutes cobrindo a janela, todos disponíveis sem reservas', async () => {
    const result = await service.getAvailability('arena-1', 'court-1', from, to);

    expect(result.slots).toEqual([
      {
        startsAt: new Date('2026-08-20T08:00:00-03:00'),
        endsAt: new Date('2026-08-20T09:00:00-03:00'),
        available: true,
      },
      {
        startsAt: new Date('2026-08-20T09:00:00-03:00'),
        endsAt: new Date('2026-08-20T10:00:00-03:00'),
        available: true,
      },
      {
        startsAt: new Date('2026-08-20T10:00:00-03:00'),
        endsAt: new Date('2026-08-20T11:00:00-03:00'),
        available: true,
      },
    ]);
  });

  it('retorna courtId/timezone/from/to junto com os slots', async () => {
    const result = await service.getAvailability('arena-1', 'court-1', from, to);

    expect(result.courtId).toBe('court-1');
    expect(result.timezone).toBe(timezone);
    expect(result.from).toBe(from);
    expect(result.to).toBe(to);
  });

  it('não emite slot parcial quando a janela não é múltiplo exato da duração', async () => {
    const result = await service.getAvailability(
      'arena-1',
      'court-1',
      from,
      new Date('2026-08-20T09:30:00-03:00'),
    );
    expect(result.slots).toHaveLength(1);
  });

  it('o buffer bloqueia simetricamente os slots vizinhos na grade, não só o que coincide com a reserva', async () => {
    // Reserva 09:00-10:00 (buffer 15min, occupied até 10:15) numa janela de
    // 4 slots (08:00-12:00). O slot 08:00-09:00 também fica indisponível:
    // se fosse criado, seu PRÓPRIO buffer (08:00-09:00 + 15min = até 09:15)
    // esbarraria no início da reserva às 09:00 — mesma semântica simétrica
    // usada pela EXCLUDE constraint real (confirmado: essa mesma combinação
    // seria de fato rejeitada por BookingsService.create). O slot 10:00-11:00
    // também é bloqueado pelo buffer da reserva existente (até 10:15). Só
    // 11:00-12:00, fora do alcance do buffer nos dois sentidos, fica livre.
    prisma.booking.findMany.mockResolvedValue([
      {
        startsAt: new Date('2026-08-20T09:00:00-03:00'),
        endsAt: new Date('2026-08-20T10:00:00-03:00'),
        bufferMinutesSnapshot: 15,
      },
    ]);

    const result = await service.getAvailability(
      'arena-1',
      'court-1',
      from,
      new Date('2026-08-20T12:00:00-03:00'),
    );

    expect(result.slots.map((s) => s.available)).toEqual([false, false, false, true]);
  });

  it('o buffer da reserva anterior torna o próximo slot indisponível mesmo sem overlap direto', async () => {
    // Reserva 08:00-09:00 com buffer 15min ocupa efetivamente até 09:15 —
    // o slot 09:00-10:00 esbarra nesse buffer mesmo não coincidindo com o
    // horário bruto da reserva.
    prisma.booking.findMany.mockResolvedValue([
      {
        startsAt: new Date('2026-08-20T08:00:00-03:00'),
        endsAt: new Date('2026-08-20T09:00:00-03:00'),
        bufferMinutesSnapshot: 15,
      },
    ]);

    const result = await service.getAvailability('arena-1', 'court-1', from, to);

    expect(result.slots.map((s) => s.available)).toEqual([false, false, true]);
  });

  it('reserva com buffer 0 (BLOCK/MAINTENANCE) só ocupa o intervalo exato, sem bleed', async () => {
    prisma.booking.findMany.mockResolvedValue([
      {
        startsAt: new Date('2026-08-20T08:00:00-03:00'),
        endsAt: new Date('2026-08-20T09:00:00-03:00'),
        bufferMinutesSnapshot: 0,
      },
    ]);

    const result = await service.getAvailability('arena-1', 'court-1', from, to);

    expect(result.slots.map((s) => s.available)).toEqual([false, true, true]);
  });

  it('consulta apenas reservas CONFIRMED — cancelados nunca entram na query de ocupação', async () => {
    await service.getAvailability('arena-1', 'court-1', from, to);

    const [[call]] = prisma.booking.findMany.mock.calls as [[{ where: { status: BookingStatus } }]];
    expect(call.where.status).toBe(BookingStatus.CONFIRMED);
  });

  it('quadra inativa: todos os slots vêm marcados indisponíveis, sem consultar bookings', async () => {
    courtsService.findOne.mockResolvedValue({ ...activeCourt, isActive: false });

    const result = await service.getAvailability('arena-1', 'court-1', from, to);

    expect(result.slots.every((s) => !s.available)).toBe(true);
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it('lança BadRequestException quando "to" não é posterior a "from"', async () => {
    await expect(service.getAvailability('arena-1', 'court-1', to, from)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('propaga o erro do CourtsService quando a quadra não existe/pertence a outra arena', async () => {
    const notFound = new Error('não encontrada');
    courtsService.findOne.mockRejectedValue(notFound);

    await expect(service.getAvailability('arena-1', 'court-1', from, to)).rejects.toBe(notFound);
  });

  describe('horário de funcionamento (Fase 5)', () => {
    it('arena fechada nesse dia da semana: nenhum slot é gerado', async () => {
      operatingHoursService.getRawIntervalsForArena.mockResolvedValue([
        { dayOfWeek: Weekday.FRIDAY, opensAt: 480, closesAt: 1320 }, // só sexta, a janela é quinta
      ]);

      const result = await service.getAvailability('arena-1', 'court-1', from, to);

      expect(result.slots).toEqual([]);
    });

    it('slots são ancorados na abertura do intervalo, não no "from" da query', async () => {
      // Abre às 08:30 (não 08:00) — o primeiro slot deve começar às 08:30,
      // não às 08:00 (mesmo o "from" da query sendo 08:00).
      operatingHoursService.getRawIntervalsForArena.mockResolvedValue([
        { dayOfWeek: Weekday.THURSDAY, opensAt: 510, closesAt: 1320 },
      ]);

      const result = await service.getAvailability('arena-1', 'court-1', from, to);

      expect(result.slots[0]?.startsAt).toEqual(new Date('2026-08-20T08:30:00-03:00'));
    });

    it('não gera slot cujo horário nominal ultrapasse o fechamento (último slot exato, item 24)', async () => {
      // Funcionamento 08:00→18:00, duração 60min — o último slot possível
      // começa às 17:00 e termina exatamente às 18:00; não deve gerar um
      // slot 18:00-19:00 que ultrapassaria o fechamento.
      operatingHoursService.getRawIntervalsForArena.mockResolvedValue([
        { dayOfWeek: Weekday.THURSDAY, opensAt: 480, closesAt: 1080 },
      ]);

      const result = await service.getAvailability(
        'arena-1',
        'court-1',
        from,
        new Date('2026-08-20T19:00:00-03:00'),
      );

      const lastSlot = result.slots.at(-1);
      expect(lastSlot?.startsAt).toEqual(new Date('2026-08-20T17:00:00-03:00'));
      expect(lastSlot?.endsAt).toEqual(new Date('2026-08-20T18:00:00-03:00'));
      expect(
        result.slots.some(
          (s) => s.startsAt.getTime() >= new Date('2026-08-20T18:00:00-03:00').getTime(),
        ),
      ).toBe(false);
    });

    it('slot cujo buffer ultrapassaria o fechamento fica indisponível, mesmo com horário nominal dentro', async () => {
      // Fecha às 10:00. Slot 09:00-10:00 cabe nominalmente, mas seu buffer
      // de 15min (até 10:15) ultrapassa o fechamento — deve ficar
      // indisponível (não pode "vazar" para depois do fechamento).
      operatingHoursService.getRawIntervalsForArena.mockResolvedValue([
        { dayOfWeek: Weekday.THURSDAY, opensAt: 480, closesAt: 600 },
      ]);

      const result = await service.getAvailability('arena-1', 'court-1', from, to);

      expect(result.slots.map((s) => s.available)).toEqual([true, false]);
    });

    it('múltiplos intervalos no mesmo dia geram grades independentes, sem slot na lacuna entre eles', async () => {
      // 08:00-10:00 e 14:00-16:00 — nada entre 10:00 e 14:00.
      operatingHoursService.getRawIntervalsForArena.mockResolvedValue([
        { dayOfWeek: Weekday.THURSDAY, opensAt: 480, closesAt: 600 },
        { dayOfWeek: Weekday.THURSDAY, opensAt: 840, closesAt: 960 },
      ]);

      const result = await service.getAvailability(
        'arena-1',
        'court-1',
        from,
        new Date('2026-08-20T16:00:00-03:00'),
      );

      expect(result.slots.map((s) => s.startsAt)).toEqual([
        new Date('2026-08-20T08:00:00-03:00'),
        new Date('2026-08-20T09:00:00-03:00'),
        new Date('2026-08-20T14:00:00-03:00'),
        new Date('2026-08-20T15:00:00-03:00'),
      ]);
    });

    it('MAINTENANCE/BLOCK (buffer 0) bloqueiam disponibilidade mesmo perto do fechamento', async () => {
      // Quadra com bufferMinutes 0 aqui para isolar o efeito do buffer=0 da
      // reserva existente, sem o buffer do próprio slot candidato (já
      // coberto pelo teste "buffer bloqueia simetricamente" acima) entrar
      // como fator adicional.
      courtsService.findOne.mockResolvedValue({ ...activeCourt, bufferMinutes: 0 });
      operatingHoursService.getRawIntervalsForArena.mockResolvedValue([
        { dayOfWeek: Weekday.THURSDAY, opensAt: 480, closesAt: 600 },
      ]);
      prisma.booking.findMany.mockResolvedValue([
        {
          startsAt: new Date('2026-08-20T09:00:00-03:00'),
          endsAt: new Date('2026-08-20T10:00:00-03:00'),
          bufferMinutesSnapshot: 0,
        },
      ]);

      const result = await service.getAvailability('arena-1', 'court-1', from, to);

      expect(result.slots.map((s) => s.available)).toEqual([true, false]);
    });
  });

  // Fase 8, item 39: a checagem "está dentro do horário de funcionamento?"
  // (isWithinOperatingHours) já é testada com DST em operating-hours.util
  // .spec.ts — mas o próprio loop de geração de slots aqui (buildSlots) faz
  // sua própria iteração de dias via Luxon (`day.plus({days:1})`), então
  // vale provar explicitamente que ele também resolve o instante UTC
  // correto atravessando uma transição real de DST, não só a checagem de
  // horário isolada.
  describe('DST (America/New_York)', () => {
    it('gera slots com o instante UTC correto antes e depois da transição de DST (8/mar/2026)', async () => {
      operatingHoursService.getRawIntervalsForArena.mockResolvedValue([
        { dayOfWeek: Weekday.SUNDAY, opensAt: 480, closesAt: 600 }, // 08:00-10:00 local
      ]);
      prisma.arena.findUniqueOrThrow.mockResolvedValue({ timezone: 'America/New_York' });

      // 1/fev/2026 é domingo, ainda em UTC-5 (antes do DST).
      const beforeDst = await service.getAvailability(
        'arena-1',
        'court-1',
        new Date('2026-02-01T00:00:00Z'),
        new Date('2026-02-02T00:00:00Z'),
      );
      expect(beforeDst.slots[0]?.startsAt).toEqual(new Date('2026-02-01T13:00:00Z')); // 08:00 EST = 13:00 UTC

      // 8/mar/2026 é domingo, dia da transição — já em UTC-4 a partir das 2h locais.
      const onDstDay = await service.getAvailability(
        'arena-1',
        'court-1',
        new Date('2026-03-08T00:00:00Z'),
        new Date('2026-03-09T00:00:00Z'),
      );
      expect(onDstDay.slots[0]?.startsAt).toEqual(new Date('2026-03-08T12:00:00Z')); // 08:00 EDT = 12:00 UTC
    });
  });
});
