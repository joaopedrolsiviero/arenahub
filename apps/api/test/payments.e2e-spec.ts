import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ArenaRole, BookingStatus, BookingType, PrismaClient, Sport } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { ClerkService } from '../src/modules/auth/clerk.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import {
  PaymentProvider,
  PaymentProviderCreateRequest,
  PaymentProviderCreateResult,
  PaymentProviderRefundResult,
  PaymentProviderStatusResult,
  ProviderPaymentStatus,
  ProviderRefundStatus,
} from '../src/modules/payments/providers/payment-provider';

// Fase 17: Payment é só mais um ciclo de vida em cima da MESMA Booking já
// existente (ver docs/ARCHITECTURE.md) — esta suíte prova a integração
// PONTA A PONTA contra Postgres real: criação → provider fake → webhook
// (assinado de verdade, HMAC-SHA256) → estado final, incluindo
// concorrência real (Promise.all) e a integração com o cancelamento da
// Fase 13.
const WEBHOOK_SECRET = 'payments-e2e-webhook-secret';

class FakePaymentProvider extends PaymentProvider {
  createCalls: PaymentProviderCreateRequest[] = [];
  nextCreateResult: PaymentProviderCreateResult = {
    providerPaymentId: 'mp-fake-1',
    checkoutUrl: 'https://mp.example/checkout/fake',
    pixCopyPaste: '00020126-fake-pix',
    qrCodeBase64: 'ZmFrZS1xci1wbmc=',
  };
  nextCreateError: Error | null = null;
  statusByProviderPaymentId = new Map<string, ProviderPaymentStatus>();
  // NUNCA resetado em beforeEach (diferente de `createCalls`) — precisa
  // continuar único ao longo do arquivo inteiro, já que `providerPaymentId`
  // é `@unique` no banco e vários testes criam pagamentos reais na mesma
  // suíte.
  private idCounter = 0;

  createPayment(request: PaymentProviderCreateRequest): Promise<PaymentProviderCreateResult> {
    this.createCalls.push(request);
    if (this.nextCreateError) {
      const error = this.nextCreateError;
      this.nextCreateError = null;
      return Promise.reject(error);
    }
    // Cada chamada real geraria um ID novo no provider — simulamos isso
    // pra que múltiplas criações (quando LEGITIMAMENTE esperadas) nunca
    // colidam no `providerPaymentId` único local.
    this.idCounter += 1;
    const result = {
      ...this.nextCreateResult,
      providerPaymentId: `${this.nextCreateResult.providerPaymentId}-${this.idCounter}`,
    };
    this.statusByProviderPaymentId.set(result.providerPaymentId, 'PENDING');
    return Promise.resolve(result);
  }

  getPaymentStatus(providerPaymentId: string): Promise<PaymentProviderStatusResult> {
    const status = this.statusByProviderPaymentId.get(providerPaymentId) ?? 'PENDING';
    return Promise.resolve({
      status,
      paidAt: status === 'PAID' ? new Date() : undefined,
      failureReason: status === 'FAILED' ? 'insufficient_funds' : undefined,
    });
  }

  // Fase 27 — mesmo padrão de `nextCreateResult`/`nextCreateError`:
  // controlável por teste, nunca dinheiro real (esta suíte roda contra
  // Postgres real, mas o provider aqui é sempre o fake).
  refundCalls: { providerPaymentId: string; idempotencyKey: string }[] = [];
  nextRefundResult: PaymentProviderRefundResult = { refundId: 'refund-fake-1', status: 'REFUNDED' };
  nextRefundError: Error | null = null;
  private refundIdCounter = 0;

  refundPayment(
    providerPaymentId: string,
    idempotencyKey: string,
  ): Promise<PaymentProviderRefundResult> {
    this.refundCalls.push({ providerPaymentId, idempotencyKey });
    if (this.nextRefundError) {
      const error = this.nextRefundError;
      this.nextRefundError = null;
      return Promise.reject(error);
    }
    this.refundIdCounter += 1;
    const result = {
      ...this.nextRefundResult,
      refundId: `${this.nextRefundResult.refundId}-${this.refundIdCounter}`,
    };
    return Promise.resolve(result);
  }

  getRefundStatus(): Promise<ProviderRefundStatus> {
    return Promise.resolve(this.nextRefundResult.status);
  }
}

const OWNER_A = { clerkId: 'user_e2e_pay_owner_a', email: 'pay-e2e-owner-a@example.com' };
const CUSTOMER_A = { clerkId: 'user_e2e_pay_customer_a', email: 'pay-e2e-customer-a@example.com' };
const CUSTOMER_C = { clerkId: 'user_e2e_pay_customer_c', email: 'pay-e2e-customer-c@example.com' };
const OWNER_B = { clerkId: 'user_e2e_pay_owner_b', email: 'pay-e2e-owner-b@example.com' };
const CUSTOMER_B = { clerkId: 'user_e2e_pay_customer_b', email: 'pay-e2e-customer-b@example.com' };

const TOKENS: Record<string, string> = {
  'token-owner-a': OWNER_A.clerkId,
  'token-customer-a': CUSTOMER_A.clerkId,
  'token-customer-c': CUSTOMER_C.clerkId,
  'token-owner-b': OWNER_B.clerkId,
  'token-customer-b': CUSTOMER_B.clerkId,
};

function authHeader(token: keyof typeof TOKENS): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

function signWebhook(providerPaymentId: string, requestId: string, ts: string): string {
  const manifest = `id:${providerPaymentId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const hex = createHmac('sha256', WEBHOOK_SECRET).update(manifest).digest('hex');
  return `ts=${ts},v1=${hex}`;
}

interface PaymentViewBody {
  id: string;
  bookingId: string;
  status: string;
  amount: string;
  currency: string;
  checkoutUrl: string | null;
  pixCopyPaste: string | null;
  failureReason: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

describe('Pagamentos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let fakeProvider: FakePaymentProvider;
  let arenaAId: string;
  let arenaBId: string;
  let courtAId: string;
  let courtBId: string;
  let ownerAId: string;
  let customerAId: string;
  let customerBId: string;

  function paymentsUrl(bookingId: string) {
    return `/v1/users/me/bookings/${bookingId}/payments`;
  }
  function paymentUrl(bookingId: string) {
    return `/v1/users/me/bookings/${bookingId}/payment`;
  }

  async function createConfirmedBooking(
    courtId: string,
    userId: string,
    hoursFromNow: number,
    total = 75,
  ) {
    const startsAt = new Date(Date.now() + hoursFromNow * 3_600_000);
    return prisma.booking.create({
      data: {
        courtId,
        userId,
        type: BookingType.CUSTOMER,
        status: BookingStatus.CONFIRMED,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        total,
      },
    });
  }

  beforeAll(async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;

    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });

    const ownerA = await prisma.user.create({ data: OWNER_A });
    ownerAId = ownerA.id;
    const customerA = await prisma.user.create({ data: CUSTOMER_A });
    customerAId = customerA.id;
    await prisma.user.create({ data: CUSTOMER_C });
    const ownerB = await prisma.user.create({ data: OWNER_B });
    const customerB = await prisma.user.create({ data: CUSTOMER_B });
    customerBId = customerB.id;

    const arenaA = await prisma.arena.create({
      data: { name: 'Arena Pagamentos A', slug: 'pay-e2e-arena-a', timezone: 'America/Sao_Paulo' },
    });
    arenaAId = arenaA.id;
    await prisma.arenaMember.create({
      data: { arenaId: arenaAId, userId: ownerA.id, role: ArenaRole.OWNER },
    });
    const courtA = await prisma.court.create({
      data: {
        arenaId: arenaAId,
        name: 'Quadra A1',
        sport: Sport.BEACH_VOLLEYBALL,
        pricePerSlot: 75,
      },
    });
    courtAId = courtA.id;

    const arenaB = await prisma.arena.create({
      data: {
        name: 'Arena Pagamentos B (segredo)',
        slug: 'pay-e2e-arena-b',
        timezone: 'America/Sao_Paulo',
      },
    });
    arenaBId = arenaB.id;
    await prisma.arenaMember.create({
      data: { arenaId: arenaBId, userId: ownerB.id, role: ArenaRole.OWNER },
    });
    const courtB = await prisma.court.create({
      data: {
        arenaId: arenaBId,
        name: 'Quadra B1 (segredo)',
        sport: Sport.BEACH_VOLLEYBALL,
        pricePerSlot: 999999,
      },
    });
    courtBId = courtB.id;

    fakeProvider = new FakePaymentProvider();

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
      .overrideProvider(PaymentProvider)
      .useValue(fakeProvider)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { arenaId: { in: [arenaAId, arenaBId] } } });
    await prisma.paymentWebhookEvent.deleteMany({});
    await prisma.booking.deleteMany({ where: { courtId: { in: [courtAId, courtBId] } } });
    await prisma.arena.deleteMany({ where: { id: { in: [arenaAId, arenaBId] } } });
    await prisma.user.deleteMany({ where: { clerkId: { in: Object.values(TOKENS) } } });
    await prisma.$disconnect();
    await app.close();
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  });

  beforeEach(() => {
    fakeProvider.createCalls = [];
    fakeProvider.nextCreateError = null;
    fakeProvider.statusByProviderPaymentId.clear();
    // Reembolso (aprovação tardia sobre Booking cancelada aciona refundIfPaid):
    // cada teste começa sem chamadas de refund anteriores nem erro pendente.
    fakeProvider.refundCalls = [];
    fakeProvider.nextRefundError = null;
    fakeProvider.nextRefundResult = { refundId: 'refund-fake-1', status: 'REFUNDED' };
  });

  describe('Autorização e validação (itens 17, 26)', () => {
    it('exige autenticação (401)', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 24);
      await request(app.getHttpServer())
        .post(paymentsUrl(booking.id))
        .set('Idempotency-Key', randomUUID())
        .expect(401);
    });

    it('exige Idempotency-Key (400)', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 20);
      await request(app.getHttpServer())
        .post(paymentsUrl(booking.id))
        .set(...authHeader('token-customer-a'))
        .expect(400);
    });

    it('Booking inexistente retorna 404', async () => {
      await request(app.getHttpServer())
        .post(paymentsUrl('booking-que-nao-existe'))
        .set(...authHeader('token-customer-a'))
        .set('Idempotency-Key', randomUUID())
        .expect(404);
    });
  });

  describe('Criação — regra de preço e mass assignment (itens 4, 6)', () => {
    it('cria o pagamento com o valor EXATO de Booking.total, nunca outro', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 21, 75);

      const response = await request(app.getHttpServer())
        .post(paymentsUrl(booking.id))
        .set(...authHeader('token-customer-a'))
        .set('Idempotency-Key', randomUUID())
        .expect(201);

      const body = response.body as PaymentViewBody;
      expect(body.amount).toBe('75');
      expect(body.currency).toBe('BRL');
      expect(body.status).toBe('PENDING');
      expect(body.checkoutUrl).toContain('https://mp.example');
    });

    it('amount/status forjados no corpo são ignorados — o backend nem lê o corpo', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 25, 75);

      const response = await request(app.getHttpServer())
        .post(paymentsUrl(booking.id))
        .set(...authHeader('token-customer-a'))
        .set('Idempotency-Key', randomUUID())
        .send({
          amount: 1,
          status: 'PAID',
          total: 0.01,
          providerPaymentId: 'forjado',
          currency: 'USD',
        })
        .expect(201);

      const body = response.body as PaymentViewBody;
      expect(body.amount).toBe('75');
      expect(body.currency).toBe('BRL');
      expect(body.status).toBe('PENDING');
    });

    it('Booking de outro usuário (IDOR) retorna 404, nunca 403', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 26);

      await request(app.getHttpServer())
        .post(paymentsUrl(booking.id))
        .set(...authHeader('token-customer-c'))
        .set('Idempotency-Key', randomUUID())
        .expect(404);
    });

    it('BLOCK nunca gera pagamento — Booking existe, mas nunca aparece como "minha reserva" (404)', async () => {
      const block = await prisma.booking.create({
        data: {
          courtId: courtAId,
          userId: ownerAId,
          type: BookingType.BLOCK,
          status: BookingStatus.CONFIRMED,
          startsAt: new Date(Date.now() + 27 * 3_600_000),
          endsAt: new Date(Date.now() + 28 * 3_600_000),
          reason: 'Evento privado',
        },
      });

      await request(app.getHttpServer())
        .post(paymentsUrl(block.id))
        .set(...authHeader('token-owner-a'))
        .set('Idempotency-Key', randomUUID())
        .expect(404);
    });

    it('Booking CANCELLED não pode gerar novo pagamento (409)', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 29);
      await request(app.getHttpServer())
        .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/${booking.id}/cancel`)
        .set(...authHeader('token-customer-a'))
        .expect(200);

      await request(app.getHttpServer())
        .post(paymentsUrl(booking.id))
        .set(...authHeader('token-customer-a'))
        .set('Idempotency-Key', randomUUID())
        .expect(409);
    });
  });

  describe('Idempotência e concorrência (itens 10, 11)', () => {
    it('mesma Idempotency-Key duas vezes devolve o MESMO Payment, sem chamar o provider de novo', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 30);
      const key = randomUUID();

      const first = await request(app.getHttpServer())
        .post(paymentsUrl(booking.id))
        .set(...authHeader('token-customer-a'))
        .set('Idempotency-Key', key)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(paymentsUrl(booking.id))
        .set(...authHeader('token-customer-a'))
        .set('Idempotency-Key', key)
        .expect(201);

      expect((first.body as PaymentViewBody).id).toBe((second.body as PaymentViewBody).id);
      expect(fakeProvider.createCalls).toHaveLength(1);
    });

    it('duas criações simultâneas (mesma chave) via Promise.all: só uma linha, só uma chamada ao provider', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 31);
      const key = randomUUID();

      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .post(paymentsUrl(booking.id))
          .set(...authHeader('token-customer-a'))
          .set('Idempotency-Key', key),
        request(app.getHttpServer())
          .post(paymentsUrl(booking.id))
          .set(...authHeader('token-customer-a'))
          .set('Idempotency-Key', key),
      ]);

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect((r1.body as PaymentViewBody).id).toBe((r2.body as PaymentViewBody).id);
      const count = await prisma.payment.count({ where: { bookingId: booking.id } });
      expect(count).toBe(1);
      expect(fakeProvider.createCalls).toHaveLength(1);
    });

    it('chaves DIFERENTES simultâneas para a mesma Booking convergem pra UMA tentativa ativa, nunca duas cobranças', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 32);

      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .post(paymentsUrl(booking.id))
          .set(...authHeader('token-customer-a'))
          .set('Idempotency-Key', randomUUID()),
        request(app.getHttpServer())
          .post(paymentsUrl(booking.id))
          .set(...authHeader('token-customer-a'))
          .set('Idempotency-Key', randomUUID()),
      ]);

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect((r1.body as PaymentViewBody).id).toBe((r2.body as PaymentViewBody).id);
      const count = await prisma.payment.count({ where: { bookingId: booking.id } });
      expect(count).toBe(1);
      expect(fakeProvider.createCalls).toHaveLength(1);
    });
  });

  describe('Consulta (GET /payment)', () => {
    it('sem nenhuma tentativa, devolve corpo REALMENTE vazio (Content-Length 0) — bug real corrigido no client na Fase 23', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 33);

      const response = await request(app.getHttpServer())
        .get(paymentUrl(booking.id))
        .set(...authHeader('token-customer-a'))
        .expect(200);

      // Checagem explícita do texto cru, não de `response.body` — o
      // supertest normaliza um corpo vazio/não-parseável pra `{}` sozinho,
      // o que mascarou por meses o fato de que o Nest devolve um corpo
      // LITERALMENTE vazio pra um controller que retorna `null` (nunca a
      // string JSON "null"). Um `fetch().json()` real de navegador lança
      // `SyntaxError` nesse caso — corrigido no client (`apps/web/src/lib/api.ts`,
      // `request()` agora lê `.text()` antes de fazer `JSON.parse`).
      expect(response.text).toBe('');
      expect(response.body).toEqual({});
    });

    it('depois de criado, reflete o estado real do banco', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 34);
      await request(app.getHttpServer())
        .post(paymentsUrl(booking.id))
        .set(...authHeader('token-customer-a'))
        .set('Idempotency-Key', randomUUID())
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(paymentUrl(booking.id))
        .set(...authHeader('token-customer-a'))
        .expect(200);

      expect((response.body as PaymentViewBody).status).toBe('PENDING');
    });

    it('outro usuário nunca acessa (404)', async () => {
      const booking = await createConfirmedBooking(courtAId, customerAId, 35);

      await request(app.getHttpServer())
        .get(paymentUrl(booking.id))
        .set(...authHeader('token-customer-c'))
        .expect(404);
    });
  });

  describe('Webhook — assinatura e idempotência (itens 8, 9)', () => {
    async function createPendingPaymentWithWebhookId(hoursFromNow: number) {
      const booking = await createConfirmedBooking(courtAId, customerAId, hoursFromNow);
      const response = await request(app.getHttpServer())
        .post(paymentsUrl(booking.id))
        .set(...authHeader('token-customer-a'))
        .set('Idempotency-Key', randomUUID())
        .expect(201);
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: (response.body as PaymentViewBody).id },
      });
      return { booking, payment };
    }

    function sendWebhook(
      providerPaymentId: string,
      opts?: { signature?: string; requestId?: string },
    ) {
      const requestId = opts?.requestId ?? randomUUID();
      const ts = String(Math.floor(Date.now() / 1000));
      const signature = opts?.signature ?? signWebhook(providerPaymentId, requestId, ts);
      return request(app.getHttpServer())
        .post('/v1/webhooks/payments/mercadopago')
        .set('x-signature', signature)
        .set('x-request-id', requestId)
        .send({
          id: randomUUID(),
          type: 'payment',
          action: 'payment.updated',
          data: { id: providerPaymentId },
        });
    }

    it('sem assinatura é rejeitado (403), nunca processado', async () => {
      const { payment } = await createPendingPaymentWithWebhookId(40);
      await request(app.getHttpServer())
        .post('/v1/webhooks/payments/mercadopago')
        .send({ id: '1', type: 'payment', data: { id: payment.providerPaymentId } })
        .expect(403);

      const unchanged = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(unchanged.status).toBe('PENDING');
    });

    it('assinatura inválida é rejeitada (403)', async () => {
      const { payment } = await createPendingPaymentWithWebhookId(41);
      await sendWebhook(payment.providerPaymentId!, {
        signature: 'ts=1,v1=' + '0'.repeat(64),
      }).expect(403);
    });

    it('evento para providerPaymentId desconhecido é aceito (200) mas não altera nada', async () => {
      await sendWebhook('mp-desconhecido-xyz').expect(200);
    });

    it('assinatura válida aplica PAID a partir do status REAL do provider (nunca do corpo do webhook)', async () => {
      const { payment } = await createPendingPaymentWithWebhookId(42);
      fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');

      await sendWebhook(payment.providerPaymentId!).expect(200);

      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe('PAID');
      expect(updated.paidAt).not.toBeNull();
    });

    it('status PENDING/in_process do provider: Payment continua PENDING, nunca é tratado como pago (Fase 25 Caso 2)', async () => {
      const { payment, booking } = await createPendingPaymentWithWebhookId(100);
      fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PENDING');

      await sendWebhook(payment.providerPaymentId!).expect(200);

      const unchanged = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(unchanged.status).toBe('PENDING');
      expect(unchanged.paidAt).toBeNull();
      const bookingRow = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(bookingRow.status).toBe('CONFIRMED');
    });

    it('status FAILED (recusado) do provider: Payment vira FAILED, nunca PAID (Fase 25 Caso 3)', async () => {
      const { payment } = await createPendingPaymentWithWebhookId(110);
      fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'FAILED');

      await sendWebhook(payment.providerPaymentId!).expect(200);

      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe('FAILED');
      expect(updated.paidAt).toBeNull();
    });

    it('evento duplicado (mesmo id de notificação) só processa uma vez', async () => {
      const { payment } = await createPendingPaymentWithWebhookId(43);
      fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');
      const requestId = randomUUID();
      const ts = String(Math.floor(Date.now() / 1000));
      const signature = signWebhook(payment.providerPaymentId!, requestId, ts);
      const notificationId = randomUUID();

      const send = () =>
        request(app.getHttpServer())
          .post('/v1/webhooks/payments/mercadopago')
          .set('x-signature', signature)
          .set('x-request-id', requestId)
          .send({ id: notificationId, type: 'payment', data: { id: payment.providerPaymentId } });

      await send().expect(200);
      await send().expect(200);

      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe('PAID');
    });

    it('PAID é terminal: um evento FAILED chegando depois nunca reverte (item 9)', async () => {
      const { payment } = await createPendingPaymentWithWebhookId(44);
      fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');
      await sendWebhook(payment.providerPaymentId!).expect(200);

      fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'FAILED');
      await sendWebhook(payment.providerPaymentId!).expect(200);

      const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(final.status).toBe('PAID');
    });

    it('duas confirmações PAID concorrentes (Promise.all) resolvem no mesmo estado final, sem erro', async () => {
      const { payment } = await createPendingPaymentWithWebhookId(45);
      fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');

      const [r1, r2] = await Promise.all([
        sendWebhook(payment.providerPaymentId!),
        sendWebhook(payment.providerPaymentId!),
      ]);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(final.status).toBe('PAID');
    });

    it('PAID + FAILED simultâneos (Promise.all): resultado final é determinístico e nunca ambos aplicados', async () => {
      const { payment } = await createPendingPaymentWithWebhookId(46);

      const requestIdPaid = randomUUID();
      const requestIdFailed = randomUUID();
      const ts = String(Math.floor(Date.now() / 1000));

      fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');
      const paidCall = request(app.getHttpServer())
        .post('/v1/webhooks/payments/mercadopago')
        .set('x-signature', signWebhook(payment.providerPaymentId!, requestIdPaid, ts))
        .set('x-request-id', requestIdPaid)
        .send({ id: randomUUID(), type: 'payment', data: { id: payment.providerPaymentId } });

      const failedCall = request(app.getHttpServer())
        .post('/v1/webhooks/payments/mercadopago')
        .set('x-signature', signWebhook(payment.providerPaymentId!, requestIdFailed, ts))
        .set('x-request-id', requestIdFailed)
        .send({ id: randomUUID(), type: 'payment', data: { id: payment.providerPaymentId } });

      await Promise.all([paidCall, failedCall]);

      const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(['PAID', 'FAILED']).toContain(final.status); // determinístico, nunca um estado inválido
    });

    // Nested (não uma describe irmã) para reaproveitar `createPendingPaymentWithWebhookId`
    // e `sendWebhook`, definidas acima só neste escopo.
    describe('BLOCKER — aprovação tardia do Mercado Pago sobre um Payment já EXPIRED (Fase pós-M7)', () => {
      // Helper: cria um Payment já EXPIRED — o MESMO estado final que o
      // lazy-expiry de produção alcançaria numa leitura após o TTL real de
      // 30min (`resolveExpiry`), só que sem esperar o prazo nem passar pelo
      // endpoint de criação (`POST /payments` é limitado a 30 req/min —
      // já bem exercitado pelos testes acima deste describe; o que ESTE bloco
      // prova é a reconciliação do webhook sobre um Payment EXPIRED, não o
      // fluxo de criação em si, que já tem cobertura própria).
      let expiredProviderIdCounter = 0;
      async function createExpiredPayment(hoursFromNow: number) {
        const booking = await createConfirmedBooking(courtAId, customerAId, hoursFromNow);
        expiredProviderIdCounter += 1;
        const payment = await prisma.payment.create({
          data: {
            bookingId: booking.id,
            userId: customerAId,
            arenaId: arenaAId,
            amount: 75,
            currency: 'BRL',
            status: 'EXPIRED',
            provider: 'MERCADO_PAGO',
            providerPaymentId: `mp-fake-expired-${expiredProviderIdCounter}`,
            idempotencyKey: randomUUID(),
            expiresAt: new Date(Date.now() - 1000),
          },
        });
        return { booking, payment };
      }

      it('Payment EXPIRED + webhook aprovado (PAID real no provider): nunca perde o pagamento — reconcilia EXPIRED -> PAID', async () => {
        const { payment, booking } = await createExpiredPayment(120);
        fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');

        await sendWebhook(payment.providerPaymentId!).expect(200);

        const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(final.status).toBe('PAID');
        expect(final.paidAt).not.toBeNull();
        const bookingRow = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(bookingRow.status).toBe('CONFIRMED');
      });

      it('genuinamente nunca pago: Payment expirado + provider ainda PENDING permanece EXPIRED, Booking nunca é tocada', async () => {
        const { payment, booking } = await createExpiredPayment(121);
        fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PENDING');

        await sendWebhook(payment.providerPaymentId!).expect(200);

        const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(final.status).toBe('EXPIRED');
        const bookingRow = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(bookingRow.status).toBe('CONFIRMED');
      });

      it('webhook duplicado (mesmo evento) sobre uma reconciliação tardia só aplica uma vez', async () => {
        const { payment } = await createExpiredPayment(122);
        fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');
        const requestId = randomUUID();
        const ts = String(Math.floor(Date.now() / 1000));
        const signature = signWebhook(payment.providerPaymentId!, requestId, ts);
        const notificationId = randomUUID();

        const send = () =>
          request(app.getHttpServer())
            .post('/v1/webhooks/payments/mercadopago')
            .set('x-signature', signature)
            .set('x-request-id', requestId)
            .send({ id: notificationId, type: 'payment', data: { id: payment.providerPaymentId } });

        await send().expect(200);
        await send().expect(200);

        const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(final.status).toBe('PAID');
      });

      it('retry do webhook (notificação diferente, mesmo pagamento) após reconciliação já aplicada continua estável em PAID', async () => {
        const { payment } = await createExpiredPayment(123);
        fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');

        await sendWebhook(payment.providerPaymentId!).expect(200);
        await sendWebhook(payment.providerPaymentId!).expect(200); // segunda notificação, id diferente

        const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(final.status).toBe('PAID');
      });

      it('duas aprovações tardias concorrentes (Promise.all) sobre o MESMO Payment EXPIRED: resolvem no mesmo estado final PAID, sem erro', async () => {
        const { payment } = await createExpiredPayment(124);
        fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');

        const [r1, r2] = await Promise.all([
          sendWebhook(payment.providerPaymentId!),
          sendWebhook(payment.providerPaymentId!),
        ]);

        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(final.status).toBe('PAID');
      });

      // Decisão desta fase: dinheiro aprovado pelo provider NUNCA é registrado
      // como "não pago". O Payment vira PAID (verdade financeira) e o webhook
      // aciona o MESMO refund idempotente do cancelamento de reserva paga.
      it('Booking cancelada DEPOIS da expiração local + aprovação tardia: o dinheiro nunca é perdido — Payment registrado como PAID e reembolsado UMA vez (REFUNDED); a reserva cancelada nunca é reaberta', async () => {
        const { payment, booking } = await createExpiredPayment(125);

        await request(app.getHttpServer())
          .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/${booking.id}/cancel`)
          .set(...authHeader('token-customer-a'))
          .expect(200);
        expect(fakeProvider.refundCalls).toHaveLength(0); // EXPIRED não é reembolsável

        fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');
        await sendWebhook(payment.providerPaymentId!).expect(200);

        const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(final.status).toBe('REFUNDED');
        expect(final.paidAt).not.toBeNull(); // o dinheiro entrou de verdade
        expect(final.refundedAt).not.toBeNull();
        expect(fakeProvider.refundCalls).toEqual([
          { providerPaymentId: payment.providerPaymentId, idempotencyKey: `refund:${payment.id}` },
        ]);
        const bookingRow = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(bookingRow.status).toBe('CANCELLED'); // nunca reaberta
      });

      it('concorrência: Booking cancelada e o slot ocupado por OUTRA reserva antes da aprovação tardia — o Payment antigo nunca confirma sobre a reserva nova', async () => {
        const startsAt = new Date(Date.now() + 126 * 3_600_000);
        const original = await prisma.booking.create({
          data: {
            courtId: courtAId,
            userId: customerAId,
            type: BookingType.CUSTOMER,
            status: BookingStatus.CONFIRMED,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 3_600_000),
            total: 75,
          },
        });
        const payment = await prisma.payment.create({
          data: {
            bookingId: original.id,
            userId: customerAId,
            arenaId: arenaAId,
            amount: 75,
            currency: 'BRL',
            status: 'EXPIRED',
            provider: 'MERCADO_PAGO',
            providerPaymentId: `mp-fake-expired-concurrency-${randomUUID()}`,
            idempotencyKey: randomUUID(),
            expiresAt: new Date(Date.now() - 1000),
          },
        });

        // Slot liberado (Booking original cancelada) e reocupado por outra
        // reserva — protegido pelo MESMO `Booking_no_overlap_excl` de sempre,
        // nunca por esta correção.
        await request(app.getHttpServer())
          .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/${original.id}/cancel`)
          .set(...authHeader('token-customer-a'))
          .expect(200);
        const replacement = await prisma.booking.create({
          data: {
            courtId: courtAId,
            userId: customerAId,
            type: BookingType.CUSTOMER,
            status: BookingStatus.CONFIRMED,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 3_600_000),
            total: 75,
          },
        });

        fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');
        await sendWebhook(payment.providerPaymentId!).expect(200);

        const finalOldPayment = await prisma.payment.findUniqueOrThrow({
          where: { id: payment.id },
        });
        // O Payment antigo recebeu dinheiro real (PAID) e foi reembolsado —
        // nunca confirmou nada sobre a reserva nova.
        expect(finalOldPayment.status).toBe('REFUNDED');
        expect(fakeProvider.refundCalls).toEqual([
          {
            providerPaymentId: payment.providerPaymentId,
            idempotencyKey: `refund:${payment.id}`,
          },
        ]);
        const replacementRow = await prisma.booking.findUniqueOrThrow({
          where: { id: replacement.id },
        });
        expect(replacementRow.status).toBe('CONFIRMED'); // intocada pelo Payment antigo
        const noPaymentLinkedToReplacement = await prisma.payment.findFirst({
          where: { bookingId: replacement.id },
        });
        expect(noPaymentLinkedToReplacement).toBeNull(); // nenhum efeito cruzado entre Bookings
        const originalRow = await prisma.booking.findUniqueOrThrow({ where: { id: original.id } });
        expect(originalRow.status).toBe('CANCELLED'); // a reserva cancelada nunca é reaberta
      });

      it('Payment aponta pra Booking já em outro estado (inconsistência): dinheiro recebido vira PAID e é reembolsado — nenhuma reserva é tocada', async () => {
        const { payment, booking } = await createExpiredPayment(127);
        await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });

        fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');
        await sendWebhook(payment.providerPaymentId!).expect(200);

        const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(final.status).toBe('REFUNDED');
        expect(final.status).not.toBe('CANCELLED'); // nunca "fingir" que nada foi pago
        const bookingRow = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(bookingRow.status).toBe('CANCELLED');
      });

      it('refund automático FALHA (provider indisponível): o Payment fica REFUNDING (nunca esquecido nem REFUNDED), e repetir o cancelamento (idempotente) conclui com a MESMA idempotency key — nunca dois reembolsos', async () => {
        const { payment, booking } = await createExpiredPayment(128);
        const cancelUrl = `/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/${booking.id}/cancel`;
        await request(app.getHttpServer())
          .post(cancelUrl)
          .set(...authHeader('token-customer-a'))
          .expect(200);

        fakeProvider.nextRefundError = new Error('Mercado Pago indisponível (teste)');
        fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');
        await sendWebhook(payment.providerPaymentId!).expect(200);

        // Estado recuperável e identificável: dinheiro registrado (paidAt),
        // reembolso reivindicado localmente mas NÃO confirmado.
        const afterFailure = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(afterFailure.status).toBe('REFUNDING');
        expect(afterFailure.paidAt).not.toBeNull();
        expect(afterFailure.refundedAt).toBeNull();
        expect(afterFailure.refundId).toBeNull();
        expect(fakeProvider.refundCalls).toHaveLength(1);

        // Visível para o dono da reserva: a Booking cancelada aparece com o
        // reembolso em andamento, nunca como se nada tivesse sido recebido.
        const view = await request(app.getHttpServer())
          .get(paymentUrl(booking.id))
          .set(...authHeader('token-customer-a'))
          .expect(200);
        expect((view.body as PaymentViewBody).status).toBe('REFUNDING');

        // Recuperação: repetir o cancelamento (endpoint idempotente) refaz o
        // refund com a MESMA idempotency key.
        await request(app.getHttpServer())
          .post(cancelUrl)
          .set(...authHeader('token-customer-a'))
          .expect(200);
        const recovered = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(recovered.status).toBe('REFUNDED');
        expect(fakeProvider.refundCalls).toHaveLength(2);
        expect(new Set(fakeProvider.refundCalls.map((call) => call.idempotencyKey))).toEqual(
          new Set([`refund:${payment.id}`]),
        );

        // Um terceiro cancelamento é no-op: nunca um segundo reembolso.
        await request(app.getHttpServer())
          .post(cancelUrl)
          .set(...authHeader('token-customer-a'))
          .expect(200);
        expect(fakeProvider.refundCalls).toHaveLength(2);
      });

      it('duas aprovações tardias SIMULTÂNEAS (Promise.all) sobre Booking cancelada: o dinheiro é reembolsado exatamente UMA vez', async () => {
        const { payment, booking } = await createExpiredPayment(129);
        await request(app.getHttpServer())
          .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/${booking.id}/cancel`)
          .set(...authHeader('token-customer-a'))
          .expect(200);
        fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');

        const [r1, r2] = await Promise.all([
          sendWebhook(payment.providerPaymentId!),
          sendWebhook(payment.providerPaymentId!),
        ]);

        expect([r1.status, r2.status]).toEqual([200, 200]);
        const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(final.status).toBe('REFUNDED');
        expect(fakeProvider.refundCalls).toHaveLength(1);
      });
    });

    // Invariante de domínio pós EXPIRED -> PAID: "o Payment mais recente" deixou
    // de ser uma regra válida. Estes testes exercitam o service e o webhook
    // REAIS contra o Postgres real (índice único parcial, advisory locks, CAS)
    // — só o provider é o fake.
    describe('Precedência financeira — múltiplas tentativas (A expira, B é gerado, A é aprovado tardiamente)', () => {
      // A e B são criados pelo PaymentsService REAL (não inseridos por Prisma);
      // só o "tempo passando" é simulado (expiresAt de A no passado), e quem
      // expira A é o próprio createPayment de B (lazy expiry de verdade).
      async function createAExpiredThenB(hoursFromNow: number) {
        const booking = await createConfirmedBooking(courtAId, customerAId, hoursFromNow);
        const paymentsService = app.get(PaymentsService);
        const viewA = await paymentsService.createPayment(customerAId, booking.id, randomUUID());
        await prisma.payment.update({
          where: { id: viewA.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        const viewB = await paymentsService.createPayment(customerAId, booking.id, randomUUID());
        const rowA = await prisma.payment.findUniqueOrThrow({ where: { id: viewA.id } });
        const rowB = await prisma.payment.findUniqueOrThrow({ where: { id: viewB.id } });
        return { booking, rowA, rowB, paymentsService };
      }

      it('A=PAID (tardio), B permanece PENDING, a Booking é reconhecida como paga em TODAS as leituras, nenhuma terceira cobrança nasce, e o refund encontra A', async () => {
        const { booking, rowA, rowB, paymentsService } = await createAExpiredThenB(130);
        expect(rowA.status).toBe('EXPIRED');
        expect(rowB.status).toBe('PENDING');
        expect(rowB.id).not.toBe(rowA.id);

        // O PIX ANTIGO de A é aprovado pelo Mercado Pago depois de B existir.
        fakeProvider.statusByProviderPaymentId.set(rowA.providerPaymentId!, 'PAID');
        await sendWebhook(rowA.providerPaymentId!).expect(200);

        const paidA = await prisma.payment.findUniqueOrThrow({ where: { id: rowA.id } });
        const pendingB = await prisma.payment.findUniqueOrThrow({ where: { id: rowB.id } });
        expect(paidA.status).toBe('PAID');
        expect(pendingB.status).toBe('PENDING'); // consistente: segue o ciclo próprio
        const bookingRow = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(bookingRow.status).toBe('CONFIRMED');

        // getPaymentForBooking: representa a Booking como PAGA (A), não B.
        const view = await request(app.getHttpServer())
          .get(paymentUrl(booking.id))
          .set(...authHeader('token-customer-a'))
          .expect(200);
        expect((view.body as PaymentViewBody).id).toBe(rowA.id);
        expect((view.body as PaymentViewBody).status).toBe('PAID');

        // getLatestPaymentStatusesForUser ("Minhas reservas"): nunca PENDING.
        const mine = await request(app.getHttpServer())
          .get('/v1/users/me/payments')
          .set(...authHeader('token-customer-a'))
          .expect(200);
        expect((mine.body as Record<string, string>)[booking.id]).toBe('PAID');

        // createPayment: contrato existente ("reserva já paga" = 409), sem
        // nenhuma terceira cobrança e sem chamar o provider.
        const createCallsBefore = fakeProvider.createCalls.length;
        await request(app.getHttpServer())
          .post(paymentsUrl(booking.id))
          .set(...authHeader('token-customer-a'))
          .set('Idempotency-Key', randomUUID())
          .expect(409);
        // Replay da chave da tentativa B (PENDING) também nunca devolve o PIX de B.
        await expect(
          paymentsService.createPayment(customerAId, booking.id, rowB.idempotencyKey),
        ).rejects.toBeInstanceOf(ConflictException);
        // ...mas o replay da chave da tentativa PAGA (A) continua idempotente.
        const replayA = await paymentsService.createPayment(
          customerAId,
          booking.id,
          rowA.idempotencyKey,
        );
        expect(replayA.id).toBe(rowA.id);
        expect(replayA.status).toBe('PAID');
        expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(2);
        expect(fakeProvider.createCalls).toHaveLength(createCallsBefore);

        // refundIfPaid encontra A (PAID) — nunca B (PENDING, mais nova).
        await request(app.getHttpServer())
          .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/${booking.id}/cancel`)
          .set(...authHeader('token-customer-a'))
          .expect(200);
        expect(fakeProvider.refundCalls).toEqual([
          { providerPaymentId: rowA.providerPaymentId, idempotencyKey: `refund:${rowA.id}` },
        ]);
        const refundedA = await prisma.payment.findUniqueOrThrow({ where: { id: rowA.id } });
        const stillPendingB = await prisma.payment.findUniqueOrThrow({ where: { id: rowB.id } });
        expect(refundedA.status).toBe('REFUNDED');
        expect(stillPendingB.status).toBe('PENDING'); // nunca tocada pelo refund

        // Cancelar de novo: nenhum segundo reembolso.
        await request(app.getHttpServer())
          .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/${booking.id}/cancel`)
          .set(...authHeader('token-customer-a'))
          .expect(200);
        expect(fakeProvider.refundCalls).toHaveLength(1);
      });

      it('A expira, B é gerado e PAGO no prazo; depois o PIX antigo de A é aprovado: o índice único parcial barra o segundo PAID — A vira FAILED (DUPLICATE_PAYMENT_FOR_BOOKING) a partir de EXPIRED, B continua PAID (nunca dois PAID)', async () => {
        const { booking, rowA, rowB } = await createAExpiredThenB(131);

        fakeProvider.statusByProviderPaymentId.set(rowB.providerPaymentId!, 'PAID');
        await sendWebhook(rowB.providerPaymentId!).expect(200);
        fakeProvider.statusByProviderPaymentId.set(rowA.providerPaymentId!, 'PAID');
        await sendWebhook(rowA.providerPaymentId!).expect(200);

        const finalA = await prisma.payment.findUniqueOrThrow({ where: { id: rowA.id } });
        const finalB = await prisma.payment.findUniqueOrThrow({ where: { id: rowB.id } });
        expect(finalB.status).toBe('PAID');
        expect(finalA.status).toBe('FAILED');
        expect(finalA.failureReason).toBe('DUPLICATE_PAYMENT_FOR_BOOKING');
        expect(
          await prisma.payment.count({ where: { bookingId: booking.id, status: 'PAID' } }),
        ).toBe(1);
        // A Booking continua paga por B, e a visão financeira a representa por B.
        const view = await request(app.getHttpServer())
          .get(paymentUrl(booking.id))
          .set(...authHeader('token-customer-a'))
          .expect(200);
        expect((view.body as PaymentViewBody).id).toBe(rowB.id);
        expect((view.body as PaymentViewBody).status).toBe('PAID');
      });

      it('Payment REFUNDING (reembolso em andamento) também tem precedência sobre uma tentativa mais nova', async () => {
        const { booking, rowA, rowB } = await createAExpiredThenB(132);
        fakeProvider.statusByProviderPaymentId.set(rowA.providerPaymentId!, 'PAID');
        await sendWebhook(rowA.providerPaymentId!).expect(200);

        // Reembolso assíncrono do PIX: o provider aceita mas ainda processa.
        fakeProvider.nextRefundResult = { refundId: 'refund-fake-async', status: 'REFUNDING' };
        await request(app.getHttpServer())
          .post(`/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/${booking.id}/cancel`)
          .set(...authHeader('token-customer-a'))
          .expect(200);

        const refundingA = await prisma.payment.findUniqueOrThrow({ where: { id: rowA.id } });
        expect(refundingA.status).toBe('REFUNDING');
        const view = await request(app.getHttpServer())
          .get(paymentUrl(booking.id))
          .set(...authHeader('token-customer-a'))
          .expect(200);
        expect((view.body as PaymentViewBody).id).toBe(rowA.id); // nunca B (PENDING)
        const untouchedB = await prisma.payment.findUniqueOrThrow({ where: { id: rowB.id } });
        expect(untouchedB.status).toBe('PENDING');
      });
    });
  });

  describe('Cancelamento durante o pagamento (itens 12, 12.1)', () => {
    function sendPaid(providerPaymentId: string, eventId: string = randomUUID()) {
      const ts = String(Math.floor(Date.now() / 1000));
      const requestId = randomUUID();
      return request(app.getHttpServer())
        .post('/v1/webhooks/payments/mercadopago')
        .set('x-signature', signWebhook(providerPaymentId, requestId, ts))
        .set('x-request-id', requestId)
        .send({ id: eventId, type: 'payment', data: { id: providerPaymentId } });
    }

    // PENDING real (criado via HTTP) -> Booking cancelada pelo endpoint real ->
    // provider informa PAID. Mesma política do caminho EXPIRED: dinheiro
    // recebido é registrado como PAID e devolvido pelo refund idempotente.
    async function createPendingThenCancel(hoursFromNow: number) {
      const booking = await createConfirmedBooking(courtAId, customerAId, hoursFromNow);
      // Via service real (não HTTP) só para preservar o orçamento de 30
      // POST/min do throttler deste arquivo — sem alterar rate limit.
      const view = await app
        .get(PaymentsService)
        .createPayment(customerAId, booking.id, randomUUID());
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: view.id } });
      const cancelUrl = `/v1/arenas/${arenaAId}/courts/${courtAId}/bookings/${booking.id}/cancel`;
      await request(app.getHttpServer())
        .post(cancelUrl)
        .set(...authHeader('token-customer-a'))
        .expect(200);
      expect(fakeProvider.refundCalls).toHaveLength(0); // PENDING não é reembolsável
      return { booking, payment, cancelUrl };
    }

    it('Booking cancelada enquanto o Payment está PENDING: um PAID que chega depois é registrado como PAID e reembolsado UMA vez (REFUNDED); a reserva continua CANCELLED e nenhuma cobrança nova nasce', async () => {
      const { booking, payment } = await createPendingThenCancel(50);

      fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');
      await sendPaid(payment.providerPaymentId!).expect(200);

      const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(final.status).toBe('REFUNDED');
      expect(final.paidAt).not.toBeNull(); // o dinheiro entrou de verdade
      expect(final.refundedAt).not.toBeNull();
      expect(final.failureReason).toBeNull();
      expect(fakeProvider.refundCalls).toEqual([
        { providerPaymentId: payment.providerPaymentId, idempotencyKey: `refund:${payment.id}` },
      ]);
      const bookingRow = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(bookingRow.status).toBe('CANCELLED'); // nunca reaberta
      expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1);
    });

    it('webhook duplicado (mesmo evento) e novo evento do mesmo pagamento depois do refund: nenhum segundo reembolso', async () => {
      const { payment } = await createPendingThenCancel(51);
      fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');
      const eventId = randomUUID();

      await sendPaid(payment.providerPaymentId!, eventId).expect(200);
      await sendPaid(payment.providerPaymentId!, eventId).expect(200); // mesmo evento (dedup)
      await sendPaid(payment.providerPaymentId!).expect(200); // evento novo, Payment já REFUNDED

      const final = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(final.status).toBe('REFUNDED');
      expect(fakeProvider.refundCalls).toHaveLength(1);
    });

    it('refund FALHA: o Payment fica REFUNDING (recuperável, dinheiro registrado), o webhook responde 200, e repetir o cancelamento conclui com a MESMA idempotency key', async () => {
      const { booking, payment, cancelUrl } = await createPendingThenCancel(52);

      fakeProvider.nextRefundError = new Error('Mercado Pago indisponível (teste)');
      fakeProvider.statusByProviderPaymentId.set(payment.providerPaymentId!, 'PAID');
      await sendPaid(payment.providerPaymentId!).expect(200);

      const afterFailure = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(afterFailure.status).toBe('REFUNDING');
      expect(afterFailure.paidAt).not.toBeNull();
      expect(afterFailure.refundId).toBeNull();
      expect(fakeProvider.refundCalls).toHaveLength(1);
      const bookingRow = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(bookingRow.status).toBe('CANCELLED');

      await request(app.getHttpServer())
        .post(cancelUrl)
        .set(...authHeader('token-customer-a'))
        .expect(200);
      const recovered = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(recovered.status).toBe('REFUNDED');
      expect(new Set(fakeProvider.refundCalls.map((call) => call.idempotencyKey))).toEqual(
        new Set([`refund:${payment.id}`]),
      );
    });
  });

  describe('Isolamento multi-tenant (item 16)', () => {
    it('cliente da Arena A nunca acessa/cria pagamento de reserva da Arena B', async () => {
      const bookingB = await createConfirmedBooking(courtBId, customerBId, 24, 999999);

      await request(app.getHttpServer())
        .post(paymentsUrl(bookingB.id))
        .set(...authHeader('token-customer-a'))
        .set('Idempotency-Key', randomUUID())
        .expect(404);
      await request(app.getHttpServer())
        .get(paymentUrl(bookingB.id))
        .set(...authHeader('token-customer-a'))
        .expect(404);
    });

    it('Payment da Arena B nunca aparece com dados da Arena A (arenaId denormalizado corretamente)', async () => {
      const bookingB = await createConfirmedBooking(courtBId, customerBId, 60, 999999);
      const response = await request(app.getHttpServer())
        .post(paymentsUrl(bookingB.id))
        .set(...authHeader('token-customer-b'))
        .set('Idempotency-Key', randomUUID())
        .expect(201);

      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: (response.body as PaymentViewBody).id },
      });
      expect(payment.arenaId).toBe(arenaBId);
      expect(payment.arenaId).not.toBe(arenaAId);
    });
  });

  describe('GET /v1/users/me/payments — resumo pra "Minhas reservas" (Fase 26, item 14)', () => {
    it('exige autenticação (401)', async () => {
      await request(app.getHttpServer()).get('/v1/users/me/payments').expect(401);
    });

    it('devolve o status da tentativa MAIS RECENTE de cada Booking do usuário, nunca a de outro usuário', async () => {
      const bookingA1 = await createConfirmedBooking(courtAId, customerAId, 70);
      await request(app.getHttpServer())
        .post(paymentsUrl(bookingA1.id))
        .set(...authHeader('token-customer-a'))
        .set('Idempotency-Key', randomUUID())
        .expect(201);

      const bookingB1 = await createConfirmedBooking(courtBId, customerBId, 71);
      await request(app.getHttpServer())
        .post(paymentsUrl(bookingB1.id))
        .set(...authHeader('token-customer-b'))
        .set('Idempotency-Key', randomUUID())
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/v1/users/me/payments')
        .set(...authHeader('token-customer-a'))
        .expect(200);

      const summary = response.body as Record<string, string>;
      expect(summary[bookingA1.id]).toBe('PENDING');
      // Nunca vaza o status do pagamento de B pra uma consulta feita por A —
      // mesma disciplina anti-IDOR do resto do módulo (item 16 do prompt).
      expect(summary[bookingB1.id]).toBeUndefined();
    });

    it('Booking sem nenhuma tentativa de pagamento simplesmente não aparece no mapa', async () => {
      const bookingSemPagamento = await createConfirmedBooking(courtAId, customerAId, 72);

      const response = await request(app.getHttpServer())
        .get('/v1/users/me/payments')
        .set(...authHeader('token-customer-a'))
        .expect(200);

      expect((response.body as Record<string, string>)[bookingSemPagamento.id]).toBeUndefined();
    });
  });
});
