import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient, Weekday } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';
import {
  PaymentProvider,
  PaymentProviderCreateResult,
  PaymentProviderRefundResult,
  PaymentProviderStatusResult,
  ProviderRefundStatus,
} from '../src/modules/payments/providers/payment-provider';

// Fase 35, item 20 — a jornada completa (descoberta → booking → PAGAMENTO)
// nunca tinha um único teste encadeado provando que os três pedaços (já
// cobertos separadamente por `bookings.e2e-spec.ts`/`payments.e2e-spec.ts`)
// realmente se conectam de ponta a ponta. Provider fake (nunca dinheiro
// real) — mesmo padrão de `FakePaymentProvider` em `payments.e2e-spec.ts`,
// reduzido ao mínimo necessário pra esta suíte.
class FakePaymentProvider extends PaymentProvider {
  createPayment(): Promise<PaymentProviderCreateResult> {
    return Promise.resolve({
      providerPaymentId: 'mp-onboarding-fake-1',
      checkoutUrl: 'https://mp.example/checkout/onboarding-fake',
      pixCopyPaste: '00020126-onboarding-fake-pix',
      qrCodeBase64: 'ZmFrZS1vbmJvYXJkaW5nLXFy',
    });
  }

  getPaymentStatus(): Promise<PaymentProviderStatusResult> {
    return Promise.resolve({ status: 'PENDING' });
  }

  // Não exercitados nesta suíte (fora do escopo da Fase 35) — implementados
  // só porque a classe abstrata exige, mesmo padrão de qualquer fake mínimo.
  refundPayment(): Promise<PaymentProviderRefundResult> {
    return Promise.reject(new Error('refund não exercitado nesta suíte'));
  }

  getRefundStatus(): Promise<ProviderRefundStatus> {
    return Promise.reject(new Error('refund não exercitado nesta suíte'));
  }
}

// Fase 28, item 27 — prova de ponta a ponta de que a jornada de onboarding
// (OWNER cria arena → quadra → preço → horário → arena pronta) realmente
// alimenta a experiência do cliente (descoberta → disponibilidade →
// reserva), tudo pelos endpoints REAIS já validados nas fases anteriores —
// nenhum seed direto via Prisma para arena/quadra/horário/reserva em si
// (só usuários, que não têm endpoint de cadastro nesta arquitetura). Nunca
// paga de verdade (fora de escopo, item 28 do prompt).
const USER_OWNER = { clerkId: 'user_e2e_onboarding_owner', email: 'onboarding-owner@example.com' };
const USER_CUSTOMER = {
  clerkId: 'user_e2e_onboarding_customer',
  email: 'onboarding-customer@example.com',
};

const TOKENS: Record<string, string> = {
  'token-owner': USER_OWNER.clerkId,
  'token-customer': USER_CUSTOMER.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

interface ArenaBody {
  id: string;
  setupStatus?: { isReady: boolean };
}

interface CourtBody {
  id: string;
  pricePerSlot: string;
}

interface AvailabilityBody {
  slots: { startsAt: string; endsAt: string; available: boolean }[];
}

interface BookingBody {
  id: string;
  status: string;
  total: string;
  courtId: string;
}

interface PaymentBody {
  id: string;
  bookingId: string;
  status: string;
  amount: string;
  checkoutUrl: string | null;
  pixCopyPaste: string | null;
  qrCodeBase64: string | null;
}

describe('Onboarding — jornada completa OWNER → CLIENTE (e2e, Fase 28)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let arenaId: string;
  let courtId: string;
  let bookingId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    // Fase 35 — limpeza defensiva: se uma execução anterior falhou entre
    // criar o Payment do passo 7 e o `afterAll` (ex: o próprio ambiente
    // caiu no meio do teste), o Payment/Booking órfão bloquearia este
    // `deleteMany` de usuário via FK RESTRICT. Nunca confia que o `afterAll`
    // anterior rodou até o fim.
    const leftoverUsers = await prisma.user.findMany({
      where: { clerkId: { in: Object.values(TOKENS) } },
      select: { id: true },
    });
    const leftoverUserIds = leftoverUsers.map((u) => u.id);
    if (leftoverUserIds.length > 0) {
      await prisma.payment.deleteMany({ where: { userId: { in: leftoverUserIds } } });
      await prisma.booking.deleteMany({ where: { userId: { in: leftoverUserIds } } });
    }
    await prisma.arena.deleteMany({ where: { slug: 'arena-onboarding-e2e' } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.user.create({ data: USER_OWNER });
    await prisma.user.create({ data: USER_CUSTOMER });

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
      .overrideProvider(PaymentProvider)
      .useValue(new FakePaymentProvider())
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (arenaId) {
      // Payment.bookingId e Booking.courtId são RESTRICT (nunca cascade) —
      // o Payment criado no passo 7 precisa ser removido antes da Booking, e
      // a Booking antes da Arena, senão a FK barra o delete (mesma decisão
      // de arquitetura testada em outros specs).
      if (bookingId) {
        await prisma.payment.deleteMany({ where: { bookingId } });
      }
      await prisma.booking.deleteMany({ where: { courtId } });
      await prisma.arena.deleteMany({ where: { id: arenaId } });
    }
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('1. OWNER cria a arena — ainda não está pronta (sem quadra, sem horário)', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/arenas')
      .set(...authHeader('token-owner'))
      .send({
        name: 'Arena Onboarding E2E',
        slug: 'arena-onboarding-e2e',
        timezone: 'America/Sao_Paulo',
      })
      .expect(201);

    arenaId = (response.body as ArenaBody).id;
    expect(arenaId).toBeTruthy();

    const detail = await request(app.getHttpServer())
      .get(`/v1/arenas/${arenaId}`)
      .set(...authHeader('token-owner'))
      .expect(200);
    expect((detail.body as ArenaBody).setupStatus?.isReady).toBe(false);
  });

  it('2. OWNER cria a primeira quadra já com preço e duração — ainda não está pronta (sem horário)', async () => {
    const response = await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaId}/courts`)
      .set(...authHeader('token-owner'))
      .send({
        name: 'Quadra 1',
        sport: 'BEACH_VOLLEYBALL',
        pricePerSlot: 90,
        slotDurationMinutes: 60,
      })
      .expect(201);

    courtId = (response.body as CourtBody).id;
    expect((response.body as CourtBody).pricePerSlot).toBe('90');

    const detail = await request(app.getHttpServer())
      .get(`/v1/arenas/${arenaId}`)
      .set(...authHeader('token-owner'))
      .expect(200);
    expect((detail.body as ArenaBody).setupStatus?.isReady).toBe(false);
  });

  it('3. OWNER configura o horário de funcionamento — arena fica pronta', async () => {
    await request(app.getHttpServer())
      .put(`/v1/arenas/${arenaId}/operating-hours`)
      .set(...authHeader('token-owner'))
      .send({
        intervals: Object.values(Weekday).map((dayOfWeek) => ({
          dayOfWeek,
          opensAt: '00:00',
          closesAt: '23:59',
        })),
      })
      .expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/v1/arenas/${arenaId}`)
      .set(...authHeader('token-owner'))
      .expect(200);
    const body = detail.body as ArenaBody & {
      setupStatus: {
        hasBasicInfo: boolean;
        hasActiveCourtWithPricing: boolean;
        hasOperatingHours: boolean;
        isReady: boolean;
      };
    };
    expect(body.setupStatus).toEqual({
      hasBasicInfo: true,
      hasActiveCourtWithPricing: true,
      hasOperatingHours: true,
      isReady: true,
    });
  });

  it('4. CLIENTE descobre a arena pronta (isReady=true), sem precisar ser membro', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/arenas/discover/${arenaId}`)
      .set(...authHeader('token-customer'))
      .expect(200);

    const body = response.body as { isReady: boolean; courts: { id: string }[] };
    expect(body.isReady).toBe(true);
    expect(body.courts.map((c) => c.id)).toContain(courtId);
  });

  it('5. CLIENTE vê disponibilidade real da quadra configurada pelo OWNER', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/arenas/${arenaId}/courts/${courtId}/availability`)
      .query({ from: '2027-06-01T00:00:00-03:00', to: '2027-06-01T12:00:00-03:00' })
      .set(...authHeader('token-customer'))
      .expect(200);

    const body = response.body as AvailabilityBody;
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots.every((slot) => slot.available)).toBe(true);
  });

  it('6a. CLIENTE tentando forjar total/userId/status no corpo é rejeitado (400) — o DTO nem aceita esses campos (Caso 14)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaId}/courts/${courtId}/bookings`)
      .set(...authHeader('token-customer'))
      .set('Idempotency-Key', 'onboarding-journey-booking-mass-assignment')
      .send({
        startsAt: '2027-06-01T09:00:00-03:00',
        total: 999999,
        userId: 'outro-usuario',
        status: 'CANCELLED',
      })
      .expect(400);
  });

  it('6b. CLIENTE cria a reserva com o corpo válido — total vem sempre do preço configurado no passo 2 (Caso 14)', async () => {
    const response = await request(app.getHttpServer())
      .post(`/v1/arenas/${arenaId}/courts/${courtId}/bookings`)
      .set(...authHeader('token-customer'))
      .set('Idempotency-Key', 'onboarding-journey-booking-1')
      .send({ startsAt: '2027-06-01T09:00:00-03:00' })
      .expect(201);

    const body = response.body as BookingBody;
    expect(body.status).toBe('CONFIRMED');
    expect(body.total).toBe('90'); // exatamente o pricePerSlot configurado no passo 2
    expect(body.courtId).toBe(courtId);
    bookingId = body.id;
  });

  // Fase 35, item 20 — fecha o elo que faltava: a MESMA reserva criada no
  // passo 6b (nunca uma nova, nunca um seed direto) segue pro pagamento,
  // provando que Booking → Payment realmente se conectam nesta jornada
  // ponta a ponta (provider FAKE — nunca dinheiro real; a integração real
  // com o gateway já é validada separadamente em `payments.e2e-spec.ts`).
  it('7. CLIENTE cria o pagamento PIX da MESMA reserva — valor exatamente igual ao total da Booking', async () => {
    const response = await request(app.getHttpServer())
      .post(`/v1/users/me/bookings/${bookingId}/payments`)
      .set(...authHeader('token-customer'))
      .set('Idempotency-Key', 'onboarding-journey-payment-1')
      .expect(201);

    const body = response.body as PaymentBody;
    expect(body.bookingId).toBe(bookingId);
    expect(body.status).toBe('PENDING');
    expect(body.amount).toBe('90'); // idêntico ao total da Booking do passo 6b, nunca outro valor
    expect(body.checkoutUrl).toBeTruthy();
    expect(body.pixCopyPaste).toBeTruthy();
    expect(body.qrCodeBase64).toBeTruthy();
  });

  it('8. CLIENTE consulta o pagamento e vê o MESMO estado PENDING — nunca aprovado sem confirmação real', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/users/me/bookings/${bookingId}/payment`)
      .set(...authHeader('token-customer'))
      .expect(200);

    const body = response.body as PaymentBody;
    expect(body.bookingId).toBe(bookingId);
    expect(body.status).toBe('PENDING'); // nunca PAID sem um webhook real confirmando
  });

  it('9. OUTRO cliente (não dono da reserva) nunca consegue ver nem criar pagamento para ela — 404, nunca 403 (IDOR)', async () => {
    const another = { clerkId: 'user_e2e_onboarding_other', email: 'onboarding-other@example.com' };
    await prisma.user.deleteMany({ where: { clerkId: another.clerkId } });
    await prisma.user.create({ data: another });
    // Reaproveita o mesmo mecanismo de resolução de token de teste do
    // beforeAll (a closure de `ClerkService.verifySessionToken` lê `TOKENS`
    // por referência) — só adiciona este token novo em tempo de teste.
    TOKENS['token-other'] = another.clerkId;

    await request(app.getHttpServer())
      .get(`/v1/users/me/bookings/${bookingId}/payment`)
      .set(...authHeader('token-other'))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/v1/users/me/bookings/${bookingId}/payments`)
      .set(...authHeader('token-other'))
      .set('Idempotency-Key', 'onboarding-journey-payment-idor-attempt')
      .expect(404);

    await prisma.user.deleteMany({ where: { clerkId: another.clerkId } });
  });
});
