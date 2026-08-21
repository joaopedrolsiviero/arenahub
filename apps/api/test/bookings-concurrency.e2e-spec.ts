import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient, Sport, Weekday } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

// Fase 4, itens 14-16, 46-47: prova real de que o Postgres (advisory lock +
// EXCLUDE constraint) é a autoridade final contra conflitos sob concorrência
// — não uma checagem findMany/findFirst na aplicação, que teria uma janela
// de corrida entre "verificar" e "inserir". Requisições disparadas de
// verdade via Promise.all contra o servidor Nest real (supertest) e o
// Postgres real (docker compose), nunca mockado.
const USER_A = { clerkId: 'user_e2e_concurrency_a', email: 'concurrency-e2e-a@example.com' };
const USER_B = { clerkId: 'user_e2e_concurrency_b', email: 'concurrency-e2e-b@example.com' };

const TOKENS: Record<string, string> = {
  'token-a': USER_A.clerkId,
  'token-b': USER_B.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

describe('Bookings — concorrência real (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaId: string;
  let courtOneId: string;
  let courtTwoId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.user.create({ data: USER_A });
    await prisma.user.create({ data: USER_B });

    const arena = await prisma.arena.create({
      data: { name: 'Arena Concorrência E2E', slug: 'arena-concurrency-e2e' },
    });
    arenaId = arena.id;
    const courtOne = await prisma.court.create({
      data: { arenaId, name: 'Quadra 1 Concorrência', sport: Sport.BEACH_VOLLEYBALL },
    });
    const courtTwo = await prisma.court.create({
      data: { arenaId, name: 'Quadra 2 Concorrência', sport: Sport.BEACH_VOLLEYBALL },
    });
    courtOneId = courtOne.id;
    courtTwoId = courtTwo.id;

    // Fase 5: Arena nasce fechada por padrão — aberta o dia inteiro em
    // todos os dias da semana aqui, já que este arquivo é sobre concorrência
    // na criação de Booking, não sobre horário de funcionamento em si.
    await prisma.arenaOperatingHours.createMany({
      data: Object.values(Weekday).map((dayOfWeek) => ({
        arenaId,
        dayOfWeek,
        opensAt: 0,
        closesAt: 1439,
      })),
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
    await prisma.booking.deleteMany({ where: { courtId: { in: [courtOneId, courtTwoId] } } });
    await prisma.arena.deleteMany({ where: { id: arenaId } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  function createBooking(
    courtId: string,
    token: keyof typeof TOKENS,
    idempotencyKey: string,
    startsAt: string,
  ) {
    return request(app.getHttpServer())
      .post(`/v1/arenas/${arenaId}/courts/${courtId}/bookings`)
      .set(...authHeader(token))
      .set('Idempotency-Key', idempotencyKey)
      .send({ startsAt });
  }

  // Item 46: mesma quadra, mesmo horário, chaves de idempotência diferentes
  // (duas pessoas diferentes tentando o mesmo horário) — exatamente uma
  // sucede, a outra recebe 409. Repetido em várias janelas de horário
  // distintas na mesma execução para reduzir o risco de falso positivo.
  it('mesma quadra + mesmo horário: exatamente 1 sucesso e 1 conflito, nunca 2 sucessos (repetido 8x)', async () => {
    const trials = 8;
    for (let i = 0; i < trials; i++) {
      const startsAt = `2027-01-${String(10 + i).padStart(2, '0')}T10:00:00-03:00`;

      const [resA, resB] = await Promise.all([
        createBooking(courtOneId, 'token-a', `race-${i}-a`, startsAt),
        createBooking(courtOneId, 'token-b', `race-${i}-b`, startsAt),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const count = await prisma.booking.count({
        where: { courtId: courtOneId, startsAt: new Date(startsAt) },
      });
      expect(count).toBe(1);
    }
  }, 30000);

  // Item 47: quadras diferentes, mesmo horário — o lock é por quadra
  // (hashtext(courtId) via pg_advisory_xact_lock), nunca global, então as
  // duas devem suceder simultaneamente.
  it('quadras diferentes + mesmo horário: as duas reservas sucedem (lock não é global)', async () => {
    const startsAt = '2027-02-01T10:00:00-03:00';

    const [resOne, resTwo] = await Promise.all([
      createBooking(courtOneId, 'token-a', 'diff-court-1', startsAt),
      createBooking(courtTwoId, 'token-b', 'diff-court-2', startsAt),
    ]);

    expect(resOne.status).toBe(201);
    expect(resTwo.status).toBe(201);
  });

  // Item 51 (concorrência de idempotência): mesma Idempotency-Key, mesmo
  // usuário, mesmo payload, disparadas ao mesmo tempo — nunca podem criar
  // dois Bookings. As duas respostas devem refletir SUCESSO com o MESMO
  // Booking (a perdedora replica a resposta da vencedora), diferente do
  // teste acima (onde chaves diferentes produzem 1 sucesso + 1 conflito).
  it('mesma Idempotency-Key disparada 2x simultaneamente: nunca cria 2 Bookings', async () => {
    const startsAt = '2027-03-01T10:00:00-03:00';

    const [resA, resB] = await Promise.all([
      createBooking(courtOneId, 'token-a', 'same-key-concurrent', startsAt),
      createBooking(courtOneId, 'token-a', 'same-key-concurrent', startsAt),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect((resA.body as { id: string }).id).toBe((resB.body as { id: string }).id);

    const count = await prisma.booking.count({
      where: { courtId: courtOneId, startsAt: new Date(startsAt) },
    });
    expect(count).toBe(1);
  });
});
