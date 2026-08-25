import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';
import { InvitationEmailService } from '../src/modules/invitations/email/invitation-email.service';

// Fase 11 — fluxo completo de convites. O token puro nunca aparece em
// nenhuma resposta de API (por design, ver item 37/73) — o único jeito de
// um teste obter o token pra exercitar o aceite é interceptar a "entrega"
// (aqui, `InvitationEmailService.sendInvitation`), exatamente como um
// provedor de e-mail real faria. Isso também prova, de quebra, que o
// domínio nunca vaza o token por nenhuma rota administrativa.
const OWNER_A = { clerkId: 'user_e2e_inv_owner_a', email: 'inv-owner-a@example.com' };
const ADMIN_A = { clerkId: 'user_e2e_inv_admin_a', email: 'inv-admin-a@example.com' };
const INVITEE = { clerkId: 'user_e2e_inv_invitee', email: 'inv-convidado@example.com' };
const OUTSIDER = { clerkId: 'user_e2e_inv_outsider', email: 'inv-outra-pessoa@example.com' };
const OWNER_B = { clerkId: 'user_e2e_inv_owner_b', email: 'inv-owner-b@example.com' };
const RACE_INVITEE = { clerkId: 'user_e2e_inv_race', email: 'race-invitee@example.com' };

const TOKENS: Record<string, string> = {
  'token-owner-a': OWNER_A.clerkId,
  'token-admin-a': ADMIN_A.clerkId,
  'token-invitee': INVITEE.clerkId,
  'token-outsider': OUTSIDER.clerkId,
  'token-owner-b': OWNER_B.clerkId,
  'token-race': RACE_INVITEE.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

function extractInviteToken(acceptUrl: string): string {
  const parts = acceptUrl.split('/convites/');
  const token = parts[1];
  if (!token) throw new Error(`acceptUrl sem token: ${acceptUrl}`);
  return token;
}

interface InvitationBody {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedBy: { id: string; email: string } | null;
}

function asInvitation(response: request.Response): InvitationBody {
  return response.body as InvitationBody;
}

function asInvitationList(response: request.Response): InvitationBody[] {
  return response.body as InvitationBody[];
}

describe('Convites de equipe (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaAId: string;
  let arenaBId: string;
  let sendInvitation: jest.Mock<
    Promise<void>,
    [
      {
        to: string;
        arenaName: string;
        invitedByName: string | null;
        acceptUrl: string;
        expiresAt: Date;
      },
    ]
  >;
  // Token do convite do INVITEE, capturado assim que criado (teste 1) e
  // reaproveitado pelos testes dependentes (consulta pública, aceite,
  // reuso) — nunca lido de `sendInvitation.mock.calls` fora do teste que
  // acabou de disparar a chamada, porque `mockClear()`/testes intermediários
  // tornariam esse histórico não confiável entre `it()` blocks.
  let inviteeToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    await prisma.user.create({ data: OWNER_A });
    await prisma.user.create({ data: ADMIN_A });
    await prisma.user.create({ data: INVITEE });
    await prisma.user.create({ data: OUTSIDER });
    await prisma.user.create({ data: OWNER_B });
    await prisma.user.create({ data: RACE_INVITEE });

    sendInvitation = jest
      .fn<
        Promise<void>,
        [
          {
            to: string;
            arenaName: string;
            invitedByName: string | null;
            acceptUrl: string;
            expiresAt: Date;
          },
        ]
      >()
      .mockResolvedValue(undefined);

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
      .overrideProvider(InvitationEmailService)
      .useValue({ sendInvitation })
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
      .send({
        name: 'Arena Convites A',
        slug: 'arena-convites-a-e2e',
        timezone: 'America/Sao_Paulo',
      })
      .expect(201);
    arenaAId = (arenaA.body as { id: string }).id;

    const arenaB = await request(app.getHttpServer())
      .post('/v1/arenas')
      .set(...authHeader('token-owner-b'))
      .send({
        name: 'Arena Convites B',
        slug: 'arena-convites-b-e2e',
        timezone: 'America/Sao_Paulo',
      })
      .expect(201);
    arenaBId = (arenaB.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaAId}/members`)
      .set(...authHeader('token-owner-a'))
      .send({ email: ADMIN_A.email, role: 'ADMIN' })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.arena.deleteMany({ where: { id: { in: [arenaAId, arenaBId] } } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /v1/arenas/:arenaId/invitations', () => {
    it('1. OWNER cria convite', async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .send({ email: INVITEE.email, role: 'ADMIN' })
        .expect(201);

      expect(asInvitation(response)).toMatchObject({
        email: INVITEE.email,
        role: 'ADMIN',
        status: 'PENDING',
      });
      expect(sendInvitation).toHaveBeenCalledTimes(1);
      inviteeToken = extractInviteToken(sendInvitation.mock.calls[0]![0].acceptUrl);
    });

    it('2. ADMIN não consegue criar convite (403)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-admin-a'))
        .send({ email: 'outro@example.com', role: 'ADMIN' })
        .expect(403);
    });

    it('3. CUSTOMER (não-membro) não consegue criar convite (403)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-outsider'))
        .send({ email: 'outro2@example.com', role: 'ADMIN' })
        .expect(403);
    });

    it('convite duplicado (mesmo email, ainda pendente) é bloqueado', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .send({ email: INVITEE.email, role: 'ADMIN' })
        .expect(409);
    });

    it('convite para quem já é membro é bloqueado', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .send({ email: ADMIN_A.email, role: 'ADMIN' })
        .expect(409);
    });

    it('Mass assignment: rejeita role=OWNER (400)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .send({ email: 'tentativa-owner@example.com', role: 'OWNER' })
        .expect(400);
    });

    it('Mass assignment: rejeita campos extras (tokenHash, arenaId, invitedByUserId...) (400)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .send({
          email: 'tentativa-extra@example.com',
          role: 'ADMIN',
          tokenHash: 'forjado',
          arenaId: 'outra-arena',
          invitedByUserId: 'forjado',
          acceptedAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(400);
    });

    it('Cross-tenant: OWNER de outra arena não cria convite na Arena A (403)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-b'))
        .send({ email: 'crosstenant@example.com', role: 'ADMIN' })
        .expect(403);
    });
  });

  describe('GET /v1/arenas/:arenaId/invitations', () => {
    it('4. convite aparece na listagem, sem token/tokenHash', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .expect(200);

      const list = asInvitationList(response);
      const found = list.find((inv) => inv.email === INVITEE.email);
      expect(found).toBeDefined();
      expect(JSON.stringify(response.body)).not.toMatch(/tokenHash/i);
      expect(JSON.stringify(response.body)).not.toContain(inviteeToken);
    });

    it('ADMIN não consegue listar convites (403)', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-admin-a'))
        .expect(403);
    });

    it('Cross-tenant: OWNER de outra arena não lista convites da Arena A (403)', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-b'))
        .expect(403);
    });
  });

  describe('GET /v1/invitations/:token — consulta pública', () => {
    it('6. convite pode ser consultado pelo token, sem autenticação', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/invitations/${inviteeToken}`)
        .expect(200);
      expect(response.body).toMatchObject({
        arenaName: 'Arena Convites A',
        role: 'ADMIN',
        email: INVITEE.email,
        status: 'PENDING',
      });
      expect(JSON.stringify(response.body)).not.toMatch(/tokenHash/i);
    });

    it('token inexistente retorna 404 genérico', async () => {
      await request(app.getHttpServer())
        .get(
          '/v1/invitations/token-que-nunca-existiu-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        )
        .expect(404);
    });
  });

  describe('POST /v1/invitations/:token/accept', () => {
    it('11/12/13. e-mail incompatível não aceita; usuário correto aceita e membership é criado', async () => {
      await request(app.getHttpServer())
        .post(`/v1/invitations/${inviteeToken}/accept`)
        .set(...authHeader('token-outsider'))
        .expect(403);

      await request(app.getHttpServer())
        .post(`/v1/invitations/${inviteeToken}/accept`)
        .set(...authHeader('token-invitee'))
        .expect(204);

      const member = await prisma.arenaMember.findFirst({
        where: { arenaId: arenaAId, user: { email: INVITEE.email } },
      });
      expect(member?.role).toBe('ADMIN');

      const invitationRow = await prisma.arenaInvitation.findFirst({
        where: { arenaId: arenaAId, email: INVITEE.email },
      });
      expect(invitationRow?.acceptedAt).not.toBeNull();
    });

    it('14. segundo aceite (token reutilizado) falha com 409', async () => {
      await request(app.getHttpServer())
        .post(`/v1/invitations/${inviteeToken}/accept`)
        .set(...authHeader('token-invitee'))
        .expect(409);
    });

    it('8. convite revogado não pode ser aceito (409) — checado antes até da identidade', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .send({ email: 'sera-revogado@example.com', role: 'ADMIN' })
        .expect(201);
      const revokedInvitationId = asInvitation(createResponse).id;
      const revokedAcceptUrl =
        sendInvitation.mock.calls[sendInvitation.mock.calls.length - 1]![0].acceptUrl;
      const revokedToken = extractInviteToken(revokedAcceptUrl);

      await request(app.getHttpServer())
        .delete(`/v1/arenas/${arenaAId}/invitations/${revokedInvitationId}`)
        .set(...authHeader('token-owner-a'))
        .expect(204);

      // Qualquer identidade autenticada basta — revogação é checada antes da
      // comparação de e-mail, então nem precisamos do usuário certo aqui.
      await request(app.getHttpServer())
        .post(`/v1/invitations/${revokedToken}/accept`)
        .set(...authHeader('token-outsider'))
        .expect(409);

      const publicView = await request(app.getHttpServer())
        .get(`/v1/invitations/${revokedToken}`)
        .expect(200);
      expect(publicView.body).toMatchObject({ status: 'REVOKED' });
    });

    it('7. convite expirado não pode ser aceito (409)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .send({ email: 'expirado-teste@example.com', role: 'ADMIN' })
        .expect(201);
      const invitationId = asInvitation(createResponse).id;
      const acceptUrl =
        sendInvitation.mock.calls[sendInvitation.mock.calls.length - 1]![0].acceptUrl;
      const token = extractInviteToken(acceptUrl);

      // Não dá pra esperar 7 dias de verdade num teste — forçamos a
      // expiração direto no banco (sem tocar na lógica de geração/hash).
      await prisma.arenaInvitation.update({
        where: { id: invitationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(app.getHttpServer())
        .post(`/v1/invitations/${token}/accept`)
        .set(...authHeader('token-outsider'))
        .expect(409);

      const publicView = await request(app.getHttpServer())
        .get(`/v1/invitations/${token}`)
        .expect(200);
      expect(publicView.body).toMatchObject({ status: 'EXPIRED' });
    });
  });

  describe('DELETE /v1/arenas/:arenaId/invitations/:invitationId', () => {
    it('9. revogação não pode ser feita por ADMIN (403)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .send({ email: 'para-revogar-admin-teste@example.com', role: 'ADMIN' })
        .expect(201);
      const invitationId = asInvitation(createResponse).id;

      await request(app.getHttpServer())
        .delete(`/v1/arenas/${arenaAId}/invitations/${invitationId}`)
        .set(...authHeader('token-admin-a'))
        .expect(403);
    });

    it('convite já aceito não pode ser revogado (409)', async () => {
      const invitationRow = await prisma.arenaInvitation.findFirstOrThrow({
        where: { arenaId: arenaAId, email: INVITEE.email },
      });

      await request(app.getHttpServer())
        .delete(`/v1/arenas/${arenaAId}/invitations/${invitationRow.id}`)
        .set(...authHeader('token-owner-a'))
        .expect(409);
    });
  });

  describe('POST /v1/arenas/:arenaId/invitations/:invitationId/resend', () => {
    it('16/17. reenvio invalida o token anterior e o novo token funciona', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .send({ email: 'reenviado@example.com', role: 'ADMIN' })
        .expect(201);
      const invitationId = asInvitation(createResponse).id;
      const firstAcceptUrl =
        sendInvitation.mock.calls[sendInvitation.mock.calls.length - 1]![0].acceptUrl;
      const firstToken = extractInviteToken(firstAcceptUrl);

      sendInvitation.mockClear();
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations/${invitationId}/resend`)
        .set(...authHeader('token-owner-a'))
        .expect(201);
      const secondAcceptUrl = sendInvitation.mock.calls[0]![0].acceptUrl;
      const secondToken = extractInviteToken(secondAcceptUrl);

      expect(secondToken).not.toBe(firstToken);

      await prisma.user.create({
        data: { clerkId: 'user_e2e_inv_resend_target', email: 'reenviado@example.com' },
      });

      // Token antigo não existe mais (hash não bate com nenhum convite).
      await request(app.getHttpServer()).get(`/v1/invitations/${firstToken}`).expect(404);

      // Token novo funciona.
      const publicView = await request(app.getHttpServer())
        .get(`/v1/invitations/${secondToken}`)
        .expect(200);
      expect(publicView.body).toMatchObject({ status: 'PENDING' });

      await prisma.user.deleteMany({ where: { clerkId: 'user_e2e_inv_resend_target' } });
    });

    it('ADMIN não consegue reenviar (403)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .send({ email: 'resend-admin-forbidden@example.com', role: 'ADMIN' })
        .expect(201);
      const invitationId = asInvitation(createResponse).id;

      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations/${invitationId}/resend`)
        .set(...authHeader('token-admin-a'))
        .expect(403);
    });
  });

  describe('Concorrência real (item 33/88)', () => {
    it('duas aceitações simultâneas do mesmo token — exatamente uma sucede', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/invitations`)
        .set(...authHeader('token-owner-a'))
        .send({ email: RACE_INVITEE.email, role: 'ADMIN' })
        .expect(201);
      const acceptUrl =
        sendInvitation.mock.calls[sendInvitation.mock.calls.length - 1]![0].acceptUrl;
      const token = extractInviteToken(acceptUrl);

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post(`/v1/invitations/${token}/accept`)
          .set(...authHeader('token-race')),
        request(app.getHttpServer())
          .post(`/v1/invitations/${token}/accept`)
          .set(...authHeader('token-race')),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([204, 409]);

      const raceUser = await prisma.user.findUniqueOrThrow({
        where: { clerkId: RACE_INVITEE.clerkId },
      });
      const memberCount = await prisma.arenaMember.count({
        where: { arenaId: arenaAId, userId: raceUser.id },
      });
      expect(memberCount).toBe(1);

      const invitationId = asInvitation(createResponse).id;
      const invitationRow = await prisma.arenaInvitation.findUniqueOrThrow({
        where: { id: invitationId },
      });
      expect(invitationRow.acceptedAt).not.toBeNull();
    });
  });
});
