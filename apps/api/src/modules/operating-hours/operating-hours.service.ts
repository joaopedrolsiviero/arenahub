import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OperatingIntervalDto } from './dto/replace-operating-hours.dto';
import {
  assertValidIntervals,
  OperatingInterval,
  OperatingIntervalView,
  parseHHMM,
  toIntervalView,
} from './operating-hours.util';

/**
 * Horário de funcionamento pertence à Arena (docs/ARCHITECTURE.md, Fase 5) —
 * todas as quadras da arena compartilham a mesma configuração. Responsável
 * só por leitura/escrita/validação da configuração em si — a regra de "esse
 * Booking/slot respeita o horário?" vive em operating-hours.util.ts,
 * reutilizada por AvailabilityService e BookingsService (nunca duas
 * implementações da mesma regra).
 */
@Injectable()
export class OperatingHoursService {
  constructor(private readonly prisma: PrismaService) {}

  async getForArena(arenaId: string): Promise<OperatingIntervalView[]> {
    await this.assertArenaExists(arenaId);

    const rows = await this.prisma.arenaOperatingHours.findMany({
      where: { arenaId },
      orderBy: [{ dayOfWeek: 'asc' }, { opensAt: 'asc' }],
    });
    return rows.map(toIntervalView);
  }

  // Usado internamente por AvailabilityService — minutos crus (Int), não a
  // view HH:mm da API pública, e sem checar existência da arena (o chamador
  // já validou a cadeia arena→court via CourtsService antes de chegar aqui).
  async getRawIntervalsForArena(arenaId: string): Promise<OperatingInterval[]> {
    return this.prisma.arenaOperatingHours.findMany({
      where: { arenaId },
      select: { dayOfWeek: true, opensAt: true, closesAt: true },
    });
  }

  // Fase 28 — usado só por ArenasService pra compor "arena pronta"
  // (setupStatus). `findFirst` em vez de `findMany`/`count`: mais barato
  // (o Postgres para na primeira linha), e só o booleano importa aqui, nunca
  // o conteúdo. Sem checar existência da arena pelo mesmo motivo de
  // `getRawIntervalsForArena` — o chamador já validou.
  async hasAnyForArena(arenaId: string): Promise<boolean> {
    const row = await this.prisma.arenaOperatingHours.findFirst({
      where: { arenaId },
      select: { id: true },
    });
    return row !== null;
  }

  // Fase 33 — mesma pergunta de `hasAnyForArena`, mas pra uma LISTA de
  // arenas de uma vez (usado por `ArenasService.discoverAll` pra expor
  // `isReady` na listagem pública sem virar N+1 — uma consulta só,
  // independente de quantas arenas existirem, nunca uma por arena).
  async hasAnyForArenas(arenaIds: string[]): Promise<Set<string>> {
    if (arenaIds.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.arenaOperatingHours.findMany({
      where: { arenaId: { in: arenaIds } },
      select: { arenaId: true },
      distinct: ['arenaId'],
    });
    return new Set(rows.map((row) => row.arenaId));
  }

  // Substituição atômica completa da semana (item 15-16 da Fase 5): valida
  // tudo antes de tocar o banco, depois apaga e recria dentro da mesma
  // transação — nunca deixa a configuração pela metade sob falha parcial.
  async replaceForArena(
    arenaId: string,
    intervals: OperatingIntervalDto[],
  ): Promise<OperatingIntervalView[]> {
    await this.assertArenaExists(arenaId);

    const parsed: OperatingInterval[] = intervals.map((interval) => ({
      dayOfWeek: interval.dayOfWeek,
      opensAt: parseHHMM(interval.opensAt),
      closesAt: parseHHMM(interval.closesAt),
    }));
    assertValidIntervals(parsed);

    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.arenaOperatingHours.deleteMany({ where: { arenaId } });
      if (parsed.length > 0) {
        await tx.arenaOperatingHours.createMany({
          data: parsed.map((interval) => ({ arenaId, ...interval })),
        });
      }
      return tx.arenaOperatingHours.findMany({
        where: { arenaId },
        orderBy: [{ dayOfWeek: 'asc' }, { opensAt: 'asc' }],
      });
    });

    return rows.map(toIntervalView);
  }

  private async assertArenaExists(arenaId: string): Promise<void> {
    const arena = await this.prisma.arena.findUnique({
      where: { id: arenaId },
      select: { id: true },
    });
    if (!arena) {
      throw new NotFoundException('Arena não encontrada.');
    }
  }
}
