import { PaymentStatus, Prisma } from '@prisma/client';

// Campos mínimos de Payment que as listagens administrativas precisam pra
// derivar o status exibido de uma Booking. Sem `providerPaymentId`,
// `refundId`, `idempotencyKey` etc. — nada disso é exposto ao painel.
export const paymentDisplaySelect = {
  status: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.PaymentSelect;

export type PaymentDisplayRow = Prisma.PaymentGetPayload<{ select: typeof paymentDisplaySelect }>;

// Estados que representam dinheiro recebido/devolvendo (mesma regra de
// precedência de `PaymentsService.findRelevantPayment`): um PAID/REFUNDING
// vale mais que uma tentativa mais nova PENDING/EXPIRED/FAILED da mesma
// Booking.
const FINANCIAL_STATUSES: PaymentStatus[] = [PaymentStatus.PAID, PaymentStatus.REFUNDING];

function newestFirst(a: PaymentDisplayRow, b: PaymentDisplayRow): number {
  return b.createdAt.getTime() - a.createdAt.getTime();
}

/**
 * Status de pagamento exibido ao OWNER/ADMIN para uma Booking — só leitura,
 * derivado dos `Payment` reais (nenhuma segunda fonte de verdade, nenhuma
 * escrita). `null` = a Booking nunca teve Payment (arena presencial,
 * BLOCK/MAINTENANCE, ou cliente que ainda não gerou o PIX).
 *
 * `PENDING` com `expiresAt` vencido é exibido como `EXPIRED`: a expiração
 * real (`PaymentsService.resolveExpiry`) é lazy e só grava no banco quando o
 * CLIENTE lê o pagamento — sem isto uma reserva com PIX abandonado ficaria
 * "Aguardando pagamento" no painel pra sempre. Só apresentação: o banco não
 * é tocado, e um PAID tardio ainda reconcilia normalmente pelo webhook.
 */
export function resolveAdminPaymentStatus(
  payments: PaymentDisplayRow[],
  now: Date = new Date(),
): PaymentStatus | null {
  if (payments.length === 0) return null;

  const financial = payments.filter((payment) => FINANCIAL_STATUSES.includes(payment.status));
  const relevant = [...(financial.length > 0 ? financial : payments)].sort(newestFirst)[0]!;

  if (
    relevant.status === PaymentStatus.PENDING &&
    relevant.expiresAt &&
    relevant.expiresAt.getTime() <= now.getTime()
  ) {
    return PaymentStatus.EXPIRED;
  }
  return relevant.status;
}
