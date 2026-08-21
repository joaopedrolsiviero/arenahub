import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ArenaRole, PrismaClient, Sport, Weekday } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

// Fase 8 (Hardening): varredura de segurança que não se encaixa
// naturalmente em nenhum spec de domínio existente — mass assignment,
// IDOR sistemático entre Arena A/B, semântica de @RequireArenaRole()
// vazio, e idempotência sob falha genuína (não só sob corrida).
const OWNER_A = { clerkId: 'user_e2e_hard_owner_a', email: 'hard-e2e-owner-a@example.com' };
const ADMIN_A = { clerkId: 'user_e2e_hard_admin_a', email: 'hard-e2e-admin-a@example.com' };
const OWNER_B = { clerkId: 'user_e2e_hard_owner_b', email: 'hard-e2e-owner-b@example.com' };
const CUSTOMER = { clerkId: 'user_e2e_hard_customer', email: 'hard-e2e-customer@example.com' };

const TOKENS: Record<string, string> = {
  'token-owner-a': OWNER_A.clerkId,
  'token-admin-a': ADMIN_A.clerkId,
  'token-owner-b': OWNER_B.clerkId,
  'token-customer': CUSTOMER.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

interface BookingBody {
  id: string;
  type: string;
}

describe('Hardening — mass assignment, IDOR e idempotência (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaAId: string;
  let arenaBId: string;
  let courtAId: string;
  let courtBId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const ownerA = await prisma.user.create({ data: OWNER_A });
    const adminA = await prisma.user.create({ data: ADMIN_A });
    const ownerB = await prisma.user.create({ data: OWNER_B });
    await prisma.user.create({ data: CUSTOMER });

    const arenaA = await prisma.arena.create({
      data: { name: 'Hardening Arena A', slug: 'hard-arena-a', timezone: 'America/Sao_Paulo' },
    });
    arenaAId = arenaA.id;
    await prisma.arenaMember.create({
      data: { arenaId: arenaAId, userId: ownerA.id, role: ArenaRole.OWNER },
    });
    await prisma.arenaMember.create({
      data: { arenaId: arenaAId, userId: adminA.id, role: ArenaRole.ADMIN },
    });
    await prisma.arenaOperatingHours.createMany({
      data: Object.values(Weekday).map((dayOfWeek) => ({
        arenaId: arenaAId,
        dayOfWeek,
        opensAt: 0,
        closesAt: 1439,
      })),
    });

    const arenaB = await prisma.arena.create({
      data: { name: 'Hardening Arena B', slug: 'hard-arena-b', timezone: 'America/Sao_Paulo' },
    });
    arenaBId = arenaB.id;
    await prisma.arenaMember.create({
      data: { arenaId: arenaBId, userId: ownerB.id, role: ArenaRole.OWNER },
    });

    const courtA = await prisma.court.create({
      data: {
        arenaId: arenaAId,
        name: 'Quadra A',
        sport: Sport.BEACH_VOLLEYBALL,
        pricePerSlot: 100,
        slotDurationMinutes: 60,
      },
    });
    courtAId = courtA.id;
    const courtB = await prisma.court.create({
      data: { arenaId: arenaBId, name: 'Quadra B', sport: Sport.BEACH_VOLLEYBALL },
    });
    courtBId = courtB.id;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkService)
      .useValue({
        verifySessionToken: (token: string) => {
          const clerkId = TOKENS[token];
          if (clerkId) {
            return Promise.resolve({ sub: clerkId });
          }
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

  describe('Mass assignment — campos internos nunca aceitos no body', () => {
    it('POST /v1/arenas rejeita "role"/"id" extras no body (400)', async () => {
      await request(app.getHttpServer())
        .post('/v1/arenas')
        .set(...authHeader('token-owner-a'))
        .send({
          name: 'Arena Injetada',
          slug: 'arena-injetada-mass-assign',
          timezone: 'America/Sao_Paulo',
          role: 'OWNER',
          id: 'id-forjado',
        })
        .expect(400);
    });

    it('PATCH /v1/arenas/:arenaId rejeita "slug" (campo deliberadamente não editável) (400)', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/arenas/${arenaAId}`)
        .set(...authHeader('token-owner-a'))
        .send({ slug: 'novo-slug-tentado' })
        .expect(400);
    });

    it('POST .../courts rejeita "isActive"/"arenaId" no body de criação (400)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts`)
        .set(...authHeader('token-owner-a'))
        .send({
          name: 'Quadra Injetada',
          sport: Sport.BEACH_VOLLEYBALL,
          isActive: false,
          arenaId: arenaBId,
        })
        .expect(400);
    });

    it('PATCH .../courts/:courtId rejeita "arenaId" — não é possível mover quadra de arena (400)', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/arenas/${arenaAId}/courts/${courtAId}`)
        .set(...authHeader('token-owner-a'))
        .send({ name: 'Nome Novo', arenaId: arenaBId })
        .expect(400);
    });

    it('POST .../bookings (CUSTOMER) rejeita userId/type/status/total/endsAt injetados (400)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings`)
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'mass-assign-booking-1')
        .send({
          startsAt: '2026-09-10T13:00:00.000Z',
          userId: 'user-forjado',
          type: 'BLOCK',
          status: 'CANCELLED',
          total: 0,
          endsAt: '2026-09-10T23:00:00.000Z',
          bufferMinutesSnapshot: 999,
        })
        .expect(400);
    });

    it('POST .../bookings/blocks rejeita userId/type/total injetados (400)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/blocks`)
        .set(...authHeader('token-owner-a'))
        .set('Idempotency-Key', 'mass-assign-block-1')
        .send({
          startsAt: '2026-09-10T13:00:00.000Z',
          endsAt: '2026-09-10T14:00:00.000Z',
          userId: 'user-forjado',
          type: 'CUSTOMER',
          total: 500,
        })
        .expect(400);
    });
  });

  describe('IDOR — Arena A nunca acessa recursos da Arena B', () => {
    it('GET /v1/arenas/:arenaB — OWNER de A recebe 403', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaBId}`)
        .set(...authHeader('token-owner-a'))
        .expect(403);
    });

    it('PATCH /v1/arenas/:arenaB — OWNER de A recebe 403', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/arenas/${arenaBId}`)
        .set(...authHeader('token-owner-a'))
        .send({ name: 'Nome Hostil' })
        .expect(403);
    });

    it('GET /v1/arenas/:arenaB/courts/:courtB — OWNER de A recebe 403', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaBId}/courts/${courtBId}`)
        .set(...authHeader('token-owner-a'))
        .expect(403);
    });

    it('PATCH /v1/arenas/:arenaB/courts/:courtB — OWNER de A recebe 403', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/arenas/${arenaBId}/courts/${courtBId}`)
        .set(...authHeader('token-owner-a'))
        .send({ name: 'Nome Hostil' })
        .expect(403);
    });

    it('GET /v1/arenas/:arenaB/courts/:courtB/bookings/admin — OWNER de A recebe 403', async () => {
      await request(app.getHttpServer())
        .get(
          `/v1/arenas/${arenaBId}/courts/${courtBId}/bookings/admin?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z`,
        )
        .set(...authHeader('token-owner-a'))
        .expect(403);
    });

    it('PUT /v1/arenas/:arenaB/operating-hours — OWNER de A recebe 403', async () => {
      await request(app.getHttpServer())
        .put(`/v1/arenas/${arenaBId}/operating-hours`)
        .set(...authHeader('token-owner-a'))
        .send({ intervals: [] })
        .expect(403);
    });

    it('GET /v1/arenas/:arenaB/dashboard — OWNER de A recebe 403', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaBId}/dashboard`)
        .set(...authHeader('token-owner-a'))
        .expect(403);
    });

    it('Quadra de B não vaza mesmo com courtId real: POST bookings em Arena A + courtId de B => 404', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtBId}/bookings`)
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'idor-cross-court-1')
        .send({ startsAt: '2026-09-10T13:00:00.000Z' })
        .expect(404);
    });
  });

  describe('@RequireArenaRole() vazio — qualquer ArenaMember passa, CUSTOMER nunca', () => {
    it('OWNER acessa rota de leitura sem role explícita', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}`)
        .set(...authHeader('token-owner-a'))
        .expect(200);
    });

    it('ADMIN acessa a mesma rota', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}`)
        .set(...authHeader('token-admin-a'))
        .expect(200);
    });

    it('usuário sem nenhum vínculo (equivalente a CUSTOMER) recebe 403, nunca acesso implícito', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}`)
        .set(...authHeader('token-customer'))
        .expect(403);
    });

    it('o mesmo vale para GET .../courts (lista)', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/courts`)
        .set(...authHeader('token-customer'))
        .expect(403);
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/courts`)
        .set(...authHeader('token-admin-a'))
        .expect(200);
    });
  });

  describe('Idempotency-Key — isolamento e resiliência a falha genuína', () => {
    it('mesma chave literal usada por dois usuários diferentes não interfere entre si', async () => {
      const key = 'shared-literal-key';
      const responseA = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings`)
        .set(...authHeader('token-owner-a'))
        .set('Idempotency-Key', key)
        .send({ startsAt: '2026-09-11T10:00:00.000Z' })
        .expect(201);

      const responseCustomer = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings`)
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', key)
        .send({ startsAt: '2026-09-11T14:00:00.000Z' })
        .expect(201);

      const bodyA = responseA.body as BookingBody;
      const bodyCustomer = responseCustomer.body as BookingBody;
      expect(bodyA.id).not.toBe(bodyCustomer.id);
    });

    it('mesma chave literal em endpoints diferentes (booking x block) não interfere', async () => {
      const key = 'shared-key-cross-endpoint';
      const bookingResponse = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings`)
        .set(...authHeader('token-owner-a'))
        .set('Idempotency-Key', key)
        .send({ startsAt: '2026-09-11T18:00:00.000Z' })
        .expect(201);

      const blockResponse = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/blocks`)
        .set(...authHeader('token-owner-a'))
        .set('Idempotency-Key', key)
        .send({ startsAt: '2026-09-12T18:00:00.000Z', endsAt: '2026-09-12T19:00:00.000Z' })
        .expect(201);

      const bookingBody = bookingResponse.body as BookingBody;
      const blockBody = blockResponse.body as BookingBody;
      expect(bookingBody.type).toBe('CUSTOMER');
      expect(blockBody.type).toBe('BLOCK');
      expect(bookingBody.id).not.toBe(blockBody.id);
    });

    it('uma chave nunca fica "presa" após falha genuína — retry com payload diferente funciona', async () => {
      const key = 'retry-after-genuine-conflict';

      // Ocupa o horário primeiro, para forçar um 409 genuíno na tentativa seguinte.
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings`)
        .set(...authHeader('token-owner-a'))
        .set('Idempotency-Key', 'occupy-for-retry-test')
        .send({ startsAt: '2026-09-13T09:00:00.000Z' })
        .expect(201);

      // Primeira tentativa com a chave: conflita de verdade (409), não é sobre idempotência.
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings`)
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', key)
        .send({ startsAt: '2026-09-13T09:00:00.000Z' })
        .expect(409);

      // Retry com a MESMA chave, mas horário diferente (o cliente real faria
      // isso ao tentar de novo depois de ver que o horário mudou) — se a
      // chave tivesse ficado "presa" no placeholder da tentativa que falhou,
      // isso teria sido rejeitado incorretamente. Deve suceder normalmente.
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings`)
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', key)
        .send({ startsAt: '2026-09-13T11:00:00.000Z' })
        .expect(201);
    });
  });
});
