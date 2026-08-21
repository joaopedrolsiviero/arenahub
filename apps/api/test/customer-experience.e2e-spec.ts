import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ArenaRole, BookingType, PrismaClient, Sport, Weekday } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

// Fase 6: descoberta pública de arenas e "minhas reservas" — os dois
// endpoints novos desta fase. User OWNER administra a Arena, cria um BLOCK
// nela (para provar que não vaza em "minhas reservas" de ninguém). User A e
// User B são clientes comuns, sem nenhum vínculo administrativo — usados
// para os testes de privacidade/cross-tenant obrigatórios (itens 30/63/64).
const USER_OWNER = { clerkId: 'user_e2e_cx_owner', email: 'cx-e2e-owner@example.com' };
const USER_A = { clerkId: 'user_e2e_cx_a', email: 'cx-e2e-a@example.com' };
const USER_B = { clerkId: 'user_e2e_cx_b', email: 'cx-e2e-b@example.com' };

const TOKENS: Record<string, string> = {
  'token-owner': USER_OWNER.clerkId,
  'token-a': USER_A.clerkId,
  'token-b': USER_B.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

interface DiscoverySummaryBody {
  id: string;
  name: string;
  sports: Sport[];
  role?: unknown;
  members?: unknown;
}

interface DiscoveryDetailBody {
  id: string;
  name: string;
  timezone: string;
  courts: { id: string; name: string; isActive?: unknown }[];
  members?: unknown;
}

interface MyBookingBody {
  id: string;
  status: string;
  startsAt: string;
  court: { id: string; name: string; arena: { id: string; name: string; timezone: string } };
}

describe('Customer experience — discovery & minhas reservas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaId: string;
  let activeCourtId: string;
  let inactiveCourtId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const owner = await prisma.user.create({ data: USER_OWNER });
    const userA = await prisma.user.create({ data: USER_A });
    await prisma.user.create({ data: USER_B });

    const arena = await prisma.arena.create({
      data: {
        name: 'Arena Discovery E2E',
        slug: 'arena-discovery-e2e',
        timezone: 'America/Sao_Paulo',
      },
    });
    arenaId = arena.id;
    await prisma.arenaMember.create({
      data: { arenaId, userId: owner.id, role: ArenaRole.OWNER },
    });
    await prisma.arenaOperatingHours.createMany({
      data: Object.values(Weekday).map((dayOfWeek) => ({
        arenaId,
        dayOfWeek,
        opensAt: 0,
        closesAt: 1439,
      })),
    });

    const activeCourt = await prisma.court.create({
      data: {
        arenaId,
        name: 'Quadra Ativa',
        sport: Sport.BEACH_VOLLEYBALL,
        pricePerSlot: 100,
        slotDurationMinutes: 60,
        bufferMinutes: 0,
      },
    });
    activeCourtId = activeCourt.id;

    const inactiveCourt = await prisma.court.create({
      data: { arenaId, name: 'Quadra Inativa', sport: Sport.BEACH_VOLLEYBALL, isActive: false },
    });
    inactiveCourtId = inactiveCourt.id;

    // Reserva CUSTOMER de User A — usada nos testes de "minhas reservas" e
    // de privacidade (User B não pode vê-la).
    await prisma.booking.create({
      data: {
        courtId: activeCourtId,
        userId: userA.id,
        type: BookingType.CUSTOMER,
        startsAt: new Date('2026-09-07T13:00:00-03:00'),
        endsAt: new Date('2026-09-07T14:00:00-03:00'),
        total: 100,
      },
    });

    // BLOCK criado pelo OWNER — tem userId preenchido (o admin), mas nunca
    // pode aparecer em "minhas reservas" de ninguém (item 30).
    await prisma.booking.create({
      data: {
        courtId: activeCourtId,
        userId: owner.id,
        type: BookingType.BLOCK,
        startsAt: new Date('2026-09-07T18:00:00-03:00'),
        endsAt: new Date('2026-09-07T19:00:00-03:00'),
        reason: 'Evento privado',
      },
    });

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
    await prisma.booking.deleteMany({
      where: { courtId: { in: [activeCourtId, inactiveCourtId] } },
    });
    await prisma.arena.deleteMany({ where: { id: arenaId } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /v1/arenas/discover', () => {
    it('exige autenticação (401)', async () => {
      await request(app.getHttpServer()).get('/v1/arenas/discover').expect(401);
    });

    it('não exige ArenaMember e nunca inclui role/members', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/arenas/discover')
        .set(...authHeader('token-a'))
        .expect(200);

      const arenas = response.body as DiscoverySummaryBody[];
      const found = arenas.find((a) => a.id === arenaId);
      expect(found).toBeDefined();
      expect(found?.sports).toEqual([Sport.BEACH_VOLLEYBALL]);
      expect(found?.role).toBeUndefined();
      expect(found?.members).toBeUndefined();
    });
  });

  describe('GET /v1/arenas/discover/:arenaId', () => {
    it('retorna a arena com timezone e só as quadras ativas', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/discover/${arenaId}`)
        .set(...authHeader('token-a'))
        .expect(200);

      const body = response.body as DiscoveryDetailBody;
      expect(body.timezone).toBe('America/Sao_Paulo');
      expect(body.members).toBeUndefined();
      const courtIds = body.courts.map((c) => c.id);
      expect(courtIds).toContain(activeCourtId);
      expect(courtIds).not.toContain(inactiveCourtId);
      expect(body.courts[0]?.isActive).toBeUndefined();
    });

    it('404 para arena inexistente', async () => {
      await request(app.getHttpServer())
        .get('/v1/arenas/discover/arena-que-nao-existe')
        .set(...authHeader('token-a'))
        .expect(404);
    });
  });

  describe('GET /v1/users/me/bookings', () => {
    it('exige autenticação (401)', async () => {
      await request(app.getHttpServer()).get('/v1/users/me/bookings').expect(401);
    });

    it('User A vê só a própria reserva CUSTOMER — nunca o BLOCK do OWNER', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/users/me/bookings')
        .set(...authHeader('token-a'))
        .expect(200);

      const bookings = response.body as MyBookingBody[];
      expect(bookings).toHaveLength(1);
      expect(bookings[0]?.court.arena.id).toBe(arenaId);
      expect(bookings[0]?.court.arena.timezone).toBe('America/Sao_Paulo');
    });

    it('User B (sem reservas) recebe lista vazia — nunca vê a reserva de User A', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/users/me/bookings')
        .set(...authHeader('token-b'))
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('OWNER (que só criou BLOCK, nunca uma reserva de cliente) também recebe lista vazia', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/users/me/bookings')
        .set(...authHeader('token-owner'))
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /v1/users/me/bookings/:bookingId', () => {
    let myBookingId: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/users/me/bookings')
        .set(...authHeader('token-a'))
        .expect(200);
      myBookingId = (response.body as MyBookingBody[])[0]!.id;
    });

    it('User A consegue ver o detalhe da própria reserva', async () => {
      await request(app.getHttpServer())
        .get(`/v1/users/me/bookings/${myBookingId}`)
        .set(...authHeader('token-a'))
        .expect(200);
    });

    it('User B recebe 404 (não 403) ao tentar ver a reserva de User A — não vaza existência', async () => {
      await request(app.getHttpServer())
        .get(`/v1/users/me/bookings/${myBookingId}`)
        .set(...authHeader('token-b'))
        .expect(404);
    });

    it('cancelamento continua sendo a rota já existente, usando arenaId/courtId da resposta', async () => {
      const detail = await request(app.getHttpServer())
        .get(`/v1/users/me/bookings/${myBookingId}`)
        .set(...authHeader('token-a'))
        .expect(200);
      const booking = detail.body as MyBookingBody;

      await request(app.getHttpServer())
        .post(
          `/v1/arenas/${booking.court.arena.id}/courts/${booking.court.id}/bookings/${booking.id}/cancel`,
        )
        .set(...authHeader('token-a'))
        .expect(200);

      const afterCancel = await request(app.getHttpServer())
        .get(`/v1/users/me/bookings/${myBookingId}`)
        .set(...authHeader('token-a'))
        .expect(200);
      expect((afterCancel.body as MyBookingBody).status).toBe('CANCELLED');
    });
  });
});
