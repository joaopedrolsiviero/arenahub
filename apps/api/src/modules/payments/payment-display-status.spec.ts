import { PaymentStatus } from '@prisma/client';
import { PaymentDisplayRow, resolveAdminPaymentStatus } from './payment-display-status';

describe('resolveAdminPaymentStatus', () => {
  const now = new Date('2026-09-20T12:00:00Z');
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const minutesAhead = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  const row = (
    status: PaymentStatus,
    createdMinutesAgo: number,
    expiresAt: Date | null = null,
  ): PaymentDisplayRow => ({ status, expiresAt, createdAt: minutesAgo(createdMinutesAgo) });

  it('sem Payment devolve null (presencial, BLOCK/MAINTENANCE ou PIX ainda não gerado)', () => {
    expect(resolveAdminPaymentStatus([], now)).toBeNull();
  });

  it.each(['PAID', 'FAILED', 'EXPIRED', 'REFUNDING', 'REFUNDED', 'CANCELLED'] as const)(
    'um único Payment %s é devolvido como está',
    (status) => {
      expect(resolveAdminPaymentStatus([row(status, 5)], now)).toBe(status);
    },
  );

  it('PENDING dentro do prazo continua PENDING', () => {
    expect(resolveAdminPaymentStatus([row('PENDING', 5, minutesAhead(10))], now)).toBe('PENDING');
  });

  it('PENDING com expiresAt vencido é exibido como EXPIRED (só apresentação)', () => {
    expect(resolveAdminPaymentStatus([row('PENDING', 40, minutesAgo(10))], now)).toBe('EXPIRED');
  });

  it('PAID tem precedência sobre uma tentativa mais nova PENDING (A pago tardiamente, B gerado)', () => {
    const payments = [row('PAID', 60), row('PENDING', 5, minutesAhead(25))];
    expect(resolveAdminPaymentStatus(payments, now)).toBe('PAID');
  });

  it('REFUNDING tem precedência sobre tentativas mais novas EXPIRED/FAILED', () => {
    const payments = [row('REFUNDING', 60), row('FAILED', 5), row('EXPIRED', 2)];
    expect(resolveAdminPaymentStatus(payments, now)).toBe('REFUNDING');
  });

  it('sem PAID/REFUNDING, vale a tentativa mais recente (mesma regra de refundIfPaid)', () => {
    const payments = [row('EXPIRED', 90), row('FAILED', 30)];
    expect(resolveAdminPaymentStatus(payments, now)).toBe('FAILED');
  });

  it('REFUNDED não é "financeiro ativo": a tentativa mais recente prevalece', () => {
    const payments = [row('REFUNDED', 90), row('PENDING', 5, minutesAhead(25))];
    expect(resolveAdminPaymentStatus(payments, now)).toBe('PENDING');
  });
});
