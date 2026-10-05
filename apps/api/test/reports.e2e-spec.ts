import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  ArenaRole,
  BookingStatus,
  BookingType,
  PrismaClient,
  Sport,
  Weekday,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

// Fase 15: relatórios operacionais — camada FINA sobre OperationalMetricsService
// (a mesma fonte de verdade da IA, Fase 12). A fixture é desenhada pra deixar
// TODAS as contas verificáveis à mão: horário de funcionamento só às
// quintas-feiras (08:00-22:00) na Arena A, então um período de 7 dias tem
// exatamente 1 dia "com capacidade" e 6 dias sem (occupancyRate null nesses,
// nunca 0 forjado).
const OWNER_A = { clerkId: 'user_e2e_rep_owner_a', email: 'rep-e2e-owner-a@example.com' };
const ADMIN_A = { clerkId: 'user_e2e_rep_admin_a', email: 'rep-e2e-admin-a@example.com' };
const OWNER_B = { clerkId: 'user_e2e_rep_owner_b', email: 'rep-e2e-owner-b@example.com' };
const OWNER_NY = { clerkId: 'user_e2e_rep_owner_ny', email: 'rep-e2e-owner-ny@example.com' };
const OUTSIDER = { clerkId: 'user_e2e_rep_outsider', email: 'rep-e2e-outsider@example.com' };

const TOKENS: Record<string, string> = {
  'token-owner-a': OWNER_A.clerkId,
  'token-admin-a': ADMIN_A.clerkId,
  'token-owner-b': OWNER_B.clerkId,
  'token-owner-ny': OWNER_NY.clerkId,
  'token-outsider': OUTSIDER.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

interface ReportBody {
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  summary: {
    revenue: number;
    bookings: number;
    confirmedBookings: number;
    cancelledBookings: number;
    occupancyRate: number | null;
  };
  comparison: {
    revenueDeltaPct: number | null;
    confirmedBookingsDeltaPct: number | null;
    cancelledBookingsDeltaPct: number | null;
    occupancyRateDeltaPct: number | null;
  };
  series: {
    date: string;
    revenue: number;
    confirmedBookings: number;
    cancelledBookings: number;
    occupancyRate: number | null;
  }[];
  courts: {
    name: string;
    confirmedBookings: number;
    cancelledBookings: number;
    revenue: number;
    occupancyRate: number | null;
  }[];
  mostOccupiedCourtName: string | null;
  leastOccupiedCourtName: string | null;
  demand: {
    bookingsByHour: { hour: number; count: number }[];
    peakHour: number | null;
    lowestHour: number | null;
  };
  busiestDays: { date: string; count: number }[];
}

describe('Relatórios operacionais (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaAId: string;
  let arenaBId: string;
  let arenaNyId: string;
  let courtA1Id: string;
  let courtA2Id: string;
  let courtBId: string;
  let courtNyId: string;
  let ownerAId: string;

  function reportsUrl(arenaId: string) {
    return `/v1/arenas/${arenaId}/reports`;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const ownerA = await prisma.user.create({ data: OWNER_A });
    ownerAId = ownerA.id;
    const adminA = await prisma.user.create({ data: ADMIN_A });
    const ownerB = await prisma.user.create({ data: OWNER_B });
    const ownerNy = await prisma.user.create({ data: OWNER_NY });
    await prisma.user.create({ data: OUTSIDER });

    // Arena A — São Paulo, aberta só às quintas-feiras 08:00-22:00.
    const arenaA = await prisma.arena.create({
      data: { name: 'Arena Relatórios A', slug: 'rep-e2e-arena-a', timezone: 'America/Sao_Paulo' },
    });
    arenaAId = arenaA.id;
    await prisma.arenaMember.create({
      data: { arenaId: arenaAId, userId: ownerA.id, role: ArenaRole.OWNER },
    });
    await prisma.arenaMember.create({
      data: { arenaId: arenaAId, userId: adminA.id, role: ArenaRole.ADMIN },
    });
    await prisma.arenaOperatingHours.create({
      data: { arenaId: arenaAId, dayOfWeek: Weekday.THURSDAY, opensAt: 8 * 60, closesAt: 22 * 60 },
    });
    const courtA1 = await prisma.court.create({
      data: { arenaId: arenaAId, name: 'Quadra A1', sport: Sport.BEACH_VOLLEYBALL },
    });
    courtA1Id = courtA1.id;
    const courtA2 = await prisma.court.create({
      data: { arenaId: arenaAId, name: 'Quadra A2', sport: Sport.BEACH_VOLLEYBALL },
    });
    courtA2Id = courtA2.id;

    // 2026-08-20 é quinta — dentro do período atual (2026-08-14..2026-08-20).
    // Court A1: 1 CONFIRMED (100, 60min) + 1 CANCELLED (nunca conta receita/
    // ocupação) + 1 BLOCK + 1 MAINTENANCE (nunca contam nada de cliente).
    await prisma.booking.create({
      data: {
        courtId: courtA1Id,
        userId: ownerA.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-20T13:00:00-03:00'),
        endsAt: new Date('2026-08-20T14:00:00-03:00'),
        total: 100,
      },
    });
    await prisma.booking.create({
      data: {
        courtId: courtA1Id,
        userId: ownerA.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CANCELLED,
        startsAt: new Date('2026-08-20T15:00:00-03:00'),
        endsAt: new Date('2026-08-20T16:00:00-03:00'),
        total: 100,
        cancelledAt: new Date(),
        cancelledByUserId: ownerA.id,
      },
    });
    await prisma.booking.create({
      data: {
        courtId: courtA1Id,
        userId: ownerA.id,
        type: BookingType.BLOCK,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-20T17:00:00-03:00'),
        endsAt: new Date('2026-08-20T18:00:00-03:00'),
        reason: 'Evento privado',
      },
    });
    await prisma.booking.create({
      data: {
        courtId: courtA1Id,
        userId: ownerA.id,
        type: BookingType.MAINTENANCE,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-20T19:00:00-03:00'),
        endsAt: new Date('2026-08-20T20:00:00-03:00'),
        reason: 'Manutenção',
      },
    });
    // Court A2: 1 CONFIRMED (50, 90min — mais ocupada que A1 em proporção).
    await prisma.booking.create({
      data: {
        courtId: courtA2Id,
        userId: ownerA.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-20T10:00:00-03:00'),
        endsAt: new Date('2026-08-20T11:30:00-03:00'),
        total: 50,
      },
    });

    // 2026-08-13 é a quinta do período ANTERIOR (2026-08-07..2026-08-13) —
    // base pra comparação: 1 CONFIRMED (40, 60min) só na Court A1.
    await prisma.booking.create({
      data: {
        courtId: courtA1Id,
        userId: ownerA.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-13T13:00:00-03:00'),
        endsAt: new Date('2026-08-13T14:00:00-03:00'),
        total: 40,
      },
    });

    // Arena B — isolamento multi-tenant: nunca pode aparecer na Arena A.
    const arenaB = await prisma.arena.create({
      data: {
        name: 'Arena Relatórios B (segredo)',
        slug: 'rep-e2e-arena-b',
        timezone: 'America/Sao_Paulo',
      },
    });
    arenaBId = arenaB.id;
    await prisma.arenaMember.create({
      data: { arenaId: arenaBId, userId: ownerB.id, role: ArenaRole.OWNER },
    });
    await prisma.arenaOperatingHours.create({
      data: { arenaId: arenaBId, dayOfWeek: Weekday.THURSDAY, opensAt: 8 * 60, closesAt: 22 * 60 },
    });
    const courtB = await prisma.court.create({
      data: { arenaId: arenaBId, name: 'Quadra B1 (segredo)', sport: Sport.BEACH_VOLLEYBALL },
    });
    courtBId = courtB.id;
    await prisma.booking.create({
      data: {
        courtId: courtBId,
        userId: ownerB.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-20T13:00:00-03:00'),
        endsAt: new Date('2026-08-20T14:00:00-03:00'),
        total: 999999,
      },
    });

    // Arena NY — timezone com DST, pra provar que a série diária bucketiza
    // pelo dia LOCAL correto dos dois lados da transição de 2026-03-08.
    const arenaNy = await prisma.arena.create({
      data: { name: 'Arena Relatórios NY', slug: 'rep-e2e-arena-ny', timezone: 'America/New_York' },
    });
    arenaNyId = arenaNy.id;
    await prisma.arenaMember.create({
      data: { arenaId: arenaNyId, userId: ownerNy.id, role: ArenaRole.OWNER },
    });
    for (const day of [Weekday.SUNDAY, Weekday.MONDAY]) {
      await prisma.arenaOperatingHours.create({
        data: { arenaId: arenaNyId, dayOfWeek: day, opensAt: 8 * 60, closesAt: 22 * 60 },
      });
    }
    const courtNy = await prisma.court.create({
      data: { arenaId: arenaNyId, name: 'Quadra NY1', sport: Sport.BEACH_VOLLEYBALL },
    });
    courtNyId = courtNy.id;
    // 2026-03-08 é domingo, antes da transição de DST (UTC-5).
    await prisma.booking.create({
      data: {
        courtId: courtNyId,
        userId: ownerNy.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-03-08T14:00:00-05:00'),
        endsAt: new Date('2026-03-08T15:00:00-05:00'),
        total: 80,
      },
    });
    // 2026-03-09 é segunda, depois da transição (UTC-4).
    await prisma.booking.create({
      data: {
        courtId: courtNyId,
        userId: ownerNy.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-03-09T14:00:00-04:00'),
        endsAt: new Date('2026-03-09T15:00:00-04:00'),
        total: 80,
      },
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkService)
      .useValue({
        verifySessionToken: (token: string) => {
          const clerkId = TOKENS[token];
          if (clerkId) return Promise.resolve({ sub: clerkId });
          return Promise.reject(new Error('invalid test token'));
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    // listen(), não init(): ver production-hardening.e2e-spec.ts (ECONNRESET).
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({
      where: { courtId: { in: [courtA1Id, courtA2Id, courtBId, courtNyId] } },
    });
    await prisma.arena.deleteMany({ where: { id: { in: [arenaAId, arenaBId, arenaNyId] } } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  function currentPeriodQuery() {
    return { from: '2026-08-14', to: '2026-08-20' };
  }

  describe('Autorização', () => {
    it('exige autenticação (401)', async () => {
      await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .expect(401);
    });

    it('OWNER acessa o relatório', async () => {
      await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
    });

    it('ADMIN acessa o relatório', async () => {
      await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-admin-a'))
        .expect(200);
    });

    it('usuário sem nenhum vínculo com a arena recebe 403', async () => {
      await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-outsider'))
        .expect(403);
    });

    it('OWNER de outra arena não acessa via URL manual (403, cross-tenant)', async () => {
      await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-b'))
        .expect(403);
    });

    it('arena inexistente retorna 404', async () => {
      await request(app.getHttpServer())
        .get(reportsUrl('arena-que-nao-existe'))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(404);
    });
  });

  describe('Validação de período', () => {
    it('rejeita period maior que 92 dias (400)', async () => {
      await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query({ from: '2026-01-01', to: '2026-12-31' })
        .set(...authHeader('token-owner-a'))
        .expect(400);
    });

    it('rejeita preset combinado com from/to (400)', async () => {
      await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query({ preset: 'today', from: '2026-08-01', to: '2026-08-02' })
        .set(...authHeader('token-owner-a'))
        .expect(400);
    });

    it('rejeita preset inválido (400)', async () => {
      await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query({ preset: 'lastYear' })
        .set(...authHeader('token-owner-a'))
        .expect(400);
    });

    it('rejeita parâmetros de query não previstos (400, whitelist)', async () => {
      await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query({ ...currentPeriodQuery(), foo: 'bar' })
        .set(...authHeader('token-owner-a'))
        .expect(400);
    });

    it('sem query, usa last7days como padrão (200, formato válido)', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;
      expect(body.summary).toBeDefined();
      expect(body.period.from <= body.period.to).toBe(true);
    });

    it('presets thisMonth/lastMonth resolvem sem erro (200)', async () => {
      await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query({ preset: 'thisMonth' })
        .set(...authHeader('token-owner-a'))
        .expect(200);
      await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query({ preset: 'lastMonth' })
        .set(...authHeader('token-owner-a'))
        .expect(200);
    });
  });

  describe('Resumo — receita, reservas e ocupação (mesma definição da Fase 12)', () => {
    it('receita e contagens excluem CANCELLED/BLOCK/MAINTENANCE, só somam CUSTOMER+CONFIRMED', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      expect(body.summary.confirmedBookings).toBe(2); // A1 (100) + A2 (50)
      expect(body.summary.cancelledBookings).toBe(1);
      expect(body.summary.revenue).toBe(150); // nunca 250 (não inclui a cancelada)
      expect(body.summary.bookings).toBe(3); // confirmed + cancelled, nunca BLOCK/MAINTENANCE
    });

    it('ocupação do período: minutos ocupados ÷ minutos operacionais das quadras ativas', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      // 1 quinta no período × 840min × 2 quadras ativas = 1680min de capacidade;
      // 60min (A1) + 90min (A2) ocupados = 150min.
      expect(body.summary.occupancyRate).toBeCloseTo(150 / 1680, 10);
    });
  });

  describe('Série diária — null vs. zero', () => {
    it('dia sem horário de funcionamento configurado tem occupancyRate null, nunca 0', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      const friday = body.series.find((p) => p.date === '2026-08-14');
      expect(friday?.confirmedBookings).toBe(0);
      expect(friday?.occupancyRate).toBeNull();
    });

    it('dia com movimento (quinta) tem os números corretos e occupancyRate numérico', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      const thursday = body.series.find((p) => p.date === '2026-08-20');
      expect(thursday?.confirmedBookings).toBe(2);
      expect(thursday?.cancelledBookings).toBe(1);
      expect(thursday?.revenue).toBe(150);
      expect(thursday?.occupancyRate).toBeCloseTo(150 / 1680, 10);
    });

    it('série cobre todos os 7 dias do período, em ordem crescente', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      expect(body.series.map((p) => p.date)).toEqual([
        '2026-08-14',
        '2026-08-15',
        '2026-08-16',
        '2026-08-17',
        '2026-08-18',
        '2026-08-19',
        '2026-08-20',
      ]);
    });
  });

  describe('Comparação com período anterior', () => {
    it('calcula os deltas corretos contra o período imediatamente anterior', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      expect(body.previousPeriod).toEqual({ from: '2026-08-07', to: '2026-08-13' });
      expect(body.comparison.confirmedBookingsDeltaPct).toBe(100); // 1 -> 2
      expect(body.comparison.revenueDeltaPct).toBe(275); // 40 -> 150
      expect(body.comparison.occupancyRateDeltaPct).toBeCloseTo(150, 5);
    });

    it('base zero (sem cancelamentos no período anterior) gera delta null, nunca 0 ou Infinity', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      expect(body.comparison.cancelledBookingsDeltaPct).toBeNull();
    });
  });

  describe('Desempenho por quadra', () => {
    it('cada quadra reflete só as próprias reservas, sem misturar com outras quadras', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      const a1 = body.courts.find((c) => c.name === 'Quadra A1')!;
      const a2 = body.courts.find((c) => c.name === 'Quadra A2')!;
      expect(a1.confirmedBookings).toBe(1);
      expect(a1.cancelledBookings).toBe(1);
      expect(a1.revenue).toBe(100);
      expect(a2.confirmedBookings).toBe(1);
      expect(a2.cancelledBookings).toBe(0);
      expect(a2.revenue).toBe(50);
    });

    it('quadra mais/menos ocupada refletem a proporção real (A2 90min > A1 60min, mesma capacidade)', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      expect(body.mostOccupiedCourtName).toBe('Quadra A2');
      expect(body.leastOccupiedCourtName).toBe('Quadra A1');
    });
  });

  describe('Demanda por horário e dias mais movimentados', () => {
    it('horário de pico e de menor demanda vêm só das horas dentro do funcionamento', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      expect(body.demand.peakHour).toBe(10); // A2 às 10h (empatado com 13h, desempate pela hora menor)
      expect(body.demand.lowestHour).toBe(8); // hora sem nenhuma reserva, mas dentro do expediente
      const hour8 = body.demand.bookingsByHour.find((h) => h.hour === 8);
      expect(hour8?.count).toBe(0); // hora de menor demanda é um 0 válido, não ausente
    });

    it('dias mais movimentados excluem dias com 0 reservas', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      expect(body.busiestDays).toEqual([{ date: '2026-08-20', count: 2 }]);
    });
  });

  describe('Isolamento multi-tenant', () => {
    it('Arena B nunca aparece no relatório da Arena A (revenue nunca inclui 999999)', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as ReportBody;

      expect(body.summary.revenue).toBe(150);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('999999');
      expect(raw).not.toContain('segredo');
    });

    it('OWNER da Arena B vê os próprios números, isolados da Arena A', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaBId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-b'))
        .expect(200);
      const body = response.body as ReportBody;

      expect(body.summary.revenue).toBe(999999);
      expect(body.summary.confirmedBookings).toBe(1);
    });
  });

  describe('Timezone e DST (Arena NY)', () => {
    it('bucketiza a série pelo dia local correto dos dois lados da transição de DST', async () => {
      const response = await request(app.getHttpServer())
        .get(reportsUrl(arenaNyId))
        .query({ from: '2026-03-08', to: '2026-03-09' })
        .set(...authHeader('token-owner-ny'))
        .expect(200);
      const body = response.body as ReportBody;

      expect(body.series).toHaveLength(2);
      const sunday = body.series.find((p) => p.date === '2026-03-08');
      const monday = body.series.find((p) => p.date === '2026-03-09');
      expect(sunday?.confirmedBookings).toBe(1);
      expect(sunday?.revenue).toBe(80);
      expect(monday?.confirmedBookings).toBe(1);
      expect(monday?.revenue).toBe(80);
    });
  });

  describe('Integração: criar reserva → relatório reflete → cancelar → relatório reflete', () => {
    it('receita/reservas sobem ao criar e caem ao cancelar, sem o GET nunca mutar Booking', async () => {
      const before = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const revenueBefore = (before.body as ReportBody).summary.revenue;
      const confirmedBefore = (before.body as ReportBody).summary.confirmedBookings;

      const newBooking = await prisma.booking.create({
        data: {
          courtId: courtA1Id,
          userId: ownerAId,
          type: BookingType.CUSTOMER,
          status: BookingStatus.CONFIRMED,
          startsAt: new Date('2026-08-20T09:00:00-03:00'),
          endsAt: new Date('2026-08-20T10:00:00-03:00'),
          total: 30,
        },
      });

      const afterCreate = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const bodyAfterCreate = afterCreate.body as ReportBody;
      expect(bodyAfterCreate.summary.revenue).toBe(revenueBefore + 30);
      expect(bodyAfterCreate.summary.confirmedBookings).toBe(confirmedBefore + 1);

      await prisma.booking.update({
        where: { id: newBooking.id },
        data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
      });

      const afterCancel = await request(app.getHttpServer())
        .get(reportsUrl(arenaAId))
        .query(currentPeriodQuery())
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const bodyAfterCancel = afterCancel.body as ReportBody;
      expect(bodyAfterCancel.summary.revenue).toBe(revenueBefore);
      expect(bodyAfterCancel.summary.confirmedBookings).toBe(confirmedBefore);
      expect(bodyAfterCancel.summary.cancelledBookings).toBe(2); // 1 da fixture + esta

      const reread = await prisma.booking.findUniqueOrThrow({ where: { id: newBooking.id } });
      expect(reread.status).toBe(BookingStatus.CANCELLED); // GET nunca reverteu/alterou o cancelamento

      await prisma.booking.delete({ where: { id: newBooking.id } });
    });
  });

  describe('Concorrência — leitura', () => {
    it('duas requisições GET simultâneas devolvem exatamente o mesmo resultado (read-only)', async () => {
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .get(reportsUrl(arenaAId))
          .query(currentPeriodQuery())
          .set(...authHeader('token-owner-a')),
        request(app.getHttpServer())
          .get(reportsUrl(arenaAId))
          .query(currentPeriodQuery())
          .set(...authHeader('token-owner-a')),
      ]);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r1.body).toEqual(r2.body);
    });
  });
});
