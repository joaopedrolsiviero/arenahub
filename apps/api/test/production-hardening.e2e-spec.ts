import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ArenaRole, PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';
import { InvitationEmailService } from '../src/modules/invitations/email/invitation-email.service';

// Fase 18 — hardening de produção que não se encaixa em nenhum spec de
// domínio existente: rate limiting (item 4), headers de segurança HTTP
// (item 5), e X-Request-Id (item 9). Reaproveita a mesma convenção de setup
// de app/ClerkService da Fase 8 (hardening.e2e-spec.ts) — nenhum mecanismo
// de teste novo.
const OWNER = { clerkId: 'user_e2e_prod_owner', email: 'prod-hard-owner@example.com' };
const TOKENS: Record<string, string> = { 'token-owner': OWNER.clerkId };

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

describe('Production hardening — Fase 18 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaId: string;
  let invitationId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const owner = await prisma.user.create({ data: OWNER });
    const arena = await prisma.arena.create({
      data: {
        name: 'Prod Hardening Arena',
        slug: 'prod-hard-arena',
        timezone: 'America/Sao_Paulo',
      },
    });
    arenaId = arena.id;
    await prisma.arenaMember.create({
      data: { arenaId, userId: owner.id, role: ArenaRole.OWNER },
    });

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
      .useValue({ sendInvitation: jest.fn().mockResolvedValue(undefined) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const created = await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaId}/invitations`)
      .set(...authHeader('token-owner'))
      .send({ email: 'convidado-rate-limit@example.com' });
    invitationId = (created.body as { id: string }).id;
  });

  afterAll(async () => {
    await prisma.arenaInvitation.deleteMany({ where: { arenaId } });
    await prisma.arena.deleteMany({ where: { id: arenaId } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('Headers de segurança HTTP (item 5)', () => {
    it('respostas incluem os headers do helmet (nosniff, frame protection)', async () => {
      const response = await request(app.getHttpServer()).get('/v1/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
    });

    it('nunca vaza o header X-Powered-By do Express', async () => {
      const response = await request(app.getHttpServer()).get('/v1/health');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('X-Request-Id (item 9)', () => {
    it('gera um X-Request-Id quando o cliente não envia nenhum', async () => {
      const response = await request(app.getHttpServer()).get('/v1/health');
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('ecoa de volta um X-Request-Id externo válido', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/health')
        .set('X-Request-Id', 'meu-id-de-correlacao-123');
      expect(response.headers['x-request-id']).toBe('meu-id-de-correlacao-123');
    });

    it('nunca ecoa um X-Request-Id externo malformado — gera um novo', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/health')
        .set('X-Request-Id', 'contém espaço e é grande demais para ser confiável '.repeat(5));
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('Rate limiting (item 4) — endpoint dedicado de resend de convite (10/min)', () => {
    it('bloqueia com 429 após exceder o limite dedicado, sem derrubar o endpoint padrão', async () => {
      const attempts = await Promise.all(
        Array.from({ length: 12 }, () =>
          request(app.getHttpServer())
            .post(`/v1/arenas/${arenaId}/invitations/${invitationId}/resend`)
            .set(...authHeader('token-owner')),
        ),
      );

      const statuses = attempts.map((response) => response.status);
      expect(statuses.filter((status) => status === 201).length).toBeLessThanOrEqual(10);
      expect(statuses).toContain(429);
    });
  });

  describe('Health check nunca é limitado por rate limiting (item 4/10)', () => {
    it('/v1/health tolera muito mais chamadas que qualquer limite de negócio sem 429', async () => {
      const attempts = await Promise.all(
        Array.from({ length: 40 }, () => request(app.getHttpServer()).get('/v1/health')),
      );
      expect(attempts.every((response) => response.status === 200)).toBe(true);
    });
  });
});
