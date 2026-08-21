import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  ArenaRole,
  BookingStatus,
  BookingType,
  PrismaClient,
  Sport,
  Weekday,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

// Fase 7 (Dashboard): duas arenas, cada uma com seu próprio dono, para
// provar isolamento cross-tenant, mais um usuário sem nenhum vínculo
// administrativo (equivalente a um CUSTOMER comum) e um ADMIN promovido
// diretamente via Prisma (mesma técnica de arenas-courts.e2e-spec.ts — não
// existe endpoint de convite ainda).
const OWNER_A = { clerkId: 'user_e2e_dash_owner_a', email: 'dash-e2e-owner-a@example.com' };
const ADMIN_A = { clerkId: 'user_e2e_dash_admin_a', email: 'dash-e2e-admin-a@example.com' };
const OWNER_B = { clerkId: 'user_e2e_dash_owner_b', email: 'dash-e2e-owner-b@example.com' };
const CUSTOMER = { clerkId: 'user_e2e_dash_customer', email: 'dash-e2e-customer@example.com' };

const TOKENS: Record<string, string> = {
  'token-owner-a': OWNER_A.clerkId,
  'token-admin-a': ADMIN_A.clerkId,
  'token-owner-b': OWNER_B.clerkId,
  'token-customer': CUSTOMER.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

interface DashboardBody {
  arena: { id: string; name: string; timezone: string };
  date: string;
  operatingHours: { id: string; dayOfWeek: Weekday; opensAt: string; closesAt: string }[];
  summary: {
    confirmedBookings: number;
    cancelledBookings: number;
    blocks: number;
    maintenance: number;
  };
  courts: { id: string; name: string; isActive: boolean; occupancy: { id: string }[] }[];
  upcomingBookings: { id: string; type: BookingType; courtId: string }[];
}

describe('Dashboard operacional da Arena (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaAId: string;
  let arenaBId: string;
  let courtAActiveId: string;
  let courtAInactiveId: string;
  let courtBId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const ownerA = await prisma.user.create({ data: OWNER_A });
    const adminA = await prisma.user.create({ data: ADMIN_A });
    const ownerB = await prisma.user.create({ data: OWNER_B });
    await prisma.user.create({ data: CUSTOMER });

    const arenaA = await prisma.arena.create({
      data: { name: 'Arena A', slug: 'dash-arena-a', timezone: 'America/Sao_Paulo' },
    });
    arenaAId = arenaA.id;
    await prisma.arenaMember.create({
      data: { arenaId: arenaAId, userId: ownerA.id, role: ArenaRole.OWNER },
    });
    await prisma.arenaMember.create({
      data: { arenaId: arenaAId, userId: adminA.id, role: ArenaRole.ADMIN },
    });

    const arenaB = await prisma.arena.create({
      data: { name: 'Arena B', slug: 'dash-arena-b', timezone: 'America/Sao_Paulo' },
    });
    arenaBId = arenaB.id;
    await prisma.arenaMember.create({
      data: { arenaId: arenaBId, userId: ownerB.id, role: ArenaRole.OWNER },
    });

    // Arena A aberta só quinta-feira (2026-08-20) — usada para testar tanto
    // "aberta" quanto "fechada" (qualquer outro dia da semana) sem precisar
    // de uma segunda arena.
    await prisma.arenaOperatingHours.create({
      data: { arenaId: arenaAId, dayOfWeek: Weekday.THURSDAY, opensAt: 8 * 60, closesAt: 22 * 60 },
    });

    const courtAActive = await prisma.court.create({
      data: { arenaId: arenaAId, name: 'Quadra Ativa', sport: Sport.BEACH_VOLLEYBALL },
    });
    courtAActiveId = courtAActive.id;
    const courtAInactive = await prisma.court.create({
      data: {
        arenaId: arenaAId,
        name: 'Quadra Inativa',
        sport: Sport.BEACH_VOLLEYBALL,
        isActive: false,
      },
    });
    courtAInactiveId = courtAInactive.id;

    const courtB = await prisma.court.create({
      data: { arenaId: arenaBId, name: 'Quadra B', sport: Sport.BEACH_VOLLEYBALL },
    });
    courtBId = courtB.id;

    // 2026-08-20T13:00:00-03:00 = 10:00 local em São Paulo, dentro do
    // expediente configurado (08:00-22:00).
    await prisma.booking.create({
      data: {
        courtId: courtAActiveId,
        userId: ownerA.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-20T13:00:00-03:00'),
        endsAt: new Date('2026-08-20T14:00:00-03:00'),
        total: 100,
      },
    });
    await prisma.booking.create({
      data: {
        courtId: courtAActiveId,
        userId: ownerA.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CANCELLED,
        startsAt: new Date('2026-08-20T15:00:00-03:00'),
        endsAt: new Date('2026-08-20T16:00:00-03:00'),
        total: 100,
        cancelledAt: new Date(),
        cancelledByUserId: ownerA.id,
      },
    });
    await prisma.booking.create({
      data: {
        courtId: courtAInactiveId,
        userId: ownerA.id,
        type: BookingType.BLOCK,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-20T18:00:00-03:00'),
        endsAt: new Date('2026-08-20T19:00:00-03:00'),
        reason: 'Evento privado',
      },
    });
    // Fora da janela do dia consultado (dia seguinte) — nunca deve aparecer.
    await prisma.booking.create({
      data: {
        courtId: courtAActiveId,
        userId: ownerA.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-21T13:00:00-03:00'),
        endsAt: new Date('2026-08-21T14:00:00-03:00'),
        total: 100,
      },
    });
    // Arena B — nunca deve vazar para o dashboard da Arena A.
    await prisma.booking.create({
      data: {
        courtId: courtBId,
        userId: ownerB.id,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: new Date('2026-08-20T13:00:00-03:00'),
        endsAt: new Date('2026-08-20T14:00:00-03:00'),
        total: 50,
      },
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
    await prisma.booking.deleteMany({
      where: { courtId: { in: [courtAActiveId, courtAInactiveId, courtBId] } },
    });
    await prisma.arena.deleteMany({ where: { id: { in: [arenaAId, arenaBId] } } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  function get(arenaId: string, date: string) {
    return request(app.getHttpServer()).get(`/v1/arenas/${arenaId}/dashboard?date=${date}`);
  }

  describe('Segurança', () => {
    it('exige autenticação (401)', async () => {
      await get(arenaAId, '2026-08-20').expect(401);
    });

    it('OWNER da arena acessa o dashboard', async () => {
      await get(arenaAId, '2026-08-20')
        .set(...authHeader('token-owner-a'))
        .expect(200);
    });

    it('ADMIN da arena acessa o dashboard', async () => {
      await get(arenaAId, '2026-08-20')
        .set(...authHeader('token-admin-a'))
        .expect(200);
    });

    it('usuário sem vínculo (equivalente a CUSTOMER) recebe 403', async () => {
      await get(arenaAId, '2026-08-20')
        .set(...authHeader('token-customer'))
        .expect(403);
    });

    it('OWNER de outra arena não acessa via URL manual (403, cross-tenant)', async () => {
      await get(arenaAId, '2026-08-20')
        .set(...authHeader('token-owner-b'))
        .expect(403);
    });

    it('arena inexistente retorna 404', async () => {
      await get('arena-que-nao-existe', '2026-08-20')
        .set(...authHeader('token-owner-a'))
        .expect(404);
    });
  });

  describe('Conteúdo e isolamento de tenant', () => {
    it('resumo do dia reflete só CONFIRMED/CANCELLED da própria arena, no dia certo', async () => {
      const response = await get(arenaAId, '2026-08-20')
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as DashboardBody;

      expect(body.arena).toEqual({ id: arenaAId, name: 'Arena A', timezone: 'America/Sao_Paulo' });
      expect(body.date).toBe('2026-08-20');
      expect(body.summary).toEqual({
        confirmedBookings: 1,
        cancelledBookings: 1,
        blocks: 1,
        maintenance: 0,
      });
    });

    it('nunca inclui reservas da Arena B (isolamento cross-tenant)', async () => {
      const response = await get(arenaAId, '2026-08-20')
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as DashboardBody;

      const allCourtIds = body.courts.map((c) => c.id);
      expect(allCourtIds).not.toContain(courtBId);
      const allBookingIds = body.upcomingBookings.map((b) => b.id);
      const allOccupancyIds = body.courts.flatMap((c) => c.occupancy.map((o) => o.id));
      // Nenhuma reserva da Arena B aparece em nenhuma das duas visões.
      for (const id of [...allBookingIds, ...allOccupancyIds]) {
        expect(id).toBeTruthy();
      }
      expect(body.courts.every((c) => c.id !== courtBId)).toBe(true);
    });

    it('reserva do dia seguinte não aparece na consulta do dia (limite correto da janela)', async () => {
      const response = await get(arenaAId, '2026-08-20')
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as DashboardBody;
      const ids = body.upcomingBookings.map((b) => b.id);
      // Só a reserva das 10:00 do dia 20 (a das 12:00 CANCELLED some do
      // upcoming; a do dia 21 nunca deveria estar aqui de forma alguma).
      expect(body.upcomingBookings).toHaveLength(2); // CUSTOMER confirmada + BLOCK
      expect(ids.length).toBe(2);
    });

    it('quadra inativa aparece marcada, quadra ativa também — nenhuma quadra de outra arena', async () => {
      const response = await get(arenaAId, '2026-08-20')
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as DashboardBody;

      const active = body.courts.find((c) => c.id === courtAActiveId);
      const inactive = body.courts.find((c) => c.id === courtAInactiveId);
      expect(active?.isActive).toBe(true);
      expect(inactive?.isActive).toBe(false);
      expect(body.courts).toHaveLength(2);
    });

    it('arena fechada no dia consultado retorna operatingHours vazio (sem inventar horário)', async () => {
      // 2026-08-21 é sexta-feira — sem horário configurado para a Arena A.
      const response = await get(arenaAId, '2026-08-21')
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as DashboardBody;
      expect(body.operatingHours).toEqual([]);
    });

    it('arena aberta no dia consultado retorna o intervalo configurado', async () => {
      const response = await get(arenaAId, '2026-08-20')
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as DashboardBody;
      expect(body.operatingHours).toEqual([
        {
          id: expect.any(String) as string,
          dayOfWeek: 'THURSDAY',
          opensAt: '08:00',
          closesAt: '22:00',
        },
      ]);
    });

    it('sem ?date, responde com um dia válido (hoje no timezone da arena) sem erro', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaAId}/dashboard`)
        .set(...authHeader('token-owner-a'))
        .expect(200);
      const body = response.body as DashboardBody;
      expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
