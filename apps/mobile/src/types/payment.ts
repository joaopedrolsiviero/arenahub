// Espelha exatamente PaymentView (apps/api/src/modules/payments/payments.service.ts)
// — confirmado lendo o service, o controller e o contrato já usado pelo Web
// (apps/web/src/lib/types.ts) antes de escrever este arquivo (M4, item 3/6).
// Nenhum campo renomeado, nenhum campo inventado. `amount` chega como
// string (Prisma.Decimal serializado em JSON, mesma regra de
// Booking.total/Court.pricePerSlot) — nunca tratado como number direto.
export type PaymentStatus =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUNDING'
  | 'REFUNDED';

export interface PaymentView {
  id: string;
  bookingId: string;
  status: PaymentStatus;
  amount: string;
  currency: string;
  checkoutUrl: string | null;
  pixCopyPaste: string | null;
  qrCodeBase64: string | null;
  failureReason: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  refundedAt: string | null;
}
