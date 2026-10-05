import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

const OWNER_A = { clerkId: 'user_e2e_own_owner_a', email: 'own-owner-a@example.com' };
const ADMIN_A = { clerkId: 'user_e2e_own_admin_a', email: 'own-admin-a@example.com' };
const OUTSIDER = { clerkId: 'user_e2e_own_outsider', email: 'own-outsider@example.com' };
const OWNER_B = { clerkId: 'user_e2e_own_owner_b', email: 'own-owner-b@example.com' };
const ADMIN_B = { clerkId: 'user_e2e_own_admin_b', email: 'own-admin-b@example.com' };
// Segundo ADMIN da Arena A, só pra Arena separada de concorrência real
// (item 50/88-B) — nunca reaproveitada pela arena principal, pra não
// interferir no estado usado pelos outros testes.
const OWNER_C = { clerkId: 'user_e2e_own_owner_c', email: 'own-owner-c@example.com' };
const ADMIN_C1 = { clerkId: 'user_e2e_own_admin_c1', email: 'own-admin-c1@example.com' };
const ADMIN_C2 = { clerkId: 'user_e2e_own_admin_c2', email: 'own-admin-c2@example.com' };

const TOKENS: Record<string, string> = {
  'token-owner-a': OWNER_A.clerkId,
  'token-admin-a': ADMIN_A.clerkId,
  'token-outsider': OUTSIDER.clerkId,
  'token-owner-b': OWNER_B.clerkId,
  'token-admin-b': ADMIN_B.clerkId,
  'token-owner-c': OWNER_C.clerkId,
  'token-admin-c1': ADMIN_C1.clerkId,
  'token-admin-c2': ADMIN_C2.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

describe('Transferência de ownership (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaAId: string;
  let arenaBId: string;
  let arenaCId: string;
  let ownerAId: string;
  let adminAId: string;
  let adminBId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const ownerA = await prisma.user.create({ data: OWNER_A });
    const adminA = await prisma.user.create({ data: ADMIN_A });
    await prisma.user.create({ data: OUTSIDER });
    await prisma.user.create({ data: OWNER_B });
    const adminB = await prisma.user.create({ data: ADMIN_B });
    await prisma.user.create({ data: OWNER_C });
    await prisma.user.create({ data: ADMIN_C1 });
    await prisma.user.create({ data: ADMIN_C2 });
    ownerAId = ownerA.id;
    adminAId = adminA.id;
    adminBId = adminB.id;

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

    const arenaA = await request(app.getHttpServer())
      .post('/v1/arenas')
      .set(...authHeader('token-owner-a'))
      .send({
        name: 'Arena Ownership A',
        slug: 'arena-ownership-a-e2e',
        timezone: 'America/Sao_Paulo',
      })
      .expect(201);
    arenaAId = (arenaA.body as { id: string }).id;

    const arenaB = await request(app.getHttpServer())
      .post('/v1/arenas')
      .set(...authHeader('token-owner-b'))
      .send({
        name: 'Arena Ownership B',
        slug: 'arena-ownership-b-e2e',
        timezone: 'America/Sao_Paulo',
      })
      .expect(201);
    arenaBId = (arenaB.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/members`)
      .set(...authHeader('token-owner-a'))
      .send({ email: ADMIN_A.email, role: 'ADMIN' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaBId}/members`)
      .set(...authHeader('token-owner-b'))
      .send({ email: ADMIN_B.email, role: 'ADMIN' })
      .expect(201);

    // Arena C: só existe pra prova de concorrência real (item 50/88-B) —
    // isolada da Arena A pra não interferir no restante dos testes.
    const arenaC = await request(app.getHttpServer())
      .post('/v1/arenas')
      .set(...authHeader('token-owner-c'))
      .send({
        name: 'Arena Ownership C',
        slug: 'arena-ownership-c-e2e',
        timezone: 'America/Sao_Paulo',
      })
      .expect(201);
    arenaCId = (arenaC.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaCId}/members`)
      .set(...authHeader('token-owner-c'))
      .send({ email: ADMIN_C1.email, role: 'ADMIN' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaCId}/members`)
      .set(...authHeader('token-owner-c'))
      .send({ email: ADMIN_C2.email, role: 'ADMIN' })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.arena.deleteMany({ where: { id: { in: [arenaAId, arenaBId, arenaCId] } } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('5. ADMIN não consegue transferir ownership (403)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/ownership/transfer`)
      .set(...authHeader('token-admin-a'))
      .send({ newOwnerUserId: adminAId })
      .expect(403);
  });

  it('6. CUSTOMER (não-membro) não consegue transferir ownership (403)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/ownership/transfer`)
      .set(...authHeader('token-outsider'))
      .send({ newOwnerUserId: adminAId })
      .expect(403);
  });

  it('8. destinatário não-membro é rejeitado (409)', async () => {
    const outsider = await prisma.user.findUniqueOrThrow({ where: { clerkId: OUTSIDER.clerkId } });

    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/ownership/transfer`)
      .set(...authHeader('token-owner-a'))
      .send({ newOwnerUserId: outsider.id })
      .expect(409);
  });

  it('7/9. destinatário de outra arena (cross-tenant) é rejeitado (409)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/ownership/transfer`)
      .set(...authHeader('token-owner-a'))
      .send({ newOwnerUserId: adminBId })
      .expect(409);
  });

  it('10. self-transfer é rejeitado (409)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/ownership/transfer`)
      .set(...authHeader('token-owner-a'))
      .send({ newOwnerUserId: ownerAId })
      .expect(409);
  });

  it('mass assignment: campos extras são rejeitados (400)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/ownership/transfer`)
      .set(...authHeader('token-owner-a'))
      .send({ newOwnerUserId: adminAId, role: 'OWNER', arenaId: 'forjado' })
      .expect(400);
  });

  it('52/53. OWNER de outra arena não transfere ownership da Arena A (cross-tenant, 403)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/ownership/transfer`)
      .set(...authHeader('token-owner-b'))
      .send({ newOwnerUserId: adminAId })
      .expect(403);
  });

  it('1/2/3/4/11/12. OWNER transfere para ADMIN — exatamente um OWNER, bookings/histórico intactos', async () => {
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/courts`)
      .set(...authHeader('token-owner-a'))
      .send({ name: 'Quadra Ownership', sport: 'BEACH_VOLLEYBALL' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/ownership/transfer`)
      .set(...authHeader('token-owner-a'))
      .send({ newOwnerUserId: adminAId })
      .expect(201);

    expect(response.body).toMatchObject({
      arenaId: arenaAId,
      previousOwnerUserId: ownerAId,
      newOwnerUserId: adminAId,
    });

    const members = await prisma.arenaMember.findMany({ where: { arenaId: arenaAId } });
    expect(members.find((m) => m.userId === ownerAId)?.role).toBe('ADMIN');
    expect(members.find((m) => m.userId === adminAId)?.role).toBe('OWNER');
    expect(members.filter((m) => m.role === 'OWNER')).toHaveLength(1);

    // 11/12: quadra criada antes da transferência continua intacta, e o
    // antigo OWNER (agora ADMIN) continua acessando o dashboard.
    const courts = await request(app.getHttpServer())
      .get(`/v1/arenas/${arenaAId}/courts`)
      .set(...authHeader('token-admin-a')) // agora é o novo OWNER
      .expect(200);
    expect((courts.body as { name: string }[]).some((c) => c.name === 'Quadra Ownership')).toBe(
      true,
    );

    await request(app.getHttpServer())
      .get(`/v1/arenas/${arenaAId}/dashboard`)
      .set(...authHeader('token-owner-a')) // antigo OWNER, agora ADMIN
      .expect(200);
  });

  it('nova tentativa do antigo OWNER falha (403) — ele não é mais OWNER', async () => {
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/ownership/transfer`)
      .set(...authHeader('token-owner-a'))
      .send({ newOwnerUserId: ownerAId })
      .expect(403);
  });

  describe('Concorrência real (item 50/88-B)', () => {
    it('duas transferências simultâneas do mesmo OWNER — exatamente uma sucede, estado final consistente', async () => {
      const admin1 = await prisma.user.findUniqueOrThrow({ where: { clerkId: ADMIN_C1.clerkId } });
      const admin2 = await prisma.user.findUniqueOrThrow({ where: { clerkId: ADMIN_C2.clerkId } });

      const [resToC1, resToC2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/v1/arenas/${arenaCId}/ownership/transfer`)
          .set(...authHeader('token-owner-c'))
          .send({ newOwnerUserId: admin1.id }),
        request(app.getHttpServer())
          .post(`/v1/arenas/${arenaCId}/ownership/transfer`)
          .set(...authHeader('token-owner-c'))
          .send({ newOwnerUserId: admin2.id }),
      ]);

      const statuses = [resToC1.status, resToC2.status].sort();
      expect(statuses).toEqual([201, 403]);

      const members = await prisma.arenaMember.findMany({ where: { arenaId: arenaCId } });
      const owners = members.filter((m) => m.role === 'OWNER');
      // Nunca zero, nunca dois — sempre exatamente um (item 50).
      expect(owners).toHaveLength(1);
      expect(['user_e2e_own_admin_c1', 'user_e2e_own_admin_c2']).toContain(
        (await prisma.user.findUniqueOrThrow({ where: { id: owners[0]!.userId } })).clerkId,
      );
    });
  });
});
