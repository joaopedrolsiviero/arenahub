import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ArenaRole, PrismaClient, Weekday } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

// User OWNER/ADMIN: administram a Arena A (OWNER cria, ADMIN é promovido
// direto via Prisma, mesmo padrão de arenas-courts.e2e-spec.ts).
// User CUSTOMER: autenticado, sem nenhum vínculo com a Arena A — usado para
// provar que ler o horário não exige ArenaMember, mas alterar exige.
// User OTHER_OWNER: OWNER de uma Arena B separada — usado para o teste
// cross-tenant (não pode alterar horário de uma arena onde não é membro).
const USER_OWNER = { clerkId: 'user_e2e_oh_owner', email: 'oh-e2e-owner@example.com' };
const USER_ADMIN = { clerkId: 'user_e2e_oh_admin', email: 'oh-e2e-admin@example.com' };
const USER_CUSTOMER = { clerkId: 'user_e2e_oh_customer', email: 'oh-e2e-customer@example.com' };
const USER_OTHER_OWNER = { clerkId: 'user_e2e_oh_other_owner', email: 'oh-e2e-other@example.com' };

const TOKENS: Record<string, string> = {
  'token-owner': USER_OWNER.clerkId,
  'token-admin': USER_ADMIN.clerkId,
  'token-customer': USER_CUSTOMER.clerkId,
  'token-other-owner': USER_OTHER_OWNER.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

interface IntervalBody {
  id: string;
  dayOfWeek: Weekday;
  opensAt: string;
  closesAt: string;
}

describe('Operating Hours (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaId: string;
  let otherArenaId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const owner = await prisma.user.create({ data: USER_OWNER });
    const admin = await prisma.user.create({ data: USER_ADMIN });
    await prisma.user.create({ data: USER_CUSTOMER });
    const otherOwner = await prisma.user.create({ data: USER_OTHER_OWNER });

    const arena = await prisma.arena.create({
      data: { name: 'Arena Operating Hours E2E', slug: 'arena-operating-hours-e2e' },
    });
    arenaId = arena.id;
    await prisma.arenaMember.create({ data: { arenaId, userId: owner.id, role: ArenaRole.OWNER } });
    await prisma.arenaMember.create({ data: { arenaId, userId: admin.id, role: ArenaRole.ADMIN } });

    const otherArena = await prisma.arena.create({
      data: { name: 'Arena B Operating Hours E2E', slug: 'arena-b-operating-hours-e2e' },
    });
    otherArenaId = otherArena.id;
    await prisma.arenaMember.create({
      data: { arenaId: otherArenaId, userId: otherOwner.id, role: ArenaRole.OWNER },
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
    await prisma.arena.deleteMany({ where: { id: { in: [arenaId, otherArenaId] } } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  const url = (id: string) => `/v1/arenas/${id}/operating-hours`;

  describe('GET /v1/arenas/:arenaId/operating-hours', () => {
    it('exige autenticação (401)', async () => {
      await request(app.getHttpServer()).get(url(arenaId)).expect(401);
    });

    it('retorna lista vazia para arena recém-criada (fechada por padrão)', async () => {
      const response = await request(app.getHttpServer())
        .get(url(arenaId))
        .set(...authHeader('token-owner'))
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('não exige ArenaMember — cliente comum consegue consultar', async () => {
      await request(app.getHttpServer())
        .get(url(arenaId))
        .set(...authHeader('token-customer'))
        .expect(200);
    });

    it('404 para arena inexistente', async () => {
      await request(app.getHttpServer())
        .get(url('arena-que-nao-existe'))
        .set(...authHeader('token-owner'))
        .expect(404);
    });
  });

  describe('PUT /v1/arenas/:arenaId/operating-hours', () => {
    it('cliente comum (sem vínculo) não pode alterar (403)', async () => {
      await request(app.getHttpServer())
        .put(url(arenaId))
        .set(...authHeader('token-customer'))
        .send({ intervals: [{ dayOfWeek: 'MONDAY', opensAt: '08:00', closesAt: '18:00' }] })
        .expect(403);
    });

    it('OWNER de outra arena não pode alterar esta (403)', async () => {
      await request(app.getHttpServer())
        .put(url(arenaId))
        .set(...authHeader('token-other-owner'))
        .send({ intervals: [{ dayOfWeek: 'MONDAY', opensAt: '08:00', closesAt: '18:00' }] })
        .expect(403);
    });

    it('rejeita intervalo com opensAt >= closesAt (400)', async () => {
      await request(app.getHttpServer())
        .put(url(arenaId))
        .set(...authHeader('token-owner'))
        .send({ intervals: [{ dayOfWeek: 'MONDAY', opensAt: '18:00', closesAt: '08:00' }] })
        .expect(400);
    });

    it('rejeita intervalos sobrepostos no mesmo dia (400)', async () => {
      await request(app.getHttpServer())
        .put(url(arenaId))
        .set(...authHeader('token-owner'))
        .send({
          intervals: [
            { dayOfWeek: 'MONDAY', opensAt: '08:00', closesAt: '12:00' },
            { dayOfWeek: 'MONDAY', opensAt: '11:00', closesAt: '14:00' },
          ],
        })
        .expect(400);
    });

    it('rejeita horário fora do formato HH:mm (400)', async () => {
      await request(app.getHttpServer())
        .put(url(arenaId))
        .set(...authHeader('token-owner'))
        .send({ intervals: [{ dayOfWeek: 'MONDAY', opensAt: '8:00', closesAt: '18:00' }] })
        .expect(400);
    });

    it('OWNER substitui a semana inteira com sucesso, com múltiplos intervalos no mesmo dia', async () => {
      const response = await request(app.getHttpServer())
        .put(url(arenaId))
        .set(...authHeader('token-owner'))
        .send({
          intervals: [
            { dayOfWeek: 'MONDAY', opensAt: '08:00', closesAt: '12:00' },
            { dayOfWeek: 'MONDAY', opensAt: '14:00', closesAt: '22:00' },
            { dayOfWeek: 'SATURDAY', opensAt: '09:00', closesAt: '18:00' },
          ],
        })
        .expect(200);

      const intervals = response.body as IntervalBody[];
      expect(intervals).toHaveLength(3);
      expect(intervals.filter((i) => i.dayOfWeek === 'MONDAY')).toHaveLength(2);

      const getResponse = await request(app.getHttpServer())
        .get(url(arenaId))
        .set(...authHeader('token-customer'))
        .expect(200);
      expect(getResponse.body).toEqual(intervals);
    });

    it('ADMIN também pode alterar', async () => {
      await request(app.getHttpServer())
        .put(url(arenaId))
        .set(...authHeader('token-admin'))
        .send({ intervals: [{ dayOfWeek: 'SUNDAY', opensAt: '10:00', closesAt: '16:00' }] })
        .expect(200);
    });

    it('substituição é completa: PUT com uma lista menor remove o que não foi reenviado', async () => {
      await request(app.getHttpServer())
        .put(url(arenaId))
        .set(...authHeader('token-owner'))
        .send({ intervals: [{ dayOfWeek: 'TUESDAY', opensAt: '08:00', closesAt: '10:00' }] })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(url(arenaId))
        .set(...authHeader('token-owner'))
        .expect(200);

      const intervals = response.body as IntervalBody[];
      expect(intervals).toHaveLength(1);
      expect(intervals[0]?.dayOfWeek).toBe('TUESDAY');
    });

    it('lista vazia fecha a arena todo dia (substituição completa também vale para remover tudo)', async () => {
      await request(app.getHttpServer())
        .put(url(arenaId))
        .set(...authHeader('token-owner'))
        .send({ intervals: [] })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(url(arenaId))
        .set(...authHeader('token-owner'))
        .expect(200);
      expect(response.body).toEqual([]);
    });

    it('404 para arena inexistente', async () => {
      await request(app.getHttpServer())
        .put(url('arena-que-nao-existe'))
        .set(...authHeader('token-owner'))
        .send({ intervals: [] })
        .expect(404);
    });
  });
});
