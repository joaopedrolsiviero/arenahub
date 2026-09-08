import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ArenaRole, BookingType, PrismaClient, Sport, Weekday } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';

// Fase 6: descoberta pública de arenas e "minhas reservas" — os dois
// endpoints novos desta fase. User OWNER administra a Arena, cria um BLOCK
// nela (para provar que não vaza em "minhas reservas" de ninguém). User A e
// User B são clientes comuns, sem nenhum vínculo administrativo — usados
// para os testes de privacidade/cross-tenant obrigatórios (itens 30/63/64).
const USER_OWNER = { clerkId: 'user_e2e_cx_owner', email: 'cx-e2e-owner@example.com' };
const USER_A = { clerkId: 'user_e2e_cx_a', email: 'cx-e2e-a@example.com' };
const USER_B = { clerkId: 'user_e2e_cx_b', email: 'cx-e2e-b@example.com' };

// Fase 13 — usuários da fixture isolada de multi-tenant/timezone (ver
// describe "Fase 13" no fim do arquivo). Precisam estar no MESMO mapa de
// tokens que o ClerkService mockado usa, porque o TestingModule é compilado
// uma única vez no beforeAll externo — declarados aqui em vez de dentro do
// describe para existirem antes dessa compilação.
const USER_F13_A1 = { clerkId: 'user_e2e_f13_a1', email: 'f13-a1@example.com' };
const USER_F13_A2 = { clerkId: 'user_e2e_f13_a2', email: 'f13-a2@example.com' };
const USER_F13_B1 = { clerkId: 'user_e2e_f13_b1', email: 'f13-b1@example.com' };

const TOKENS: Record<string, string> = {
  'token-owner': USER_OWNER.clerkId,
  'token-a': USER_A.clerkId,
  'token-b': USER_B.clerkId,
  'token-f13-a1': USER_F13_A1.clerkId,
  'token-f13-a2': USER_F13_A2.clerkId,
  'token-f13-b1': USER_F13_B1.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

// Mesmo bug temporal já corrigido em bookings.e2e-spec.ts: a reserva de
// User A abaixo precisa continuar FUTURA (o teste "cancelamento continua
// sendo a rota já existente" depende disso — BookingsService.cancel
// rejeita com 400 uma reserva que já começou) — uma data fixa
// eventualmente vira passado conforme o tempo real avança. Mesmo padrão
// adotado lá: data sempre relativa a `Date.now()`, nunca fixa. América/
// São_Paulo não observa mais horário de verão desde o Decreto 10.166/2019
// — o offset -03:00 é constante o ano inteiro, então soma de dias em UTC é
// suficiente (nenhuma biblioteca de timezone é necessária aqui).
function futureDate(daysFromNow: number, time: string): string {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  const target = new Date(base.getTime() + daysFromNow * 86_400_000);
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${time}-03:00`;
}

interface DiscoverySummaryBody {
  id: string;
  name: string;
  sports: Sport[];
  isReady: boolean;
  role?: unknown;
  members?: unknown;
}

interface DiscoveryDetailBody {
  id: string;
  name: string;
  timezone: string;
  courts: { id: string; name: string; isActive?: unknown }[];
  members?: unknown;
  isReady: boolean;
}

interface MyBookingBody {
  id: string;
  status: string;
  startsAt: string;
  court: { id: string; name: string; arena: { id: string; name: string; timezone: string } };
}

describe('Customer experience — discovery & minhas reservas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaId: string;
  let activeCourtId: string;
  let inactiveCourtId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const owner = await prisma.user.create({ data: USER_OWNER });
    const userA = await prisma.user.create({ data: USER_A });
    await prisma.user.create({ data: USER_B });

    const arena = await prisma.arena.create({
      data: {
        name: 'Arena Discovery E2E',
        slug: 'arena-discovery-e2e',
        timezone: 'America/Sao_Paulo',
      },
    });
    arenaId = arena.id;
    await prisma.arenaMember.create({
      data: { arenaId, userId: owner.id, role: ArenaRole.OWNER },
    });
    await prisma.arenaOperatingHours.createMany({
      data: Object.values(Weekday).map((dayOfWeek) => ({
        arenaId,
        dayOfWeek,
        opensAt: 0,
        closesAt: 1439,
      })),
    });

    const activeCourt = await prisma.court.create({
      data: {
        arenaId,
        name: 'Quadra Ativa',
        sport: Sport.BEACH_VOLLEYBALL,
        pricePerSlot: 100,
        slotDurationMinutes: 60,
        bufferMinutes: 0,
      },
    });
    activeCourtId = activeCourt.id;

    const inactiveCourt = await prisma.court.create({
      data: { arenaId, name: 'Quadra Inativa', sport: Sport.BEACH_VOLLEYBALL, isActive: false },
    });
    inactiveCourtId = inactiveCourt.id;

    // Reserva CUSTOMER de User A — usada nos testes de "minhas reservas" e
    // de privacidade (User B não pode vê-la). Precisa continuar futura (ver
    // `futureDate` acima) — o teste de cancelamento depende disso.
    await prisma.booking.create({
      data: {
        courtId: activeCourtId,
        userId: userA.id,
        type: BookingType.CUSTOMER,
        startsAt: new Date(futureDate(30, '13:00:00')),
        endsAt: new Date(futureDate(30, '14:00:00')),
        total: 100,
      },
    });

    // BLOCK criado pelo OWNER — tem userId preenchido (o admin), mas nunca
    // pode aparecer em "minhas reservas" de ninguém (item 30).
    await prisma.booking.create({
      data: {
        courtId: activeCourtId,
        userId: owner.id,
        type: BookingType.BLOCK,
        startsAt: new Date('2026-09-07T18:00:00-03:00'),
        endsAt: new Date('2026-09-07T19:00:00-03:00'),
        reason: 'Evento privado',
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
      where: { courtId: { in: [activeCourtId, inactiveCourtId] } },
    });
    await prisma.arena.deleteMany({ where: { id: arenaId } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /v1/arenas/discover', () => {
    // Fase 29 — decisão explícita: um visitante sem conta precisa conseguir
    // navegar arena → quadra → data → horário → resumo antes de autenticar.
    // Login só é exigido pra criar a Booking (BookingsController), nunca
    // pra ler descoberta/disponibilidade pública. Antes desta fase, exigia
    // ClerkAuthGuard (qualquer usuário logado) — ver ARCHITECTURE.md.
    it('funciona SEM token (visitante anônimo, Fase 29)', async () => {
      const response = await request(app.getHttpServer()).get('/v1/arenas/discover').expect(200);

      const arenas = response.body as DiscoverySummaryBody[];
      expect(arenas.find((a) => a.id === arenaId)).toBeDefined();
    });

    it('não exige ArenaMember e nunca inclui role/members', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/arenas/discover')
        .set(...authHeader('token-a'))
        .expect(200);

      const arenas = response.body as DiscoverySummaryBody[];
      const found = arenas.find((a) => a.id === arenaId);
      expect(found).toBeDefined();
      expect(found?.sports).toEqual([Sport.BEACH_VOLLEYBALL]);
      expect(found?.role).toBeUndefined();
      expect(found?.members).toBeUndefined();
    });

    // Fase 33 — o visitante precisa saber ANTES de clicar se a arena já
    // aceita reservas (item 2 do prompt da fase); antes só dava pra
    // descobrir depois de entrar na página da arena.
    it('Fase 33: expõe isReady na listagem (quadra ativa com preço + horários configurados nesta fixture)', async () => {
      const response = await request(app.getHttpServer()).get('/v1/arenas/discover').expect(200);

      const arenas = response.body as DiscoverySummaryBody[];
      const found = arenas.find((a) => a.id === arenaId);
      expect(found?.isReady).toBe(true);
    });
  });

  describe('GET /v1/arenas/discover/:arenaId', () => {
    it('retorna a arena com timezone e só as quadras ativas', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/discover/${arenaId}`)
        .set(...authHeader('token-a'))
        .expect(200);

      const body = response.body as DiscoveryDetailBody;
      expect(body.timezone).toBe('America/Sao_Paulo');
      expect(body.members).toBeUndefined();
      const courtIds = body.courts.map((c) => c.id);
      expect(courtIds).toContain(activeCourtId);
      expect(courtIds).not.toContain(inactiveCourtId);
      expect(body.courts[0]?.isActive).toBeUndefined();
      // Fase 28, Caso 10: quadra ativa com preço válido + semana inteira
      // configurada (fixture acima) => pronta pro cliente reservar.
      expect(body.isReady).toBe(true);
    });

    it('Fase 29: funciona SEM token (visitante anônimo)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/arenas/discover/${arenaId}`)
        .expect(200);

      expect((response.body as DiscoveryDetailBody).isReady).toBe(true);
    });

    it('404 para arena inexistente', async () => {
      await request(app.getHttpServer())
        .get('/v1/arenas/discover/arena-que-nao-existe')
        .set(...authHeader('token-a'))
        .expect(404);
    });
  });

  // Fase 32 — URL pública canônica passa a ser `/arenas/:slug`; este é o
  // endpoint que a resolve. Mesmo shape de `discover/:arenaId`, então só
  // cobrimos o que é específico da busca por slug (sem token, 404, e o
  // mesmo isolamento de campos).
  describe('GET /v1/arenas/discover/slug/:slug', () => {
    it('retorna a arena pelo slug, sem token, com o mesmo formato de discover/:arenaId', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/arenas/discover/slug/arena-discovery-e2e')
        .expect(200);

      const body = response.body as DiscoveryDetailBody & { id: string };
      expect(body.id).toBe(arenaId);
      expect(body.timezone).toBe('America/Sao_Paulo');
      expect(body.members).toBeUndefined();
      expect(body.isReady).toBe(true);
    });

    it('404 para slug inexistente', async () => {
      await request(app.getHttpServer())
        .get('/v1/arenas/discover/slug/slug-que-nao-existe')
        .expect(404);
    });
  });

  describe('GET /v1/users/me/bookings', () => {
    it('exige autenticação (401)', async () => {
      await request(app.getHttpServer()).get('/v1/users/me/bookings').expect(401);
    });

    it('User A vê só a própria reserva CUSTOMER — nunca o BLOCK do OWNER', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/users/me/bookings')
        .set(...authHeader('token-a'))
        .expect(200);

      const bookings = response.body as MyBookingBody[];
      expect(bookings).toHaveLength(1);
      expect(bookings[0]?.court.arena.id).toBe(arenaId);
      expect(bookings[0]?.court.arena.timezone).toBe('America/Sao_Paulo');
    });

    it('User B (sem reservas) recebe lista vazia — nunca vê a reserva de User A', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/users/me/bookings')
        .set(...authHeader('token-b'))
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('OWNER (que só criou BLOCK, nunca uma reserva de cliente) também recebe lista vazia', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/users/me/bookings')
        .set(...authHeader('token-owner'))
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /v1/users/me/bookings/:bookingId', () => {
    let myBookingId: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/users/me/bookings')
        .set(...authHeader('token-a'))
        .expect(200);
      myBookingId = (response.body as MyBookingBody[])[0]!.id;
    });

    it('User A consegue ver o detalhe da própria reserva', async () => {
      await request(app.getHttpServer())
        .get(`/v1/users/me/bookings/${myBookingId}`)
        .set(...authHeader('token-a'))
        .expect(200);
    });

    it('User B recebe 404 (não 403) ao tentar ver a reserva de User A — não vaza existência', async () => {
      await request(app.getHttpServer())
        .get(`/v1/users/me/bookings/${myBookingId}`)
        .set(...authHeader('token-b'))
        .expect(404);
    });

    it('cancelamento continua sendo a rota já existente, usando arenaId/courtId da resposta', async () => {
      const detail = await request(app.getHttpServer())
        .get(`/v1/users/me/bookings/${myBookingId}`)
        .set(...authHeader('token-a'))
        .expect(200);
      const booking = detail.body as MyBookingBody;

      await request(app.getHttpServer())
        .post(
          `/v1/arenas/${booking.court.arena.id}/courts/${booking.court.id}/bookings/${booking.id}/cancel`,
        )
        .set(...authHeader('token-a'))
        .expect(200);

      const afterCancel = await request(app.getHttpServer())
        .get(`/v1/users/me/bookings/${myBookingId}`)
        .set(...authHeader('token-a'))
        .expect(200);
      expect((afterCancel.body as MyBookingBody).status).toBe('CANCELLED');
    });
  });

  // Fase 13, itens 14/18: isolamento multi-tenant com DUAS arenas (a
  // "Arena Discovery E2E" acima só tem uma) e dois clientes na Arena A —
  // fixture própria, isolada da suíte acima (cria e limpa os próprios
  // dados), reaproveitando só o `app` já inicializado. Arena B usa
  // America/New_York (com DST real) para provar que "minhas reservas" nunca
  // confunde o timezone de uma arena com o de outra na mesma lista.
  describe('Fase 13 — isolamento multi-tenant e timezone em "minhas reservas"', () => {
    const F13_CLERK_IDS = [USER_F13_A1.clerkId, USER_F13_A2.clerkId, USER_F13_B1.clerkId];

    let f13App: INestApplication<App>;
    let arenaAId: string;
    let arenaBId: string;
    let courtAId: string;
    let courtBId: string;
    let bookingA1Id: string;
    let bookingA2Id: string;
    let bookingB1Id: string;

    beforeAll(async () => {
      await prisma.user.deleteMany({ where: { clerkId: { in: F13_CLERK_IDS } } });
      const userA1 = await prisma.user.create({ data: USER_F13_A1 });
      const userA2 = await prisma.user.create({ data: USER_F13_A2 });
      const userB1 = await prisma.user.create({ data: USER_F13_B1 });

      const arenaA = await prisma.arena.create({
        data: { name: 'Arena F13 A', slug: 'arena-f13-a', timezone: 'America/Sao_Paulo' },
      });
      arenaAId = arenaA.id;
      const courtA = await prisma.court.create({
        data: {
          arenaId: arenaAId,
          name: 'Quadra F13 A',
          sport: Sport.BEACH_VOLLEYBALL,
          pricePerSlot: 50,
        },
      });
      courtAId = courtA.id;

      // 2027-03-14 é a data real da transição de DST em NY em 2027 (Fase 27:
      // cancelamento exige `startsAt` no futuro, então esta fixture usa o
      // ciclo de DST seguinte ao usado pelos testes de disponibilidade/
      // dashboard das fases 5/8/12, mesmo "dia seguinte à transição").
      const arenaB = await prisma.arena.create({
        data: { name: 'Arena F13 B (NY, DST)', slug: 'arena-f13-b', timezone: 'America/New_York' },
      });
      arenaBId = arenaB.id;
      const courtB = await prisma.court.create({
        data: {
          arenaId: arenaBId,
          name: 'Quadra F13 B',
          sport: Sport.BEACH_VOLLEYBALL,
          pricePerSlot: 80,
        },
      });
      courtBId = courtB.id;

      // Mesmo bug temporal do `futureDate` acima — A1 e A2 só precisam ser
      // futuras e ficar em dias DISTINTOS entre si (mesma quadra `courtAId`
      // nas duas: dias diferentes evitam qualquer risco de esbarrar na
      // EXCLUDE constraint do Postgres, que vale mesmo pra um insert direto
      // como este). Nenhum teste depende do dia exato, só de que sejam
      // reservas futuras e distintas.
      const bookingA1 = await prisma.booking.create({
        data: {
          courtId: courtAId,
          userId: userA1.id,
          type: BookingType.CUSTOMER,
          startsAt: new Date(futureDate(31, '13:00:00')),
          endsAt: new Date(futureDate(31, '14:00:00')),
          total: 50,
        },
      });
      bookingA1Id = bookingA1.id;

      const bookingA2 = await prisma.booking.create({
        data: {
          courtId: courtAId,
          userId: userA2.id,
          type: BookingType.CUSTOMER,
          startsAt: new Date(futureDate(32, '13:00:00')),
          endsAt: new Date(futureDate(32, '14:00:00')),
          total: 50,
        },
      });
      bookingA2Id = bookingA2.id;

      // Do lado de depois da transição de DST (UTC-4) — prova que o
      // instante persistido, não um offset fixo, é o que volta na resposta.
      const bookingB1 = await prisma.booking.create({
        data: {
          courtId: courtBId,
          userId: userB1.id,
          type: BookingType.CUSTOMER,
          startsAt: new Date('2027-03-15T14:00:00-04:00'),
          endsAt: new Date('2027-03-15T15:00:00-04:00'),
          total: 80,
        },
      });
      bookingB1Id = bookingB1.id;

      f13App = app;
    });

    afterAll(async () => {
      await prisma.booking.deleteMany({ where: { courtId: { in: [courtAId, courtBId] } } });
      await prisma.arena.deleteMany({ where: { id: { in: [arenaAId, arenaBId] } } });
      await prisma.user.deleteMany({ where: { clerkId: { in: F13_CLERK_IDS } } });
    });

    function f13Auth(token: 'token-f13-a1' | 'token-f13-a2' | 'token-f13-b1'): [string, string] {
      return ['Authorization', `Bearer ${token}`];
    }

    it('CUSTOMER A1 vê só a própria reserva — nunca a de A2 (mesma arena) nem a de B1 (outra arena)', async () => {
      const response = await request(f13App.getHttpServer())
        .get('/v1/users/me/bookings')
        .set(...f13Auth('token-f13-a1'))
        .expect(200);
      const bookings = response.body as MyBookingBody[];
      const ids = bookings.map((b) => b.id);

      expect(ids).toContain(bookingA1Id);
      expect(ids).not.toContain(bookingA2Id);
      expect(ids).not.toContain(bookingB1Id);
    });

    it('CUSTOMER A1 não consegue ver o detalhe da reserva de A2 (404, mesma arena)', async () => {
      await request(f13App.getHttpServer())
        .get(`/v1/users/me/bookings/${bookingA2Id}`)
        .set(...f13Auth('token-f13-a1'))
        .expect(404);
    });

    it('CUSTOMER A1 não consegue cancelar a reserva de A2 (403, mesma arena)', async () => {
      await request(f13App.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/${bookingA2Id}/cancel`)
        .set(...f13Auth('token-f13-a1'))
        .expect(403);
    });

    it('CUSTOMER B1 não consegue ver nem cancelar reservas da Arena A (404 / 403)', async () => {
      await request(f13App.getHttpServer())
        .get(`/v1/users/me/bookings/${bookingA1Id}`)
        .set(...f13Auth('token-f13-b1'))
        .expect(404);

      await request(f13App.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/${bookingA1Id}/cancel`)
        .set(...f13Auth('token-f13-b1'))
        .expect(403);
    });

    it('"minhas reservas" nunca confunde o timezone de uma arena com o de outra na mesma consulta', async () => {
      const resA1 = await request(f13App.getHttpServer())
        .get(`/v1/users/me/bookings/${bookingA1Id}`)
        .set(...f13Auth('token-f13-a1'))
        .expect(200);
      expect((resA1.body as MyBookingBody).court.arena.timezone).toBe('America/Sao_Paulo');

      const resB1 = await request(f13App.getHttpServer())
        .get(`/v1/users/me/bookings/${bookingB1Id}`)
        .set(...f13Auth('token-f13-b1'))
        .expect(200);
      const bodyB1 = resB1.body as MyBookingBody;
      expect(bodyB1.court.arena.timezone).toBe('America/New_York');
      // O instante persistido (14:00 -04:00 = 18:00 UTC) volta intacto —
      // nunca recalculado com um offset fixo de -05:00.
      expect(new Date(bodyB1.startsAt).toISOString()).toBe('2027-03-15T18:00:00.000Z');
    });

    it('cancelamento em Arena B (DST) funciona e libera o horário, igual à Arena A', async () => {
      await request(f13App.getHttpServer())
        .post(`/v1/arenas/${arenaBId}/courts/${courtBId}/bookings/${bookingB1Id}/cancel`)
        .set(...f13Auth('token-f13-b1'))
        .expect(200);

      const detail = await request(f13App.getHttpServer())
        .get(`/v1/users/me/bookings/${bookingB1Id}`)
        .set(...f13Auth('token-f13-b1'))
        .expect(200);
      expect((detail.body as MyBookingBody).status).toBe('CANCELLED');
    });
  });
});
