import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';
import { signClerkWebhookPayload } from './utils/clerk-webhook';
import { buildUserCreatedPayload, buildUserDeletedPayload } from './utils/clerk-fixtures';

// Cobre o fluxo principal da Fase 2, adaptado ao Clerk (ver relatório da
// fase): como não há register/login/logout na nossa própria API — o Clerk
// cuida disso no frontend — o equivalente testável ponta a ponta é:
//
//   webhook user.created (equivalente a "conta criada")
//     -> GET /v1/users/me (equivalente a "login" + "me")
//     -> webhook user.deleted (equivalente a "acesso revogado")
//     -> GET /v1/users/me volta a falhar (equivalente a "tentativa de acesso após logout")
//
// A verificação de assinatura Svix roda de verdade (criptografia simétrica
// offline, sem precisar de conta Clerk real). A única coisa simulada é a
// verificação da sessão JWT do Clerk em si (ClerkService), porque isso
// exigiria uma conta Clerk real e uma requisição de rede à API do Clerk —
// ver docs/ARCHITECTURE.md / relatório da Fase 2 para a justificativa.
const TEST_CLERK_ID = 'user_e2e_test_fixture';
const TEST_EMAIL = 'e2e-fixture@example.com';
const VALID_TEST_SESSION_TOKEN = 'valid-test-session-token';

describe('Auth flow (e2e) — webhook sync + /v1/users/me', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let webhookSecret: string;

  beforeAll(async () => {
    webhookSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET ?? '';
    if (!webhookSecret) {
      throw new Error('CLERK_WEBHOOK_SIGNING_SECRET não configurado para os testes e2e.');
    }

    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: TEST_CLERK_ID } });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkService)
      .useValue({
        verifySessionToken: (token: string) => {
          if (token === VALID_TEST_SESSION_TOKEN) {
            return Promise.resolve({ sub: TEST_CLERK_ID });
          }
          return Promise.reject(new Error('invalid test token'));
        },
      })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('v1');
    await app.init();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { clerkId: TEST_CLERK_ID } });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /v1/users/me sem token retorna 401', async () => {
    await request(app.getHttpServer()).get('/v1/users/me').expect(401);
  });

  it('GET /v1/users/me com token inválido retorna 401', async () => {
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', 'Bearer garbage-token')
      .expect(401);
  });

  it('GET /v1/users/me com sessão válida, mas usuário ainda não sincronizado, retorna 404', async () => {
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${VALID_TEST_SESSION_TOKEN}`)
      .expect(404);
  });

  it('POST /v1/webhooks/clerk rejeita assinatura inválida (400) e não cria usuário', async () => {
    const payload = buildUserCreatedPayload({ clerkId: TEST_CLERK_ID, email: TEST_EMAIL });

    await request(app.getHttpServer())
      .post('/v1/webhooks/clerk')
      .set('svix-id', 'msg_bad_signature_test')
      .set('svix-timestamp', Math.floor(Date.now() / 1000).toString())
      .set('svix-signature', 'v1,thisSignatureIsNotValid==')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload))
      .expect(400);

    const user = await prisma.user.findUnique({ where: { clerkId: TEST_CLERK_ID } });
    expect(user).toBeNull();
  });

  it('POST /v1/webhooks/clerk com assinatura válida (user.created) sincroniza o User no Postgres', async () => {
    const payload = buildUserCreatedPayload({
      clerkId: TEST_CLERK_ID,
      email: TEST_EMAIL,
      firstName: 'Ana',
      lastName: 'Silva',
    });
    const { body, headers } = signClerkWebhookPayload(webhookSecret, payload);

    await request(app.getHttpServer())
      .post('/v1/webhooks/clerk')
      .set(headers)
      .send(body)
      .expect(200);

    const user = await prisma.user.findUnique({ where: { clerkId: TEST_CLERK_ID } });
    expect(user).toMatchObject({
      clerkId: TEST_CLERK_ID,
      email: TEST_EMAIL,
      name: 'Ana Silva',
    });
  });

  // Fase 8, item 8: o Clerk pode reentregar o mesmo evento (retry de rede,
  // at-least-once delivery) — reenviar o MESMO payload assinado não pode
  // criar um segundo User nem falhar. syncFromClerkEvent usa upsert, que é
  // naturalmente idempotente para isso.
  it('POST /v1/webhooks/clerk reenviado (mesmo evento, retry) não duplica nem falha', async () => {
    const payload = buildUserCreatedPayload({
      clerkId: TEST_CLERK_ID,
      email: TEST_EMAIL,
      firstName: 'Ana',
      lastName: 'Silva',
    });
    const { body, headers } = signClerkWebhookPayload(webhookSecret, payload);

    await request(app.getHttpServer())
      .post('/v1/webhooks/clerk')
      .set(headers)
      .send(body)
      .expect(200);
    // Reentrega idêntica — mesmo signed payload, mesmos headers Svix.
    await request(app.getHttpServer())
      .post('/v1/webhooks/clerk')
      .set(headers)
      .send(body)
      .expect(200);

    const users = await prisma.user.findMany({ where: { clerkId: TEST_CLERK_ID } });
    expect(users).toHaveLength(1);
  });

  it('GET /v1/users/me retorna os dados públicos do usuário já sincronizado, sem clerkId', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${VALID_TEST_SESSION_TOKEN}`)
      .expect(200);

    expect(response.body).toMatchObject({
      email: TEST_EMAIL,
      name: 'Ana Silva',
    });
    expect(response.body).not.toHaveProperty('clerkId');
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('POST /v1/webhooks/clerk (user.updated) atualiza um usuário já existente, sem criar outro', async () => {
    const created = buildUserCreatedPayload({
      clerkId: TEST_CLERK_ID,
      email: TEST_EMAIL,
      firstName: 'Ana',
      lastName: 'Atualizada',
    }) as { type: string };
    const payload = { ...created, type: 'user.updated' };
    const { body, headers } = signClerkWebhookPayload(webhookSecret, payload);

    await request(app.getHttpServer())
      .post('/v1/webhooks/clerk')
      .set(headers)
      .send(body)
      .expect(200);

    const users = await prisma.user.findMany({ where: { clerkId: TEST_CLERK_ID } });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ name: 'Ana Atualizada' });
  });

  it('POST /v1/webhooks/clerk (user.deleted) remove o User — acesso deixa de ser válido', async () => {
    const payload = buildUserDeletedPayload(TEST_CLERK_ID);
    const { body, headers } = signClerkWebhookPayload(webhookSecret, payload);

    await request(app.getHttpServer())
      .post('/v1/webhooks/clerk')
      .set(headers)
      .send(body)
      .expect(200);

    const user = await prisma.user.findUnique({ where: { clerkId: TEST_CLERK_ID } });
    expect(user).toBeNull();

    // Mesmo com uma sessão Clerk ainda "válida" (o Clerk não sabe que
    // sincronizamos a remoção), o usuário deixou de existir no nosso lado —
    // /v1/users/me não retorna mais os dados dele.
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${VALID_TEST_SESSION_TOKEN}`)
      .expect(404);
  });
});
