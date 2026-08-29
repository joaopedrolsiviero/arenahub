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

// User OWNER: dono da arena/quadra, único que pode criar BLOCK/MAINTENANCE.
// User CUSTOMER: só cliente autenticado, deliberadamente SEM nenhum vínculo
// de ArenaMember com a arena — prova a decisão da Fase 4 de que reservar
// como CUSTOMER não exige ser membro da arena.
// User OUTRO: também sem vínculo, usado para os testes de segurança
// cross-tenant (não pode cancelar reserva alheia, não pode ver admin).
const USER_OWNER = { clerkId: 'user_e2e_bookings_owner', email: 'bookings-e2e-owner@example.com' };
const USER_CUSTOMER = {
  clerkId: 'user_e2e_bookings_customer',
  email: 'bookings-e2e-customer@example.com',
};
const USER_OUTRO = { clerkId: 'user_e2e_bookings_outro', email: 'bookings-e2e-outro@example.com' };

const TOKENS: Record<string, string> = {
  'token-owner': USER_OWNER.clerkId,
  'token-customer': USER_CUSTOMER.clerkId,
  'token-outro': USER_OUTRO.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

interface BookingBody {
  id: string;
  courtId: string;
  type: BookingType;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  total: string;
  userId?: string;
}

function asBookingBody(response: request.Response): BookingBody {
  return response.body as BookingBody;
}

describe('Bookings & Availability (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaId: string;
  let courtId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const owner = await prisma.user.create({ data: USER_OWNER });
    await prisma.user.create({ data: USER_CUSTOMER });
    await prisma.user.create({ data: USER_OUTRO });

    const arena = await prisma.arena.create({
      data: { name: 'Arena Bookings E2E', slug: 'arena-bookings-e2e' },
    });
    arenaId = arena.id;
    await prisma.arenaMember.create({
      data: { arenaId, userId: owner.id, role: ArenaRole.OWNER },
    });
    const court = await prisma.court.create({
      data: {
        arenaId,
        name: 'Quadra E2E',
        sport: Sport.BEACH_VOLLEYBALL,
        pricePerSlot: 100,
        slotDurationMinutes: 60,
        bufferMinutes: 15,
      },
    });
    courtId = court.id;

    // Fase 5: uma Arena nova nasce sem nenhum horário configurado (fechada
    // todo dia — decisão documentada em docs/ARCHITECTURE.md). A maior
    // parte deste arquivo não é sobre horário de funcionamento em si, então
    // abrimos a arena quase o dia inteiro em todos os dias da semana aqui —
    // os testes dedicados a horário de funcionamento usam uma arena própria
    // (ver describe "Horário de funcionamento (Fase 5)" abaixo).
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
    // Booking.court é onDelete: Restrict (histórico nunca desaparece com a
    // quadra) — precisa apagar os Bookings de teste antes da Arena, senão o
    // cascade Arena -> Court esbarra na constraint.
    await prisma.booking.deleteMany({ where: { courtId } });
    await prisma.arena.deleteMany({ where: { id: arenaId } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  const bookingsUrl = () => `/v1/arenas/${arenaId}/courts/${courtId}/bookings`;

  describe('POST /bookings (CUSTOMER)', () => {
    it('rejeita sem Idempotency-Key (400)', async () => {
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .send({ startsAt: '2026-08-20T09:00:00-03:00' })
        .expect(400);
    });

    it('cliente comum (sem ser ArenaMember) cria reserva CUSTOMER com sucesso', async () => {
      const response = await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'idem-key-1')
        .send({ startsAt: '2026-08-20T09:00:00-03:00' })
        .expect(201);

      const booking = asBookingBody(response);
      expect(booking).toMatchObject({
        courtId,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt: '2026-08-20T12:00:00.000Z', // 09:00 -03:00
        endsAt: '2026-08-20T13:00:00.000Z',
      });
    });

    it('replay da mesma Idempotency-Key + mesmo payload não cria duplicata', async () => {
      const response = await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'idem-key-1')
        .send({ startsAt: '2026-08-20T09:00:00-03:00' })
        .expect(201);

      const count = await prisma.booking.count({
        where: { courtId, startsAt: new Date('2026-08-20T09:00:00-03:00') },
      });
      expect(count).toBe(1);
      expect(asBookingBody(response).status).toBe(BookingStatus.CONFIRMED);
    });

    it('mesma Idempotency-Key com payload diferente é rejeitada (409)', async () => {
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'idem-key-1')
        .send({ startsAt: '2026-08-21T09:00:00-03:00' })
        .expect(409);
    });

    it('reserva sobreposta (chave de idempotência diferente) é rejeitada (409)', async () => {
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'idem-key-2')
        .send({ startsAt: '2026-08-20T09:30:00-03:00' })
        .expect(409);
    });

    it('rejeita campos protegidos enviados pelo cliente (400, whitelist)', async () => {
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'idem-key-3')
        .send({ startsAt: '2026-08-20T14:00:00-03:00', userId: 'outro-user', total: 0 })
        .expect(400);
    });
  });

  describe('POST /bookings/blocks e /maintenance (admin)', () => {
    it('cliente comum não pode criar BLOCK (403)', async () => {
      await request(app.getHttpServer())
        .post(`${bookingsUrl()}/blocks`)
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'idem-block-1')
        .send({ startsAt: '2026-08-20T18:00:00-03:00', endsAt: '2026-08-20T20:00:00-03:00' })
        .expect(403);
    });

    it('OWNER cria BLOCK com sucesso (buffer 0, total 0)', async () => {
      const response = await request(app.getHttpServer())
        .post(`${bookingsUrl()}/blocks`)
        .set(...authHeader('token-owner'))
        .set('Idempotency-Key', 'idem-block-1')
        .send({
          startsAt: '2026-08-20T18:00:00-03:00',
          endsAt: '2026-08-20T20:00:00-03:00',
          reason: 'Manutenção da rede',
        })
        .expect(201);

      expect(asBookingBody(response)).toMatchObject({
        type: BookingType.BLOCK,
        total: '0',
      });
    });

    it('OWNER cria MAINTENANCE com sucesso', async () => {
      const response = await request(app.getHttpServer())
        .post(`${bookingsUrl()}/maintenance`)
        .set(...authHeader('token-owner'))
        .set('Idempotency-Key', 'idem-maint-1')
        .send({ startsAt: '2026-08-21T06:00:00-03:00', endsAt: '2026-08-21T07:00:00-03:00' })
        .expect(201);

      expect(asBookingBody(response).type).toBe(BookingType.MAINTENANCE);
    });

    it('CUSTOMER não pode ser criado dentro da janela de MAINTENANCE (409)', async () => {
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'idem-key-4')
        .send({ startsAt: '2026-08-21T06:00:00-03:00' })
        .expect(409);
    });
  });

  describe('GET /bookings (ocupação, sem PII) e /bookings/admin', () => {
    it('listagem pública não expõe userId/reason/total', async () => {
      const response = await request(app.getHttpServer())
        .get(bookingsUrl())
        .query({ from: '2026-08-20T00:00:00-03:00', to: '2026-08-22T00:00:00-03:00' })
        .set(...authHeader('token-customer'))
        .expect(200);

      const bookings = response.body as Record<string, unknown>[];
      expect(bookings.length).toBeGreaterThan(0);
      for (const booking of bookings) {
        expect(booking.userId).toBeUndefined();
        expect(booking.reason).toBeUndefined();
        expect(booking.total).toBeUndefined();
      }
    });

    it('cliente comum não acessa a listagem administrativa (403)', async () => {
      await request(app.getHttpServer())
        .get(`${bookingsUrl()}/admin`)
        .query({ from: '2026-08-20T00:00:00-03:00', to: '2026-08-22T00:00:00-03:00' })
        .set(...authHeader('token-customer'))
        .expect(403);
    });

    it('OWNER acessa a listagem administrativa com dados do responsável', async () => {
      const response = await request(app.getHttpServer())
        .get(`${bookingsUrl()}/admin`)
        .query({ from: '2026-08-20T00:00:00-03:00', to: '2026-08-22T00:00:00-03:00' })
        .set(...authHeader('token-owner'))
        .expect(200);

      const bookings = response.body as Record<string, unknown>[];
      expect(bookings.some((b) => b.userId !== undefined)).toBe(true);
    });
  });

  describe('GET /availability', () => {
    it('marca o slot ocupado pela reserva CUSTOMER como indisponível e um slot livre como disponível', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaId}/courts/${courtId}/availability`)
        .query({ from: '2026-08-20T09:00:00-03:00', to: '2026-08-20T12:00:00-03:00' })
        .set(...authHeader('token-customer'))
        .expect(200);

      const body = response.body as {
        courtId: string;
        timezone: string;
        slots: { startsAt: string; endsAt: string; available: boolean }[];
      };
      expect(body.courtId).toBe(courtId);
      expect(body.timezone).toBe('America/Sao_Paulo');
      expect(body.slots).toHaveLength(3);
      expect(body.slots[0]?.available).toBe(false); // 09:00-10:00, coincide com a reserva
      expect(body.slots[2]?.available).toBe(true); // 11:00-12:00, livre
    });

    // Fase 29 — visitante sem conta precisa conseguir ver disponibilidade
    // real antes de autenticar; login só é exigido pra criar a Booking.
    it('Fase 29: funciona SEM token (visitante anônimo)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaId}/courts/${courtId}/availability`)
        .query({ from: '2026-08-20T09:00:00-03:00', to: '2026-08-20T12:00:00-03:00' })
        .expect(200);

      const body = response.body as { slots: { available: boolean }[] };
      expect(body.slots).toHaveLength(3);
    });
  });

  describe('POST /bookings/:bookingId/cancel', () => {
    let bookingId: string;

    // Fase 27: cancelamento exige `startsAt` no futuro — ano seguinte ao
    // resto da fixture deste arquivo (que usa 2026-08-2x), só pra nunca
    // colidir com nenhuma outra reserva já criada na mesma quadra.
    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'idem-cancel-1')
        .send({ startsAt: '2027-08-22T09:00:00-03:00' })
        .expect(201);
      bookingId = asBookingBody(response).id;
    });

    it('usuário sem relação com a reserva não pode cancelar (403)', async () => {
      await request(app.getHttpServer())
        .post(`${bookingsUrl()}/${bookingId}/cancel`)
        .set(...authHeader('token-outro'))
        .expect(403);
    });

    it('dono da reserva cancela com sucesso', async () => {
      const response = await request(app.getHttpServer())
        .post(`${bookingsUrl()}/${bookingId}/cancel`)
        .set(...authHeader('token-customer'))
        .expect(200);

      expect(asBookingBody(response).status).toBe(BookingStatus.CANCELLED);
    });

    it('cancelar de novo é idempotente (200, continua CANCELLED)', async () => {
      const response = await request(app.getHttpServer())
        .post(`${bookingsUrl()}/${bookingId}/cancel`)
        .set(...authHeader('token-customer'))
        .expect(200);

      expect(asBookingBody(response).status).toBe(BookingStatus.CANCELLED);
    });

    it('reserva cancelada libera o horário para nova reserva', async () => {
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-outro'))
        .set('Idempotency-Key', 'idem-cancel-2')
        .send({ startsAt: '2027-08-22T09:00:00-03:00' })
        .expect(201);
    });
  });

  // Fase 4, item 48: casos de boundary temporal explícitos. A quadra deste
  // arquivo tem bufferMinutes=15, então A:10:00-11:00 + B:11:00-12:00 é
  // conflito (não é o caso "buffer=0" em que seriam permitidas).
  describe('Boundary temporal (item 48)', () => {
    it('Caso 1 — A:10:00-11:00, B:11:00-12:00: conflito, pois a quadra tem buffer > 0', async () => {
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'boundary-1a')
        .send({ startsAt: '2026-08-23T10:00:00-03:00' })
        .expect(201);

      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'boundary-1b')
        .send({ startsAt: '2026-08-23T11:00:00-03:00' })
        .expect(409);
    });

    it('Caso 2 — A:10:00-11:00, B:10:30-11:30: conflito (sobreposição direta)', async () => {
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'boundary-2a')
        .send({ startsAt: '2026-08-24T10:00:00-03:00' })
        .expect(201);

      // 10:30 não alinha com a grade de 60min, mas o backend não exige
      // alinhamento a uma grade fixa — só rejeita por conflito de horário
      // (não existe "horário de funcionamento" nesta fase, item 36).
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'boundary-2b')
        .send({ startsAt: '2026-08-24T10:30:00-03:00' })
        .expect(409);
    });

    it('Caso 3 — A:10:00-11:00, B:10:59-11:59: conflito (1 minuto de sobreposição)', async () => {
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'boundary-3a')
        .send({ startsAt: '2026-08-25T10:00:00-03:00' })
        .expect(201);

      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'boundary-3b')
        .send({ startsAt: '2026-08-25T10:59:00-03:00' })
        .expect(409);
    });
  });

  // Fase 4, item 49: combinações de tipo. BLOCK/MAINTENANCE têm buffer 0
  // (não precisam de margem própria), mas CUSTOMER sempre respeita o buffer
  // da quadra — inclusive quando o vizinho é um BLOCK/MAINTENANCE.
  describe('Buffer entre tipos diferentes (item 49)', () => {
    it('BLOCK → CUSTOMER adjacente (sem gap) é permitido: BLOCK tem buffer 0', async () => {
      await request(app.getHttpServer())
        .post(`${bookingsUrl()}/blocks`)
        .set(...authHeader('token-owner'))
        .set('Idempotency-Key', 'buffer-block-1')
        .send({ startsAt: '2026-08-26T14:00:00-03:00', endsAt: '2026-08-26T15:00:00-03:00' })
        .expect(201);

      // CUSTOMER começa exatamente onde o BLOCK termina (15:00) — permitido,
      // pois o BLOCK não exige buffer de saída.
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'buffer-block-2')
        .send({ startsAt: '2026-08-26T15:00:00-03:00' })
        .expect(201);
    });

    it('CUSTOMER → BLOCK adjacente é rejeitado: o buffer é do CUSTOMER anterior, não do BLOCK', async () => {
      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'buffer-cust-1')
        .send({ startsAt: '2026-08-27T09:00:00-03:00' }) // ocupa até 10:00, buffer até 10:15
        .expect(201);

      // BLOCK tentando começar às 10:00 esbarra no buffer de saída da
      // reserva CUSTOMER anterior (que vai até 10:15).
      await request(app.getHttpServer())
        .post(`${bookingsUrl()}/blocks`)
        .set(...authHeader('token-owner'))
        .set('Idempotency-Key', 'buffer-cust-2')
        .send({ startsAt: '2026-08-27T10:00:00-03:00', endsAt: '2026-08-27T11:00:00-03:00' })
        .expect(409);
    });
  });

  // Fase 4, item 50: quadra inativa.
  describe('Quadra inativa (item 50)', () => {
    const courtsBaseUrl = () => `/v1/arenas/${arenaId}/courts/${courtId}`;

    it('desativar a quadra impede novas reservas, mas não apaga o histórico existente', async () => {
      await request(app.getHttpServer())
        .patch(courtsBaseUrl())
        .set(...authHeader('token-owner'))
        .send({ isActive: false })
        .expect(200);

      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'inativa-1')
        .send({ startsAt: '2026-08-28T09:00:00-03:00' })
        .expect(409);

      const availability = await request(app.getHttpServer())
        .get(`/v1/arenas/${arenaId}/courts/${courtId}/availability`)
        .query({ from: '2026-08-28T09:00:00-03:00', to: '2026-08-28T10:00:00-03:00' })
        .set(...authHeader('token-customer'))
        .expect(200);
      const { slots } = availability.body as { slots: { available: boolean }[] };
      expect(slots.every((s) => !s.available)).toBe(true);

      // Histórico (reservas criadas antes da desativação) continua
      // consultável normalmente.
      const historic = await request(app.getHttpServer())
        .get(bookingsUrl())
        .query({ from: '2026-08-20T00:00:00-03:00', to: '2026-08-21T00:00:00-03:00' })
        .set(...authHeader('token-customer'))
        .expect(200);
      expect((historic.body as unknown[]).length).toBeGreaterThan(0);
    });

    it('reativar a quadra volta a permitir novas reservas', async () => {
      await request(app.getHttpServer())
        .patch(courtsBaseUrl())
        .set(...authHeader('token-owner'))
        .send({ isActive: true })
        .expect(200);

      await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'inativa-2')
        .send({ startsAt: '2026-08-28T09:00:00-03:00' })
        .expect(201);
    });
  });

  // Fase 4, item 40: segurança cross-tenant com uma segunda arena, cujo
  // OWNER não tem nenhum vínculo com a Arena/Quadra principal deste arquivo.
  describe('Segurança cross-tenant (item 40)', () => {
    let otherArenaId: string;
    let otherCourtId: string;

    beforeAll(async () => {
      const otherArena = await prisma.arena.create({
        data: { name: 'Arena B Bookings E2E', slug: 'arena-b-bookings-e2e' },
      });
      otherArenaId = otherArena.id;
      // token-outro é OWNER só da Arena B — sem nenhum vínculo com a Arena A.
      const outroUser = await prisma.user.findUniqueOrThrow({
        where: { clerkId: USER_OUTRO.clerkId },
      });
      await prisma.arenaMember.create({
        data: { arenaId: otherArenaId, userId: outroUser.id, role: ArenaRole.OWNER },
      });
      const otherCourt = await prisma.court.create({
        data: { arenaId: otherArenaId, name: 'Quadra B', sport: Sport.BEACH_VOLLEYBALL },
      });
      otherCourtId = otherCourt.id;
    });

    afterAll(async () => {
      await prisma.booking.deleteMany({ where: { courtId: otherCourtId } });
      await prisma.arena.deleteMany({ where: { id: otherArenaId } });
    });

    it('OWNER da Arena A não pode criar BLOCK na Arena B (403)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/arenas/${otherArenaId}/courts/${otherCourtId}/bookings/blocks`)
        .set(...authHeader('token-owner'))
        .set('Idempotency-Key', 'cross-tenant-1')
        .send({ startsAt: '2026-08-29T10:00:00-03:00', endsAt: '2026-08-29T11:00:00-03:00' })
        .expect(403);
    });

    it('OWNER da Arena A não pode ver a listagem administrativa da Arena B (403)', async () => {
      await request(app.getHttpServer())
        .get(`/v1/arenas/${otherArenaId}/courts/${otherCourtId}/bookings/admin`)
        .query({ from: '2026-08-20T00:00:00-03:00', to: '2026-08-30T00:00:00-03:00' })
        .set(...authHeader('token-owner'))
        .expect(403);
    });

    it('não é possível cancelar Booking trocando só o courtId para o de outra arena (404, sem vazar existência)', async () => {
      const response = await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'cross-tenant-2')
        .send({ startsAt: '2026-08-29T09:00:00-03:00' })
        .expect(201);
      const bookingId = asBookingBody(response).id;

      // arenaId/courtId corretos são os da Arena A — trocar o courtId pelo
      // da Arena B (mesma arenaId da Arena A) não pode "achar" a reserva.
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaId}/courts/${otherCourtId}/bookings/${bookingId}/cancel`)
        .set(...authHeader('token-customer'))
        .expect(404);
    });
  });

  // Fase 5: integração entre horário de funcionamento e criação de
  // Booking/disponibilidade — usa uma arena própria, com horário estreito e
  // controlado, para não interferir com o resto da suíte (que abre a Arena A
  // quase o dia inteiro para não ser sobre isso).
  describe('Horário de funcionamento (Fase 5)', () => {
    let hoursArenaId: string;
    let hoursCourtId: string;

    beforeAll(async () => {
      const hoursArena = await prisma.arena.create({
        data: {
          name: 'Arena Horários E2E',
          slug: 'arena-horarios-e2e',
          timezone: 'America/Sao_Paulo',
        },
      });
      hoursArenaId = hoursArena.id;
      const owner = await prisma.user.findUniqueOrThrow({ where: { clerkId: USER_OWNER.clerkId } });
      await prisma.arenaMember.create({
        data: { arenaId: hoursArenaId, userId: owner.id, role: ArenaRole.OWNER },
      });
      const hoursCourt = await prisma.court.create({
        data: {
          arenaId: hoursArenaId,
          name: 'Quadra Horários',
          sport: Sport.BEACH_VOLLEYBALL,
          slotDurationMinutes: 60,
          bufferMinutes: 15,
        },
      });
      hoursCourtId = hoursCourt.id;
      // 2026-08-31 é uma segunda-feira: aberta 08:00-18:00. Nenhum outro dia
      // configurado (fechado).
      await prisma.arenaOperatingHours.create({
        data: { arenaId: hoursArenaId, dayOfWeek: Weekday.MONDAY, opensAt: 480, closesAt: 1080 },
      });
    });

    afterAll(async () => {
      await prisma.booking.deleteMany({ where: { courtId: hoursCourtId } });
      await prisma.arena.deleteMany({ where: { id: hoursArenaId } });
    });

    const hoursBookingsUrl = () => `/v1/arenas/${hoursArenaId}/courts/${hoursCourtId}/bookings`;

    it('reserva dentro do horário de funcionamento é aceita', async () => {
      await request(app.getHttpServer())
        .post(hoursBookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'hours-1')
        .send({ startsAt: '2026-08-31T10:00:00-03:00' })
        .expect(201);
    });

    it('reserva fora do horário de funcionamento é rejeitada (409)', async () => {
      await request(app.getHttpServer())
        .post(hoursBookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'hours-2')
        .send({ startsAt: '2026-08-31T19:00:00-03:00' }) // arena fecha às 18:00
        .expect(409);
    });

    it('reserva num dia sem nenhum horário configurado é rejeitada (409)', async () => {
      await request(app.getHttpServer())
        .post(hoursBookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'hours-3')
        .send({ startsAt: '2026-09-01T10:00:00-03:00' }) // terça — sem horário configurado
        .expect(409);
    });

    it('reserva que atravessaria o fechamento (considerando o buffer) é rejeitada (409)', async () => {
      // Fecha às 18:00; 17:00-18:00 + buffer 15min ocupa até 18:15 —
      // ultrapassa o fechamento.
      await request(app.getHttpServer())
        .post(hoursBookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'hours-4')
        .send({ startsAt: '2026-08-31T17:00:00-03:00' })
        .expect(409);
    });

    it('disponibilidade não gera slots fora do horário de funcionamento', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${hoursArenaId}/courts/${hoursCourtId}/availability`)
        .query({ from: '2026-08-31T00:00:00-03:00', to: '2026-09-01T00:00:00-03:00' })
        .set(...authHeader('token-customer'))
        .expect(200);

      const body = response.body as { timezone: string; slots: { startsAt: string }[] };
      expect(body.timezone).toBe('America/Sao_Paulo');
      // Todo slot cai dentro de 08:00-18:00 local — nenhum às 07:00 ou 19:00.
      for (const slot of body.slots) {
        const hour = new Date(slot.startsAt).toLocaleString('en-US', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          hour12: false,
        });
        expect(Number(hour)).toBeGreaterThanOrEqual(8);
        expect(Number(hour)).toBeLessThan(18);
      }
    });

    it('disponibilidade num dia sem horário configurado não tem nenhum slot', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/${hoursArenaId}/courts/${hoursCourtId}/availability`)
        .query({ from: '2026-09-01T00:00:00-03:00', to: '2026-09-02T00:00:00-03:00' })
        .set(...authHeader('token-customer'))
        .expect(200);

      expect((response.body as { slots: unknown[] }).slots).toEqual([]);
    });

    it('alterar o horário de funcionamento: novas reservas respeitam a nova configuração, reserva existente permanece histórico', async () => {
      // 08:00 (não 09:00) para não colidir, via buffer, com a reserva já
      // criada em 10:00-11:00 pelo teste "dentro do horário" acima (mesma
      // quadra/dia): 08:00-09:00+15min de buffer ocupa até 09:15, antes das
      // 10:00 — sem overlap.
      const created = await request(app.getHttpServer())
        .post(hoursBookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'hours-5')
        .send({ startsAt: '2026-08-31T08:00:00-03:00' })
        .expect(201);
      const bookingId = asBookingBody(created).id;

      // Estreita o horário de segunda para 12:00-18:00 — 08:00 não estaria
      // mais dentro do funcionamento.
      await request(app.getHttpServer())
        .put(`/v1/arenas/${hoursArenaId}/operating-hours`)
        .set(...authHeader('token-owner'))
        .send({ intervals: [{ dayOfWeek: 'MONDAY', opensAt: '12:00', closesAt: '18:00' }] })
        .expect(200);

      // A reserva já criada continua existindo, sem ser apagada/cancelada.
      const stillThere = await prisma.booking.findUnique({ where: { id: bookingId } });
      expect(stillThere?.status).toBe(BookingStatus.CONFIRMED);

      // Uma nova tentativa no mesmo horário (08:00, agora fora do novo
      // funcionamento) é rejeitada.
      await request(app.getHttpServer())
        .post(hoursBookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'hours-6')
        .send({ startsAt: '2026-08-31T08:00:00-03:00' })
        .expect(409);

      // Uma reserva às 13:00 (dentro do novo horário) é aceita.
      await request(app.getHttpServer())
        .post(hoursBookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'hours-7')
        .send({ startsAt: '2026-08-31T13:00:00-03:00' })
        .expect(201);
    });

    it('BLOCK/MAINTENANCE continuam podendo ser criados fora do horário de funcionamento', async () => {
      await request(app.getHttpServer())
        .post(`${hoursBookingsUrl()}/maintenance`)
        .set(...authHeader('token-owner'))
        .set('Idempotency-Key', 'hours-maint-1')
        .send({ startsAt: '2026-09-01T03:00:00-03:00', endsAt: '2026-09-01T05:00:00-03:00' })
        .expect(201);
    });

    // Item 45: alteração de operating hours concorrente com criação de
    // Booking — nenhuma das duas transações compartilha lock (a de horário
    // não toca Booking/advisory lock, a de criação não toca
    // ArenaOperatingHours além de ler), então rodam de fato em paralelo. A
    // garantia que importa não é "qual delas vence" (ambos os resultados são
    // individualmente corretos, dependendo de qual commita primeiro) — é que
    // NUNCA existe um estado parcial: a config final é exatamente a última
    // substituição completa (nunca metade da semana antiga + metade nova), e
    // a resposta da criação de Booking é sempre 201 ou 409, nunca um erro
    // cru/estado inconsistente.
    it('alteração de horário concorrente com criação de Booking: sem estado parcial, resposta sempre 201 ou 409', async () => {
      await request(app.getHttpServer())
        .put(`/v1/arenas/${hoursArenaId}/operating-hours`)
        .set(...authHeader('token-owner'))
        .send({ intervals: [{ dayOfWeek: 'WEDNESDAY', opensAt: '10:00', closesAt: '14:00' }] })
        .expect(200);

      const [putResponse, bookingResponse] = await Promise.all([
        request(app.getHttpServer())
          .put(`/v1/arenas/${hoursArenaId}/operating-hours`)
          .set(...authHeader('token-owner'))
          .send({ intervals: [{ dayOfWeek: 'WEDNESDAY', opensAt: '12:00', closesAt: '14:00' }] }),
        request(app.getHttpServer())
          .post(hoursBookingsUrl())
          .set(...authHeader('token-customer'))
          .set('Idempotency-Key', 'hours-race-1')
          .send({ startsAt: '2026-09-02T10:30:00-03:00' }), // 10:30 — válido no horário antigo, não no novo
      ]);

      expect(putResponse.status).toBe(200);
      expect([201, 409]).toContain(bookingResponse.status);

      // A config final é exatamente a última substituição — nunca um
      // mix/estado parcial entre a antiga e a nova.
      const finalHours = await request(app.getHttpServer())
        .get(`/v1/arenas/${hoursArenaId}/operating-hours`)
        .set(...authHeader('token-owner'))
        .expect(200);
      const finalIntervals = finalHours.body as {
        id: string;
        dayOfWeek: string;
        opensAt: string;
        closesAt: string;
      }[];
      const wednesday = finalIntervals.filter((i) => i.dayOfWeek === 'WEDNESDAY');
      expect(wednesday).toHaveLength(1);
      expect(wednesday[0]).toMatchObject({
        dayOfWeek: 'WEDNESDAY',
        opensAt: '12:00',
        closesAt: '14:00',
      });
    });
  });

  describe('Segurança — requisição sem token', () => {
    it('todas as rotas de bookings exigem autenticação (401)', async () => {
      await request(app.getHttpServer()).get(bookingsUrl()).expect(401);
    });

    // Fase 29 — `GET .../availability` deixou de exigir autenticação de
    // propósito (visitante sem conta precisa ver disponibilidade real antes
    // de logar); movido pra fora do teste acima porque não é mais uma rota
    // que "exige autenticação" — ver caso dedicado em describe('GET
    // /availability').
  });

  // Fase 13 — consolidação do ciclo de vida da reserva do CUSTOMER. A
  // criação/listagem/detalhe/cancelamento em si já existiam desde as Fases
  // 4/6 (auditado, não reescrito) — os testes abaixo cobrem lacunas
  // explicitamente pedidas pelo prompt da fase que ainda não tinham teste
  // dedicado.
  describe('Fase 13 — cancelamento: mass assignment, tipos, reserva inexistente', () => {
    it('mass assignment no corpo do cancelamento é ignorado — o endpoint nem lê o body', async () => {
      const created = await request(app.getHttpServer())
        .post(bookingsUrl())
        .set(...authHeader('token-customer'))
        .set('Idempotency-Key', 'f13-mass-assignment-1')
        .send({ startsAt: '2026-09-03T09:00:00-03:00' })
        .expect(201);
      const bookingId = asBookingBody(created).id;

      const response = await request(app.getHttpServer())
        .post(`${bookingsUrl()}/${bookingId}/cancel`)
        .set(...authHeader('token-customer'))
        .send({
          userId: 'outro-usuario',
          arenaId: 'outra-arena',
          courtId: 'outra-quadra',
          status: 'CONFIRMED',
          type: 'BLOCK',
          total: 999999,
        })
        .expect(200);

      const body = asBookingBody(response);
      expect(body.status).toBe(BookingStatus.CANCELLED);
      expect(body.type).toBe(BookingType.CUSTOMER);
      expect(Number(body.total)).toBe(100);
      expect(body.courtId).toBe(courtId);
    });

    it('CUSTOMER (sem nenhum vínculo com a arena) não consegue cancelar um BLOCK — 403', async () => {
      const block = await request(app.getHttpServer())
        .post(`${bookingsUrl()}/blocks`)
        .set(...authHeader('token-owner'))
        .set('Idempotency-Key', 'f13-block-cancel-1')
        .send({ startsAt: '2026-09-04T14:00:00-03:00', endsAt: '2026-09-04T15:00:00-03:00' })
        .expect(201);
      const blockId = asBookingBody(block).id;

      await request(app.getHttpServer())
        .post(`${bookingsUrl()}/${blockId}/cancel`)
        .set(...authHeader('token-customer'))
        .expect(403);

      // Nunca aparece em "minhas reservas" do CUSTOMER, mesmo tentando o
      // detalhe diretamente pelo ID descoberto.
      await request(app.getHttpServer())
        .get(`/v1/users/me/bookings/${blockId}`)
        .set(...authHeader('token-customer'))
        .expect(404);
    });

    it('CUSTOMER não consegue cancelar um MAINTENANCE — 403', async () => {
      const maintenance = await request(app.getHttpServer())
        .post(`${bookingsUrl()}/maintenance`)
        .set(...authHeader('token-owner'))
        .set('Idempotency-Key', 'f13-maintenance-cancel-1')
        .send({ startsAt: '2026-09-04T16:00:00-03:00', endsAt: '2026-09-04T17:00:00-03:00' })
        .expect(201);
      const maintenanceId = asBookingBody(maintenance).id;

      await request(app.getHttpServer())
        .post(`${bookingsUrl()}/${maintenanceId}/cancel`)
        .set(...authHeader('token-customer'))
        .expect(403);
    });

    it('OWNER/ADMIN consegue cancelar o próprio BLOCK (não é uma restrição de tipo, é de dono/papel)', async () => {
      const block = await request(app.getHttpServer())
        .post(`${bookingsUrl()}/blocks`)
        .set(...authHeader('token-owner'))
        .set('Idempotency-Key', 'f13-block-cancel-2')
        .send({ startsAt: '2026-09-05T14:00:00-03:00', endsAt: '2026-09-05T15:00:00-03:00' })
        .expect(201);
      const blockId = asBookingBody(block).id;

      const response = await request(app.getHttpServer())
        .post(`${bookingsUrl()}/${blockId}/cancel`)
        .set(...authHeader('token-owner'))
        .expect(200);
      expect(asBookingBody(response).status).toBe(BookingStatus.CANCELLED);
    });

    it('reserva inexistente: GET detalhe e POST cancelar nunca vazam erro interno (404 limpo)', async () => {
      const fakeId = 'booking-que-nao-existe-f13';

      const detailResponse = await request(app.getHttpServer())
        .get(`/v1/users/me/bookings/${fakeId}`)
        .set(...authHeader('token-customer'))
        .expect(404);
      expect(JSON.stringify(detailResponse.body)).not.toMatch(
        /prisma|stack|at\s+\S+\.(ts|js):\d+/i,
      );

      const cancelResponse = await request(app.getHttpServer())
        .post(`${bookingsUrl()}/${fakeId}/cancel`)
        .set(...authHeader('token-customer'))
        .expect(404);
      expect(JSON.stringify(cancelResponse.body)).not.toMatch(
        /prisma|stack|at\s+\S+\.(ts|js):\d+/i,
      );
    });
  });
});
