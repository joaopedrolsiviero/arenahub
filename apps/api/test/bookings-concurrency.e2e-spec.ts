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
  let courtBatchId: string;

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
    // Quadra dedicada aos testes de múltiplos horários abaixo: preço e
    // duração explícitos (pra verificar o total somado) e bufferMinutes=0
    // (pra slots consecutivos ficarem exatamente encostados, sem gap).
    const courtBatch = await prisma.court.create({
      data: {
        arenaId,
        name: 'Quadra Múltiplos Horários',
        sport: Sport.BEACH_VOLLEYBALL,
        pricePerSlot: 50,
        slotDurationMinutes: 60,
        bufferMinutes: 0,
      },
    });
    courtBatchId = courtBatch.id;

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
    // listen(), não init(): ver production-hardening.e2e-spec.ts (ECONNRESET).
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({
      where: { courtId: { in: [courtOneId, courtTwoId, courtBatchId] } },
    });
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

  // Fase 13: duas requisições de cancelamento disparadas ao mesmo tempo para
  // a MESMA reserva — a proteção é `updateMany` condicionado a
  // `status: CONFIRMED` (Fase 13, ver BookingsService.cancel), não uma
  // checagem em memória. As duas respostas devem refletir sucesso (200,
  // idempotente por natureza — nunca um 409/500 pra a "perdedora"), o estado
  // final tem que ser CANCELLED, e só pode existir UM cancelamento "real"
  // registrado (nunca dois cancelledAt/cancelledByUserId diferentes
  // sobrevivendo em sequência inconsistente — ambas as respostas devem
  // refletir o MESMO cancelledByUserId, o da vencedora da corrida).
  it('cancelamento simultâneo da mesma reserva: as duas respostas convergem pro mesmo estado final', async () => {
    const startsAt = '2027-04-01T10:00:00-03:00';
    const created = await createBooking(
      courtOneId,
      'token-a',
      'cancel-race-create',
      startsAt,
    ).expect(201);
    const bookingId = (created.body as { id: string }).id;

    function cancelBooking(token: keyof typeof TOKENS) {
      return request(app.getHttpServer())
        .post(`/v1/arenas/${arenaId}/courts/${courtOneId}/bookings/${bookingId}/cancel`)
        .set(...authHeader(token));
    }

    const [resA, resB] = await Promise.all([cancelBooking('token-a'), cancelBooking('token-a')]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const bodyA = resA.body as { status: string; cancelledByUserId: string | null };
    const bodyB = resB.body as { status: string; cancelledByUserId: string | null };
    expect(bodyA.status).toBe('CANCELLED');
    expect(bodyB.status).toBe('CANCELLED');
    // As duas respostas refletem o MESMO cancelamento (mesmo
    // cancelledByUserId) — nenhuma delas "ganhou" uma segunda transição de
    // estado própria.
    expect(bodyA.cancelledByUserId).toBe(bodyB.cancelledByUserId);

    const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(finalBooking.status).toBe('CANCELLED');
  });

  // Fase "Melhorias no fluxo de reserva": seleção de múltiplos horários numa
  // única ação de reserva. Provas contra o Postgres real (não mock) de que a
  // atomicidade continua garantida pelo MESMO mecanismo de sempre — o
  // `prisma.$transaction` do `IdempotencyService.execute` — sem nenhum
  // mecanismo novo.
  describe('Múltiplos horários numa única reserva (real, contra Postgres)', () => {
    function createBatch(idempotencyKey: string, startsAt: string, additionalStartTimes: string[]) {
      return request(app.getHttpServer())
        .post(`/v1/arenas/${arenaId}/courts/${courtBatchId}/bookings`)
        .set(...authHeader('token-a'))
        .set('Idempotency-Key', idempotencyKey)
        .send({ startsAt, additionalStartTimes });
    }

    it('horários consecutivos: cria UM único Booking cobrindo o intervalo inteiro, com o total somado', async () => {
      const response = await createBatch('multi-consecutive-1', '2027-05-01T09:00:00-03:00', [
        '2027-05-01T10:00:00-03:00',
        '2027-05-01T11:00:00-03:00',
      ]).expect(201);

      const bookings = response.body as {
        id: string;
        startsAt: string;
        endsAt: string;
        total: string;
      }[];
      expect(bookings).toHaveLength(1);
      expect(bookings[0]).toMatchObject({
        startsAt: '2027-05-01T12:00:00.000Z', // 09:00 -03:00
        endsAt: '2027-05-01T15:00:00.000Z', // 3 slots de 60min -> 12:00
      });
      expect(Number(bookings[0]!.total)).toBe(150); // 50 x 3 slots

      const count = await prisma.booking.count({
        where: { courtId: courtBatchId, startsAt: new Date('2027-05-01T09:00:00-03:00') },
      });
      expect(count).toBe(1);
    });

    it('horários NÃO consecutivos: cria dois Bookings distintos, na mesma requisição/transação', async () => {
      const response = await createBatch('multi-gap-1', '2027-05-02T09:00:00-03:00', [
        '2027-05-02T14:00:00-03:00', // longe do primeiro — trecho separado
      ]).expect(201);

      const bookings = response.body as { id: string }[];
      expect(bookings).toHaveLength(2);

      const count = await prisma.booking.count({
        where: {
          courtId: courtBatchId,
          startsAt: {
            in: [new Date('2027-05-02T09:00:00-03:00'), new Date('2027-05-02T14:00:00-03:00')],
          },
        },
      });
      expect(count).toBe(2);
    });

    it('atomicidade real: conflito em UM dos horários do lote reverte o lote INTEIRO — nenhum Booking sobrevive', async () => {
      // Reserva prévia ocupando 11:00-12:00, no meio do lote que será tentado.
      await createBatch('multi-atomic-setup', '2027-05-03T11:00:00-03:00', []).expect(201);

      const response = await createBatch('multi-atomic-attempt', '2027-05-03T09:00:00-03:00', [
        '2027-05-03T10:00:00-03:00', // livre
        '2027-05-03T11:00:00-03:00', // conflita com a reserva prévia
      ]).expect(409);
      expect(response.status).toBe(409);

      // Nem 09:00 nem 10:00 (que sozinhos seriam válidos) foram persistidos —
      // o rollback do Postgres desfez a transação inteira, não só o trecho
      // que conflitou.
      const survivors = await prisma.booking.count({
        where: {
          courtId: courtBatchId,
          startsAt: {
            in: [new Date('2027-05-03T09:00:00-03:00'), new Date('2027-05-03T10:00:00-03:00')],
          },
        },
      });
      expect(survivors).toBe(0);
    });

    it('idempotência de um lote multi-horário: replay da mesma chave não duplica nenhum Booking', async () => {
      const first = await createBatch('multi-idem-1', '2027-05-04T09:00:00-03:00', [
        '2027-05-04T10:00:00-03:00',
      ]).expect(201);
      const firstIds = (first.body as { id: string }[]).map((b) => b.id).sort();

      const replay = await createBatch('multi-idem-1', '2027-05-04T09:00:00-03:00', [
        '2027-05-04T10:00:00-03:00',
      ]).expect(201);
      const replayIds = (replay.body as { id: string }[]).map((b) => b.id).sort();

      expect(replayIds).toEqual(firstIds);

      const count = await prisma.booking.count({
        where: { courtId: courtBatchId, startsAt: new Date('2027-05-04T09:00:00-03:00') },
      });
      expect(count).toBe(1);
    });
  });
});
