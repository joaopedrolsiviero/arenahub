import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient, Weekday } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

// Fase 28, item 27 — prova de ponta a ponta de que a jornada de onboarding
// (OWNER cria arena → quadra → preço → horário → arena pronta) realmente
// alimenta a experiência do cliente (descoberta → disponibilidade →
// reserva), tudo pelos endpoints REAIS já validados nas fases anteriores —
// nenhum seed direto via Prisma para arena/quadra/horário/reserva em si
// (só usuários, que não têm endpoint de cadastro nesta arquitetura). Nunca
// paga de verdade (fora de escopo, item 28 do prompt).
const USER_OWNER = { clerkId: 'user_e2e_onboarding_owner', email: 'onboarding-owner@example.com' };
const USER_CUSTOMER = {
  clerkId: 'user_e2e_onboarding_customer',
  email: 'onboarding-customer@example.com',
};

const TOKENS: Record<string, string> = {
  'token-owner': USER_OWNER.clerkId,
  'token-customer': USER_CUSTOMER.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

interface ArenaBody {
  id: string;
  setupStatus?: { isReady: boolean };
}

interface CourtBody {
  id: string;
  pricePerSlot: string;
}

interface AvailabilityBody {
  slots: { startsAt: string; endsAt: string; available: boolean }[];
}

interface BookingBody {
  id: string;
  status: string;
  total: string;
  courtId: string;
}

describe('Onboarding — jornada completa OWNER → CLIENTE (e2e, Fase 28)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaId: string;
  let courtId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.user.create({ data: USER_OWNER });
    await prisma.user.create({ data: USER_CUSTOMER });

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
    if (arenaId) {
      // Booking.courtId é RESTRICT (nunca cascade) — a reserva criada no
      // passo 6b precisa ser removida antes da Arena, senão a FK barra o
      // delete (mesma decisão de arquitetura testada em outros specs).
      await prisma.booking.deleteMany({ where: { courtId } });
      await prisma.arena.deleteMany({ where: { id: arenaId } });
    }
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('1. OWNER cria a arena — ainda não está pronta (sem quadra, sem horário)', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/arenas')
      .set(...authHeader('token-owner'))
      .send({
        name: 'Arena Onboarding E2E',
        slug: 'arena-onboarding-e2e',
        timezone: 'America/Sao_Paulo',
      })
      .expect(201);

    arenaId = (response.body as ArenaBody).id;
    expect(arenaId).toBeTruthy();

    const detail = await request(app.getHttpServer())
      .get(`/v1/arenas/${arenaId}`)
      .set(...authHeader('token-owner'))
      .expect(200);
    expect((detail.body as ArenaBody).setupStatus?.isReady).toBe(false);
  });

  it('2. OWNER cria a primeira quadra já com preço e duração — ainda não está pronta (sem horário)', async () => {
    const response = await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaId}/courts`)
      .set(...authHeader('token-owner'))
      .send({
        name: 'Quadra 1',
        sport: 'BEACH_VOLLEYBALL',
        pricePerSlot: 90,
        slotDurationMinutes: 60,
      })
      .expect(201);

    courtId = (response.body as CourtBody).id;
    expect((response.body as CourtBody).pricePerSlot).toBe('90');

    const detail = await request(app.getHttpServer())
      .get(`/v1/arenas/${arenaId}`)
      .set(...authHeader('token-owner'))
      .expect(200);
    expect((detail.body as ArenaBody).setupStatus?.isReady).toBe(false);
  });

  it('3. OWNER configura o horário de funcionamento — arena fica pronta', async () => {
    await request(app.getHttpServer())
      .put(`/v1/arenas/${arenaId}/operating-hours`)
      .set(...authHeader('token-owner'))
      .send({
        intervals: Object.values(Weekday).map((dayOfWeek) => ({
          dayOfWeek,
          opensAt: '00:00',
          closesAt: '23:59',
        })),
      })
      .expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/v1/arenas/${arenaId}`)
      .set(...authHeader('token-owner'))
      .expect(200);
    const body = detail.body as ArenaBody & {
      setupStatus: {
        hasBasicInfo: boolean;
        hasActiveCourtWithPricing: boolean;
        hasOperatingHours: boolean;
        isReady: boolean;
      };
    };
    expect(body.setupStatus).toEqual({
      hasBasicInfo: true,
      hasActiveCourtWithPricing: true,
      hasOperatingHours: true,
      isReady: true,
    });
  });

  it('4. CLIENTE descobre a arena pronta (isReady=true), sem precisar ser membro', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/arenas/discover/${arenaId}`)
      .set(...authHeader('token-customer'))
      .expect(200);

    const body = response.body as { isReady: boolean; courts: { id: string }[] };
    expect(body.isReady).toBe(true);
    expect(body.courts.map((c) => c.id)).toContain(courtId);
  });

  it('5. CLIENTE vê disponibilidade real da quadra configurada pelo OWNER', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/arenas/${arenaId}/courts/${courtId}/availability`)
      .query({ from: '2027-06-01T00:00:00-03:00', to: '2027-06-01T12:00:00-03:00' })
      .set(...authHeader('token-customer'))
      .expect(200);

    const body = response.body as AvailabilityBody;
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots.every((slot) => slot.available)).toBe(true);
  });

  it('6a. CLIENTE tentando forjar total/userId/status no corpo é rejeitado (400) — o DTO nem aceita esses campos (Caso 14)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaId}/courts/${courtId}/bookings`)
      .set(...authHeader('token-customer'))
      .set('Idempotency-Key', 'onboarding-journey-booking-mass-assignment')
      .send({
        startsAt: '2027-06-01T09:00:00-03:00',
        total: 999999,
        userId: 'outro-usuario',
        status: 'CANCELLED',
      })
      .expect(400);
  });

  it('6b. CLIENTE cria a reserva com o corpo válido — total vem sempre do preço configurado no passo 2 (Caso 14)', async () => {
    const response = await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaId}/courts/${courtId}/bookings`)
      .set(...authHeader('token-customer'))
      .set('Idempotency-Key', 'onboarding-journey-booking-1')
      .send({ startsAt: '2027-06-01T09:00:00-03:00' })
      .expect(201);

    const body = response.body as BookingBody;
    expect(body.status).toBe('CONFIRMED');
    expect(body.total).toBe('90'); // exatamente o pricePerSlot configurado no passo 2
    expect(body.courtId).toBe(courtId);
  });
});
