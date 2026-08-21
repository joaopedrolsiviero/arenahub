import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ArenaRole, PrismaClient, Sport } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

// Três usuários simulados (mesma técnica de auth-flow.e2e-spec.ts —
// ClerkService sobrescrito, resto roda de verdade contra o Postgres):
// - User A: cria a Arena A, vira OWNER.
// - User B: não tem nenhum vínculo com a Arena A — usado nos testes de
//   segurança obrigatórios (seção 25 do prompt da Fase 3).
// - User C: promovido a ADMIN da Arena A diretamente via Prisma (não existe
//   endpoint de convite de membro nesta fase) — cobre "atualização por
//   ADMIN" end-to-end, não só na unidade.
const USER_A = { clerkId: 'user_e2e_arenas_a', email: 'arenas-e2e-a@example.com' };
const USER_B = { clerkId: 'user_e2e_arenas_b', email: 'arenas-e2e-b@example.com' };
const USER_C = { clerkId: 'user_e2e_arenas_c', email: 'arenas-e2e-c@example.com' };

const TOKENS: Record<string, string> = {
  'token-a': USER_A.clerkId,
  'token-b': USER_B.clerkId,
  'token-c': USER_C.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

interface ArenaBody {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role?: ArenaRole;
  members?: { id: string; role: ArenaRole }[];
  courts?: CourtBody[];
}

interface CourtBody {
  id: string;
  name: string;
  sport: Sport;
  isActive: boolean;
}

function asArenaBody(response: request.Response): ArenaBody {
  return response.body as ArenaBody;
}

function asArenaList(response: request.Response): ArenaBody[] {
  return response.body as ArenaBody[];
}

function asCourtBody(response: request.Response): CourtBody {
  return response.body as CourtBody;
}

function asCourtList(response: request.Response): CourtBody[] {
  return response.body as CourtBody[];
}

describe('Arenas & Courts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let userAId: string;
  let userCId: string;
  const createdArenaIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const userA = await prisma.user.create({ data: USER_A });
    await prisma.user.create({ data: USER_B });
    const userC = await prisma.user.create({ data: USER_C });
    userAId = userA.id;
    userCId = userC.id;

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
    // Cascade cuida de ArenaMember e Court.
    await prisma.arena.deleteMany({ where: { id: { in: createdArenaIds } } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /v1/arenas', () => {
    it('cria a arena e o usuário autenticado vira OWNER', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/arenas')
        .set(...authHeader('token-a'))
        .send({
          name: 'Arena Central',
          slug: 'arena-central-e2e',
          email: 'contato@arenacentral.com',
          timezone: 'America/Sao_Paulo',
        })
        .expect(201);

      const arena = asArenaBody(response);
      expect(arena).toMatchObject({
        name: 'Arena Central',
        slug: 'arena-central-e2e',
        role: 'OWNER',
      });
      createdArenaIds.push(arena.id);

      const membership = await prisma.arenaMember.findUnique({
        where: { arenaId_userId: { arenaId: arena.id, userId: userAId } },
      });
      expect(membership?.role).toBe(ArenaRole.OWNER);
    });

    it('rejeita nome vazio (400)', async () => {
      await request(app.getHttpServer())
        .post('/v1/arenas')
        .set(...authHeader('token-a'))
        .send({ name: '', slug: 'slug-valido', timezone: 'America/Sao_Paulo' })
        .expect(400);
    });

    it('rejeita slug em formato inválido (400)', async () => {
      await request(app.getHttpServer())
        .post('/v1/arenas')
        .set(...authHeader('token-a'))
        .send({ name: 'Arena X', slug: 'Slug Inválido!!', timezone: 'America/Sao_Paulo' })
        .expect(400);
    });

    it('rejeita timezone que não é um identificador IANA válido (400)', async () => {
      await request(app.getHttpServer())
        .post('/v1/arenas')
        .set(...authHeader('token-a'))
        .send({ name: 'Arena X', slug: 'arena-x-tz-invalida', timezone: 'GMT-3' })
        .expect(400);
    });

    it('rejeita slug duplicado (409)', async () => {
      await request(app.getHttpServer())
        .post('/v1/arenas')
        .set(...authHeader('token-a'))
        .send({ name: 'Outra Arena', slug: 'arena-central-e2e', timezone: 'America/Sao_Paulo' })
        .expect(409);
    });

    it('promove User C a ADMIN da Arena A diretamente (sem endpoint de convite nesta fase)', async () => {
      const arenaId = createdArenaIds[0];
      if (!arenaId) {
        throw new Error('Arena A não foi criada no teste anterior.');
      }
      await prisma.arenaMember.create({
        data: { arenaId, userId: userCId, role: ArenaRole.ADMIN },
      });
    });
  });

  describe('GET /v1/arenas', () => {
    it('retorna só as arenas do usuário autenticado', async () => {
      const responseA = await request(app.getHttpServer())
        .get('/v1/arenas')
        .set(...authHeader('token-a'))
        .expect(200);
      expect(asArenaList(responseA).some((arena) => arena.id === createdArenaIds[0])).toBe(true);

      const responseB = await request(app.getHttpServer())
        .get('/v1/arenas')
        .set(...authHeader('token-b'))
        .expect(200);
      expect(asArenaList(responseB)).toEqual([]);
    });
  });

  describe('GET /v1/arenas/:arenaId', () => {
    it('retorna arena com membros e quadras para quem tem acesso', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${createdArenaIds[0]}`)
        .set(...authHeader('token-a'))
        .expect(200);

      const arena = asArenaBody(response);
      expect(arena).toMatchObject({ name: 'Arena Central' });
      expect(arena.members).toHaveLength(2); // OWNER (A) + ADMIN (C)
      expect(arena.courts).toEqual([]);
    });

    it('retorna 404 para arena inexistente', async () => {
      await request(app.getHttpServer())
        .get('/v1/arenas/arena-que-nao-existe')
        .set(...authHeader('token-a'))
        .expect(404);
    });
  });

  describe('PATCH /v1/arenas/:arenaId', () => {
    it('OWNER consegue atualizar', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/v1/arenas/${createdArenaIds[0]}`)
        .set(...authHeader('token-a'))
        .send({ description: 'Atualizado pelo OWNER' })
        .expect(200);

      expect(asArenaBody(response).description).toBe('Atualizado pelo OWNER');
    });

    it('ADMIN consegue atualizar', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/v1/arenas/${createdArenaIds[0]}`)
        .set(...authHeader('token-c'))
        .send({ description: 'Atualizado pelo ADMIN' })
        .expect(200);

      expect(asArenaBody(response).description).toBe('Atualizado pelo ADMIN');
    });
  });

  describe('POST /v1/arenas/:arenaId/courts', () => {
    it('cria quadra na arena', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/arenas/${createdArenaIds[0]}/courts`)
        .set(...authHeader('token-a'))
        .send({ name: 'Quadra 1', sport: Sport.BEACH_VOLLEYBALL })
        .expect(201);

      expect(asCourtBody(response)).toMatchObject({
        name: 'Quadra 1',
        sport: Sport.BEACH_VOLLEYBALL,
        isActive: true,
      });
    });

    it('rejeita modalidade inválida (400)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${createdArenaIds[0]}/courts`)
        .set(...authHeader('token-a'))
        .send({ name: 'Quadra Z', sport: 'FUTSAL' })
        .expect(400);
    });

    it('rejeita nome de quadra duplicado na mesma arena (409)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${createdArenaIds[0]}/courts`)
        .set(...authHeader('token-a'))
        .send({ name: 'Quadra 1', sport: Sport.BEACH_VOLLEYBALL })
        .expect(409);
    });

    it('permite o mesmo nome de quadra em arenas diferentes', async () => {
      const otherArenaResponse = await request(app.getHttpServer())
        .post('/v1/arenas')
        .set(...authHeader('token-b'))
        .send({
          name: 'Arena de outro dono',
          slug: 'arena-outro-dono-e2e',
          timezone: 'America/Sao_Paulo',
        })
        .expect(201);
      const otherArena = asArenaBody(otherArenaResponse);
      createdArenaIds.push(otherArena.id);

      await request(app.getHttpServer())
        .post(`/v1/arenas/${otherArena.id}/courts`)
        .set(...authHeader('token-b'))
        .send({ name: 'Quadra 1', sport: Sport.BEACH_VOLLEYBALL })
        .expect(201);
    });
  });

  describe('GET /v1/arenas/:arenaId/courts', () => {
    it('lista só quadras ativas por padrão, e todas com includeInactive=true', async () => {
      const createdResponse = await request(app.getHttpServer())
        .post(`/v1/arenas/${createdArenaIds[0]}/courts`)
        .set(...authHeader('token-a'))
        .send({ name: 'Quadra 2', sport: Sport.BEACH_VOLLEYBALL })
        .expect(201);
      const created = asCourtBody(createdResponse);

      await request(app.getHttpServer())
        .patch(`/v1/arenas/${createdArenaIds[0]}/courts/${created.id}`)
        .set(...authHeader('token-a'))
        .send({ isActive: false })
        .expect(200);

      const activeOnly = await request(app.getHttpServer())
        .get(`/v1/arenas/${createdArenaIds[0]}/courts`)
        .set(...authHeader('token-a'))
        .expect(200);
      expect(asCourtList(activeOnly).some((c) => c.id === created.id)).toBe(false);

      const withInactive = await request(app.getHttpServer())
        .get(`/v1/arenas/${createdArenaIds[0]}/courts?includeInactive=true`)
        .set(...authHeader('token-a'))
        .expect(200);
      expect(asCourtList(withInactive).some((c) => c.id === created.id)).toBe(true);
    });
  });

  describe('GET /v1/arenas/:arenaId/courts/:courtId', () => {
    it('retorna 200 quando a quadra pertence à arena', async () => {
      const list = await request(app.getHttpServer())
        .get(`/v1/arenas/${createdArenaIds[0]}/courts`)
        .set(...authHeader('token-a'))
        .expect(200);
      const [firstCourt] = asCourtList(list);
      if (!firstCourt) {
        throw new Error('Nenhuma quadra encontrada na Arena A.');
      }

      await request(app.getHttpServer())
        .get(`/v1/arenas/${createdArenaIds[0]}/courts/${firstCourt.id}`)
        .set(...authHeader('token-a'))
        .expect(200);
    });

    it('retorna 404 ao tentar acessar quadra de outra arena trocando só o courtId', async () => {
      const arenaBCourts = await request(app.getHttpServer())
        .get(`/v1/arenas/${createdArenaIds[1]}/courts`)
        .set(...authHeader('token-b'))
        .expect(200);
      const [courtOfArenaB] = asCourtList(arenaBCourts);
      if (!courtOfArenaB) {
        throw new Error('Nenhuma quadra encontrada na Arena B.');
      }

      await request(app.getHttpServer())
        .get(`/v1/arenas/${createdArenaIds[0]}/courts/${courtOfArenaB.id}`)
        .set(...authHeader('token-a'))
        .expect(404);
    });
  });

  describe('Segurança — isolamento entre arenas', () => {
    it('usuário sem acesso não consegue ver a arena de outro dono (403)', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${createdArenaIds[0]}`)
        .set(...authHeader('token-b'))
        .expect(403);
    });

    it('usuário sem acesso não consegue atualizar a arena de outro dono (403)', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/arenas/${createdArenaIds[0]}`)
        .set(...authHeader('token-b'))
        .send({ description: 'tentativa indevida' })
        .expect(403);
    });

    it('usuário sem acesso não consegue criar quadra na arena de outro dono (403)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${createdArenaIds[0]}/courts`)
        .set(...authHeader('token-b'))
        .send({ name: 'Quadra Invasora', sport: Sport.BEACH_VOLLEYBALL })
        .expect(403);
    });

    it('requisição sem token é rejeitada (401), não vaza dados', async () => {
      await request(app.getHttpServer()).get(`/v1/arenas/${createdArenaIds[0]}`).expect(401);
    });
  });
});
