import { apiRequest } from './client';
import { createBookingPayment, getBookingPayment, getMyPaymentStatuses } from './payments';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));

const mockedApiRequest = apiRequest as jest.Mock;

describe('api/payments', () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it('createBookingPayment chama POST .../payments com Authorization e Idempotency-Key, sem corpo', async () => {
    mockedApiRequest.mockResolvedValue({ id: 'payment-1' });

    await createBookingPayment('session-token', 'booking-1', 'idem-key-1');

    expect(mockedApiRequest).toHaveBeenCalledWith('/users/me/bookings/booking-1/payments', {
      token: 'session-token',
      method: 'POST',
      headers: { 'Idempotency-Key': 'idem-key-1' },
    });
  });

  it('getBookingPayment chama GET .../payment com o token', async () => {
    mockedApiRequest.mockResolvedValue(null);

    await getBookingPayment('session-token', 'booking-1');

    expect(mockedApiRequest).toHaveBeenCalledWith('/users/me/bookings/booking-1/payment', {
      token: 'session-token',
    });
  });

  it('getBookingPayment devolve null quando a reserva nunca teve tentativa de pagamento', async () => {
    mockedApiRequest.mockResolvedValue(null);

    await expect(getBookingPayment('token', 'booking-1')).resolves.toBeNull();
  });

  it('devolve exatamente o PaymentView retornado pela API, sem transformar', async () => {
    const payment = {
      id: 'payment-1',
      bookingId: 'booking-1',
      status: 'PENDING',
      amount: '100.00',
      currency: 'BRL',
      checkoutUrl: null,
      pixCopyPaste: '00020126...',
      qrCodeBase64: 'iVBORw0KGgo=',
      failureReason: null,
      paidAt: null,
      expiresAt: '2026-09-07T13:30:00.000Z',
      createdAt: '2026-09-07T13:00:00.000Z',
      refundedAt: null,
    };
    mockedApiRequest.mockResolvedValue(payment);

    await expect(getBookingPayment('token', 'booking-1')).resolves.toEqual(payment);
  });

  it('getMyPaymentStatuses chama GET /users/me/payments com o token', async () => {
    mockedApiRequest.mockResolvedValue({});

    await getMyPaymentStatuses('session-token');

    expect(mockedApiRequest).toHaveBeenCalledWith('/users/me/payments', { token: 'session-token' });
  });

  it('getMyPaymentStatuses devolve exatamente o mapa bookingId -> status retornado pela API', async () => {
    const statuses = { 'booking-1': 'PAID', 'booking-2': 'PENDING' };
    mockedApiRequest.mockResolvedValue(statuses);

    await expect(getMyPaymentStatuses('token')).resolves.toEqual(statuses);
  });
});
