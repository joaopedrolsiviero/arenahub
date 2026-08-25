import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ArenaRole, PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

// Fase 10 — gestão de membros/equipe. Cenários (item 43 do prompt da fase):
// - OWNER_A: dono da Arena A.
// - ADMIN_A: promovido a ADMIN da Arena A através do próprio endpoint novo
//   (POST /members), não via Prisma direto — exercita o fluxo real.
// - CUSTOMER: autenticado, mas nunca é ArenaMember de nenhuma arena.
// - OWNER_B: dono da Arena B — usado nos testes de isolamento cross-tenant.
// - existing1/existing2/existing3: usuários "existentes" no banco, alvos de
//   diferentes operações de adicionar/remover sem reaproveitar estado entre
//   testes.
const OWNER_A = { clerkId: 'user_e2e_members_owner_a', email: 'members-owner-a@example.com' };
const ADMIN_A = { clerkId: 'user_e2e_members_admin_a', email: 'members-admin-a@example.com' };
const CUSTOMER = { clerkId: 'user_e2e_members_customer', email: 'members-customer@example.com' };
const OWNER_B = { clerkId: 'user_e2e_members_owner_b', email: 'members-owner-b@example.com' };
const EXISTING_1 = {
  clerkId: 'user_e2e_members_existing_1',
  email: 'members-existing-1@example.com',
};
const EXISTING_2 = {
  clerkId: 'user_e2e_members_existing_2',
  email: 'members-existing-2@example.com',
};
const EXISTING_3 = {
  clerkId: 'user_e2e_members_existing_3',
  email: 'members-existing-3@example.com',
};

const TOKENS: Record<string, string> = {
  'token-owner-a': OWNER_A.clerkId,
  'token-admin-a': ADMIN_A.clerkId,
  'token-customer': CUSTOMER.clerkId,
  'token-owner-b': OWNER_B.clerkId,
  'token-existing-1': EXISTING_1.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

interface MemberBody {
  id: string;
  userId: string;
  role: ArenaRole;
  user: { id: string; email: string; name: string | null };
}

function asMember(response: request.Response): MemberBody {
  return response.body as MemberBody;
}

function asMemberList(response: request.Response): MemberBody[] {
  return response.body as MemberBody[];
}

describe('Gestão de membros/equipe (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaAId: string;
  let arenaBId: string;
  let ownerAId: string;
  let existing1Id: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const allClerkIds = [...Object.values(TOKENS), EXISTING_2.clerkId, EXISTING_3.clerkId];
    await prisma.user.deleteMany({ where: { clerkId: { in: allClerkIds } } });

    const ownerA = await prisma.user.create({ data: OWNER_A });
    await prisma.user.create({ data: ADMIN_A });
    await prisma.user.create({ data: CUSTOMER });
    await prisma.user.create({ data: OWNER_B });
    const existing1 = await prisma.user.create({ data: EXISTING_1 });
    await prisma.user.create({ data: EXISTING_2 });
    await prisma.user.create({ data: EXISTING_3 });
    ownerAId = ownerA.id;
    existing1Id = existing1.id;

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

    const arenaA = await request(app.getHttpServer())
      .post('/v1/arenas')
      .set(...authHeader('token-owner-a'))
      .send({ name: 'Arena Membros A', slug: 'arena-membros-a-e2e', timezone: 'America/Sao_Paulo' })
      .expect(201);
    arenaAId = (arenaA.body as { id: string }).id;

    const arenaB = await request(app.getHttpServer())
      .post('/v1/arenas')
      .set(...authHeader('token-owner-b'))
      .send({ name: 'Arena Membros B', slug: 'arena-membros-b-e2e', timezone: 'America/Sao_Paulo' })
      .expect(201);
    arenaBId = (arenaB.body as { id: string }).id;

    // ADMIN_A entra na Arena A pelo próprio endpoint sendo testado — não por
    // Prisma direto — pra exercitar o fluxo real desde o início da suíte.
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/members`)
      .set(...authHeader('token-owner-a'))
      .send({ email: ADMIN_A.email, role: 'ADMIN' })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.arena.deleteMany({ where: { id: { in: [arenaAId, arenaBId] } } });
    await prisma.user.deleteMany({
      where: {
        clerkId: { in: [...Object.values(TOKENS), EXISTING_2.clerkId, EXISTING_3.clerkId] },
      },
    });
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /v1/arenas/:arenaId/members', () => {
    it('1. OWNER lista membros', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-a'))
        .expect(200);

      const members = asMemberList(response);
      expect(members).toHaveLength(2);
      expect(members.find((m) => m.role === 'OWNER')?.user.email).toBe(OWNER_A.email);
      expect(members.find((m) => m.role === 'ADMIN')?.user.email).toBe(ADMIN_A.email);
    });

    it('2. ADMIN lista membros', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-admin-a'))
        .expect(200);

      expect(asMemberList(response)).toHaveLength(2);
    });

    it('3. CUSTOMER autenticado, mas não-membro, não acessa membros (403)', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-customer'))
        .expect(403);
    });

    it('13a. Cross-tenant: OWNER de outra arena não lista membros da Arena A (403)', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-b'))
        .expect(403);
    });

    it('14. Arena inexistente retorna 404 (não 403)', async () => {
      await request(app.getHttpServer())
        .get('/v1/arenas/arena-que-nao-existe/members')
        .set(...authHeader('token-owner-a'))
        .expect(404);
    });

    it('requisição sem token é rejeitada (401)', async () => {
      await request(app.getHttpServer()).get(`/v1/arenas/${arenaAId}/members`).expect(401);
    });
  });

  describe('POST /v1/arenas/:arenaId/members', () => {
    it('4. OWNER adiciona um usuário existente como ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-a'))
        .send({ email: EXISTING_1.email, role: 'ADMIN' })
        .expect(201);

      const member = asMember(response);
      expect(member).toMatchObject({ role: 'ADMIN', user: { email: EXISTING_1.email } });
      expect(member.userId).toBe(existing1Id);
    });

    it('5. ADMIN não consegue adicionar membro (403)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-admin-a'))
        .send({ email: EXISTING_2.email, role: 'ADMIN' })
        .expect(403);
    });

    it('11. Usuário já membro não pode ser adicionado de novo (409, sem duplicar)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-a'))
        .send({ email: EXISTING_1.email, role: 'ADMIN' })
        .expect(409);

      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-a'))
        .expect(200);
      expect(asMemberList(response).filter((m) => m.userId === existing1Id)).toHaveLength(1);
    });

    it('12. Usuário inexistente é rejeitado (404, mensagem amigável)', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-a'))
        .send({ email: 'ninguem-com-esse-email@example.com', role: 'ADMIN' })
        .expect(404);

      expect((response.body as { message: string }).message).toMatch(/não foi possível encontrar/i);
    });

    it('Mass assignment: rejeita role=OWNER através do endpoint comum (400)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-a'))
        .send({ email: EXISTING_2.email, role: 'OWNER' })
        .expect(400);
    });

    it('Mass assignment: rejeita campos extras não whitelistados (400)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-a'))
        .send({
          email: EXISTING_2.email,
          role: 'ADMIN',
          userId: 'tentativa-de-forjar-id',
          arenaId: 'tentativa-de-trocar-arena',
          id: 'tentativa-de-forjar-id-do-membro',
          createdAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(400);
    });

    it('13b. Cross-tenant: OWNER de outra arena não adiciona membro na Arena A (403)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-b'))
        .send({ email: EXISTING_2.email, role: 'ADMIN' })
        .expect(403);
    });
  });

  describe('PATCH /v1/arenas/:arenaId/members/:userId', () => {
    it('6. OWNER altera (mantém) o papel de um ADMIN', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/v1/arenas/${arenaAId}/members/${existing1Id}`)
        .set(...authHeader('token-owner-a'))
        .send({ role: 'ADMIN' })
        .expect(200);

      expect(asMember(response)).toMatchObject({ role: 'ADMIN', userId: existing1Id });
    });

    it('7. ADMIN não consegue alterar role de ninguém (403)', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/arenas/${arenaAId}/members/${existing1Id}`)
        .set(...authHeader('token-admin-a'))
        .send({ role: 'ADMIN' })
        .expect(403);
    });

    it('Nunca permite promover a OWNER através deste endpoint (400)', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/arenas/${arenaAId}/members/${existing1Id}`)
        .set(...authHeader('token-owner-a'))
        .send({ role: 'OWNER' })
        .expect(400);
    });

    it('Nunca permite alterar o papel do próprio OWNER (403)', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/arenas/${arenaAId}/members/${ownerAId}`)
        .set(...authHeader('token-owner-a'))
        .send({ role: 'ADMIN' })
        .expect(403);
    });

    it('Membro inexistente na arena retorna 404', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/arenas/${arenaAId}/members/id-de-usuario-que-nao-existe`)
        .set(...authHeader('token-owner-a'))
        .send({ role: 'ADMIN' })
        .expect(404);
    });

    it('13c. Cross-tenant: OWNER de outra arena não altera membro da Arena A (403)', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/arenas/${arenaAId}/members/${existing1Id}`)
        .set(...authHeader('token-owner-b'))
        .send({ role: 'ADMIN' })
        .expect(403);
    });
  });

  describe('DELETE /v1/arenas/:arenaId/members/:userId', () => {
    it('9. ADMIN não consegue remover outro membro (403)', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/arenas/${arenaAId}/members/${existing1Id}`)
        .set(...authHeader('token-admin-a'))
        .expect(403);
    });

    it('10. OWNER nunca pode remover o OWNER (nem a si mesmo) (403)', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/arenas/${arenaAId}/members/${ownerAId}`)
        .set(...authHeader('token-owner-a'))
        .expect(403);
    });

    it('ADMIN pode remover a si mesmo (self-removal)', async () => {
      // EXISTING_1 já é ADMIN da Arena A (adicionado no teste 4); usa o
      // próprio token dele pra sair da equipe.
      await request(app.getHttpServer())
        .delete(`/v1/arenas/${arenaAId}/members/${existing1Id}`)
        .set(...authHeader('token-existing-1'))
        .expect(204);

      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-a'))
        .expect(200);
      expect(asMemberList(response).some((m) => m.userId === existing1Id)).toBe(false);
    });

    it('8. OWNER remove um ADMIN', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/arenas/${arenaAId}/members/${await getAdminAId()}`)
        .set(...authHeader('token-owner-a'))
        .expect(204);

      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-a'))
        .expect(200);
      expect(asMemberList(response)).toHaveLength(1);
      expect(asMemberList(response)[0]?.role).toBe('OWNER');
    });

    it('Membro inexistente na arena retorna 404', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/arenas/${arenaAId}/members/id-de-usuario-que-nao-existe`)
        .set(...authHeader('token-owner-a'))
        .expect(404);
    });

    it('13d. Cross-tenant: OWNER de outra arena não remove membro da Arena A (403)', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/arenas/${arenaAId}/members/${ownerAId}`)
        .set(...authHeader('token-owner-b'))
        .expect(403);
    });

    async function getAdminAId(): Promise<string> {
      const admin = await prisma.user.findUniqueOrThrow({ where: { clerkId: ADMIN_A.clerkId } });
      return admin.id;
    }
  });

  describe('15. IDOR não vaza dados entre arenas', () => {
    it('membros da Arena B nunca aparecem na resposta de members da Arena A', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaBId}/members`)
        .set(...authHeader('token-owner-b'))
        .send({ email: EXISTING_3.email, role: 'ADMIN' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/members`)
        .set(...authHeader('token-owner-a'))
        .expect(200);

      expect(asMemberList(response).some((m) => m.user.email === EXISTING_3.email)).toBe(false);
      expect(asMemberList(response).some((m) => m.user.email === OWNER_B.email)).toBe(false);
    });
  });
});
