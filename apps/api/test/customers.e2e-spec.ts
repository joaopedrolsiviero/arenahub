import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ArenaRole, BookingStatus, BookingType, PrismaClient, Sport } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

// Fase 14: visão operacional de clientes da arena. Fixture desenhada pra
// cobrir os dois eixos obrigatórios do prompt da fase: isolamento por arena
// (João tem reservas nas duas arenas, com totais que NUNCA podem se
// misturar) e exclusão de BLOCK/MAINTENANCE da definição de "cliente".
const OWNER_A = { clerkId: 'user_e2e_cust_owner_a', email: 'cust-e2e-owner-a@example.com' };
const ADMIN_A = { clerkId: 'user_e2e_cust_admin_a', email: 'cust-e2e-admin-a@example.com' };
const OWNER_B = { clerkId: 'user_e2e_cust_owner_b', email: 'cust-e2e-owner-b@example.com' };
const JOAO = {
  clerkId: 'user_e2e_cust_joao',
  name: 'João Pedro',
  email: 'cust-e2e-joao@example.com',
};
const MARIA = {
  clerkId: 'user_e2e_cust_maria',
  name: 'Maria Silva',
  email: 'cust-e2e-maria@example.com',
};
const OUTRO = { clerkId: 'user_e2e_cust_outro', email: 'cust-e2e-outro@example.com' };

const TOKENS: Record<string, string> = {
  'token-owner-a': OWNER_A.clerkId,
  'token-admin-a': ADMIN_A.clerkId,
  'token-owner-b': OWNER_B.clerkId,
  'token-joao': JOAO.clerkId,
  'token-maria': MARIA.clerkId,
  'token-outro': OUTRO.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

interface CustomerSummaryBody {
  userId: string;
  name: string | null;
  email: string;
  totalBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  totalRevenue: number;
  firstBookingAt: string;
  lastBookingAt: string;
}

interface CustomerListBody {
  items: CustomerSummaryBody[];
  total: number;
  page: number;
  limit: number;
}

interface CustomerBookingBody {
  id: string;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  total: string;
  court: { id: string; name: string };
}

describe('Clientes da arena (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaAId: string;
  let arenaBId: string;
  let courtAId: string;
  let courtBId: string;
  let joaoId: string;
  let mariaId: string;
  let ownerAId: string;

  function customersUrl(arenaId: string) {
    return `/v1/arenas/${arenaId}/customers`;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const ownerA = await prisma.user.create({ data: OWNER_A });
    ownerAId = ownerA.id;
    const adminA = await prisma.user.create({ data: ADMIN_A });
    const ownerB = await prisma.user.create({ data: OWNER_B });
    const joao = await prisma.user.create({ data: JOAO });
    joaoId = joao.id;
    const maria = await prisma.user.create({ data: MARIA });
    mariaId = maria.id;
    await prisma.user.create({ data: OUTRO });

    const arenaA = await prisma.arena.create({
      data: { name: 'Arena Clientes A', slug: 'cust-e2e-arena-a', timezone: 'America/Sao_Paulo' },
    });
    arenaAId = arenaA.id;
    await prisma.arenaMember.create({
      data: { arenaId: arenaAId, userId: ownerA.id, role: ArenaRole.OWNER },
    });
    await prisma.arenaMember.create({
      data: { arenaId: arenaAId, userId: adminA.id, role: ArenaRole.ADMIN },
    });
    const courtA = await prisma.court.create({
      data: {
        arenaId: arenaAId,
        name: 'Quadra A1',
        sport: Sport.BEACH_VOLLEYBALL,
        pricePerSlot: 75,
      },
    });
    courtAId = courtA.id;

    const arenaB = await prisma.arena.create({
      data: {
        name: 'Arena Clientes B (NY)',
        slug: 'cust-e2e-arena-b',
        timezone: 'America/New_York',
      },
    });
    arenaBId = arenaB.id;
    await prisma.arenaMember.create({
      data: { arenaId: arenaBId, userId: ownerB.id, role: ArenaRole.OWNER },
    });
    const courtB = await prisma.court.create({
      data: {
        arenaId: arenaBId,
        name: 'Quadra B1',
        sport: Sport.BEACH_VOLLEYBALL,
        pricePerSlot: 80,
      },
    });
    courtBId = courtB.id;

    // João, Arena A: 2 CONFIRMED (150) + 1 CANCELLED (75, nunca entra na receita).
    await prisma.booking.create({
      data: {
        courtId: courtAId,
        userId: joao.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-05-10T13:00:00-03:00'),
        endsAt: new Date('2026-05-10T14:00:00-03:00'),
        total: 75,
      },
    });
    await prisma.booking.create({
      data: {
        courtId: courtAId,
        userId: joao.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-24T19:00:00-03:00'),
        endsAt: new Date('2026-08-24T20:00:00-03:00'),
        total: 75,
      },
    });
    await prisma.booking.create({
      data: {
        courtId: courtAId,
        userId: joao.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CANCELLED,
        startsAt: new Date('2026-08-20T20:00:00-03:00'),
        endsAt: new Date('2026-08-20T21:00:00-03:00'),
        total: 75,
        cancelledAt: new Date(),
        cancelledByUserId: joao.id,
      },
    });

    // João, Arena B: 1 CONFIRMED (80) — do outro lado da transição de DST de
    // 2026 (8/mar) em NY, mesma disciplina de timezone das fases anteriores.
    await prisma.booking.create({
      data: {
        courtId: courtBId,
        userId: joao.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-03-09T14:00:00-04:00'),
        endsAt: new Date('2026-03-09T15:00:00-04:00'),
        total: 80,
      },
    });

    // Maria, só Arena A: 1 CONFIRMED (75).
    await prisma.booking.create({
      data: {
        courtId: courtAId,
        userId: maria.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-22T09:00:00-03:00'),
        endsAt: new Date('2026-08-22T10:00:00-03:00'),
        total: 75,
      },
    });

    // BLOCK e MAINTENANCE do OWNER_A — userId preenchido, mas NUNCA um
    // "cliente" (item 3/10/11 do prompt da fase).
    await prisma.booking.create({
      data: {
        courtId: courtAId,
        userId: ownerA.id,
        type: BookingType.BLOCK,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-23T08:00:00-03:00'),
        endsAt: new Date('2026-08-23T09:00:00-03:00'),
        reason: 'Evento privado',
      },
    });
    await prisma.booking.create({
      data: {
        courtId: courtAId,
        userId: ownerA.id,
        type: BookingType.MAINTENANCE,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-23T09:00:00-03:00'),
        endsAt: new Date('2026-08-23T10:00:00-03:00'),
        reason: 'Manutenção',
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
    await app.init();
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { courtId: { in: [courtAId, courtBId] } } });
    await prisma.arena.deleteMany({ where: { id: { in: [arenaAId, arenaBId] } } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('Autorização', () => {
    it('exige autenticação (401)', async () => {
      await request(app.getHttpServer()).get(customersUrl(arenaAId)).expect(401);
    });

    it('OWNER lista clientes', async () => {
      await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .set(...authHeader('token-owner-a'))
        .expect(200);
    });

    it('ADMIN lista clientes', async () => {
      await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .set(...authHeader('token-admin-a'))
        .expect(200);
    });

    it('CUSTOMER (João, cliente real, mas nunca ArenaMember) não acessa a listagem (403)', async () => {
      await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .set(...authHeader('token-joao'))
        .expect(403);
    });

    it('usuário sem nenhum vínculo não acessa a listagem (403)', async () => {
      await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .set(...authHeader('token-outro'))
        .expect(403);
    });

    it('arena inexistente retorna 404', async () => {
      await request(app.getHttpServer())
        .get(customersUrl('arena-que-nao-existe'))
        .set(...authHeader('token-owner-a'))
        .expect(404);
    });
  });

  describe('Listagem — conteúdo, métricas e exclusões', () => {
    it('lista João e Maria, nunca o OWNER (que só tem BLOCK/MAINTENANCE)', async () => {
      const response = await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as CustomerListBody;
      const ids = body.items.map((c) => c.userId);

      expect(ids).toContain(joaoId);
      expect(ids).toContain(mariaId);
      expect(ids).not.toContain(ownerAId);
      expect(body.total).toBe(2);
    });

    it('João: total inclui a cancelada, receita só soma as confirmadas', async () => {
      const response = await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const joaoSummary = (response.body as CustomerListBody).items.find(
        (c) => c.userId === joaoId,
      )!;

      expect(joaoSummary.totalBookings).toBe(3); // 2 confirmed + 1 cancelled
      expect(joaoSummary.confirmedBookings).toBe(2);
      expect(joaoSummary.cancelledBookings).toBe(1);
      expect(joaoSummary.totalRevenue).toBe(150); // nunca 225 (2x75 confirmed, não 3x75)
    });

    it('nunca inclui PII indevida (clerkId, telefone) na resposta', async () => {
      const response = await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .set(...authHeader('token-owner-a'))
        .expect(200);

      const raw = JSON.stringify(response.body);
      expect(raw).not.toContain(JOAO.clerkId);
      expect(raw).not.toContain(MARIA.clerkId);
      expect(raw.toLowerCase()).not.toContain('phone');
    });

    it('ordena pela reserva mais recente primeiro', async () => {
      const response = await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const items = (response.body as CustomerListBody).items;

      // João tem reserva em 2026-08-24 (mais recente que a de Maria, 08-22).
      expect(items[0]?.userId).toBe(joaoId);
      expect(items[1]?.userId).toBe(mariaId);
    });
  });

  describe('Busca', () => {
    it('busca por nome retorna só o cliente correspondente', async () => {
      const response = await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .query({ search: 'Maria' })
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as CustomerListBody;

      expect(body.items.map((c) => c.userId)).toEqual([mariaId]);
    });

    it('busca por e-mail (parcial) funciona', async () => {
      const response = await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .query({ search: 'cust-e2e-joao' })
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as CustomerListBody;

      expect(body.items.map((c) => c.userId)).toEqual([joaoId]);
    });

    it('busca sem correspondência retorna lista vazia', async () => {
      const response = await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .query({ search: 'ninguem-com-esse-nome' })
        .set(...authHeader('token-owner-a'))
        .expect(200);

      expect((response.body as CustomerListBody).items).toEqual([]);
    });
  });

  describe('Paginação', () => {
    it('limit=1 devolve um item por página, total continua 2', async () => {
      const page1 = await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .query({ limit: 1, page: 1 })
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const page2 = await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .query({ limit: 1, page: 2 })
        .set(...authHeader('token-owner-a'))
        .expect(200);

      const body1 = page1.body as CustomerListBody;
      const body2 = page2.body as CustomerListBody;
      expect(body1.items).toHaveLength(1);
      expect(body2.items).toHaveLength(1);
      expect(body1.total).toBe(2);
      expect(body2.total).toBe(2);
      expect(body1.items[0]?.userId).not.toBe(body2.items[0]?.userId);
    });

    it('rejeita limit acima do máximo permitido (400)', async () => {
      await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .query({ limit: 999 })
        .set(...authHeader('token-owner-a'))
        .expect(400);
    });

    it('rejeita page menor que 1 (400)', async () => {
      await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .query({ page: 0 })
        .set(...authHeader('token-owner-a'))
        .expect(400);
    });

    it('rejeita parâmetros de query não previstos (400, whitelist)', async () => {
      await request(app.getHttpServer())
        .get(customersUrl(arenaAId))
        .query({ role: 'OWNER' })
        .set(...authHeader('token-owner-a'))
        .expect(400);
    });
  });

  describe('GET /customers/:userId — detalhe', () => {
    it('OWNER consulta o resumo de João', async () => {
      const response = await request(app.getHttpServer())
        .get(`${customersUrl(arenaAId)}/${joaoId}`)
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as CustomerSummaryBody;

      expect(body.name).toBe('João Pedro');
      expect(body.totalBookings).toBe(3);
      expect(body.totalRevenue).toBe(150);
    });

    it('ADMIN consulta o resumo de João', async () => {
      await request(app.getHttpServer())
        .get(`${customersUrl(arenaAId)}/${joaoId}`)
        .set(...authHeader('token-admin-a'))
        .expect(200);
    });

    it('cliente inexistente (userId aleatório) retorna 404', async () => {
      await request(app.getHttpServer())
        .get(`${customersUrl(arenaAId)}/nao-existe-esse-usuario`)
        .set(...authHeader('token-owner-a'))
        .expect(404);
    });

    it('usuário sem NENHUMA Booking CUSTOMER nesta arena (só é OWNER de outra) retorna 404 — nunca vaza dado de outra arena', async () => {
      // OWNER_B existe globalmente, mas não é cliente da Arena A.
      const ownerB = await prisma.user.findUniqueOrThrow({ where: { clerkId: OWNER_B.clerkId } });
      await request(app.getHttpServer())
        .get(`${customersUrl(arenaAId)}/${ownerB.id}`)
        .set(...authHeader('token-owner-a'))
        .expect(404);
    });

    it('João em múltiplas arenas: os totais NUNCA se misturam entre Arena A e Arena B', async () => {
      const resA = await request(app.getHttpServer())
        .get(`${customersUrl(arenaAId)}/${joaoId}`)
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const resB = await request(app.getHttpServer())
        .get(`${customersUrl(arenaBId)}/${joaoId}`)
        .set(...authHeader('token-owner-b'))
        .expect(200);

      const bodyA = resA.body as CustomerSummaryBody;
      const bodyB = resB.body as CustomerSummaryBody;

      expect(bodyA.totalBookings).toBe(3);
      expect(bodyA.totalRevenue).toBe(150);
      expect(bodyB.totalBookings).toBe(1);
      expect(bodyB.totalRevenue).toBe(80);
    });

    it('OWNER da Arena B não pode consultar cliente da Arena A (cross-tenant, 403)', async () => {
      await request(app.getHttpServer())
        .get(`${customersUrl(arenaAId)}/${joaoId}`)
        .set(...authHeader('token-owner-b'))
        .expect(403);
    });
  });

  describe('GET /customers/:userId/bookings — histórico', () => {
    it('retorna só as reservas CUSTOMER de João nesta arena, nunca BLOCK/MAINTENANCE nem de outra arena', async () => {
      const response = await request(app.getHttpServer())
        .get(`${customersUrl(arenaAId)}/${joaoId}/bookings`)
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const bookings = response.body as CustomerBookingBody[];

      expect(bookings).toHaveLength(3);
      expect(bookings.every((b) => b.court.id === courtAId)).toBe(true);
      const statuses = bookings.map((b) => b.status).sort();
      expect(statuses).toEqual([
        BookingStatus.CANCELLED,
        BookingStatus.CONFIRMED,
        BookingStatus.CONFIRMED,
      ]);
    });

    it('ordena por startsAt desc (mais recente primeiro)', async () => {
      const response = await request(app.getHttpServer())
        .get(`${customersUrl(arenaAId)}/${joaoId}/bookings`)
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const bookings = response.body as CustomerBookingBody[];

      const dates = bookings.map((b) => new Date(b.startsAt).getTime());
      expect(dates).toEqual([...dates].sort((a, b) => b - a));
    });

    it('preserva o instante UTC correto do lado NY/DST (Arena B), sem depender do timezone do servidor', async () => {
      const response = await request(app.getHttpServer())
        .get(`${customersUrl(arenaBId)}/${joaoId}/bookings`)
        .set(...authHeader('token-owner-b'))
        .expect(200);
      const bookings = response.body as CustomerBookingBody[];

      expect(bookings).toHaveLength(1);
      expect(bookings[0]?.startsAt).toBe('2026-03-09T18:00:00.000Z'); // 14:00 -04:00
    });

    it('cliente inexistente na arena retorna 404', async () => {
      await request(app.getHttpServer())
        .get(`${customersUrl(arenaAId)}/nao-existe-esse-usuario/bookings`)
        .set(...authHeader('token-owner-a'))
        .expect(404);
    });

    it('CUSTOMER não acessa o histórico administrativo (403)', async () => {
      await request(app.getHttpServer())
        .get(`${customersUrl(arenaAId)}/${joaoId}/bookings`)
        .set(...authHeader('token-joao'))
        .expect(403);
    });
  });
});
