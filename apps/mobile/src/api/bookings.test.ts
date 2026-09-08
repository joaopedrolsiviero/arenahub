import { apiRequest } from './client';
import { cancelBooking, createBooking, getMyBooking, getMyBookings } from './bookings';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));

const mockedApiRequest = apiRequest as jest.Mock;

describe('api/bookings', () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it('chama POST .../bookings com Authorization e Idempotency-Key corretos', async () => {
    mockedApiRequest.mockResolvedValue({ id: 'booking-1' });

    await createBooking('session-token', 'arena-1', 'court-1', '2026-09-07T13:00:00.000Z', 'idem-key-1');

    expect(mockedApiRequest).toHaveBeenCalledWith('/arenas/arena-1/courts/court-1/bookings', {
      token: 'session-token',
      method: 'POST',
      body: { startsAt: '2026-09-07T13:00:00.000Z' },
      headers: { 'Idempotency-Key': 'idem-key-1' },
    });
  });

  it('omite additionalStartTimes do corpo quando vazio (mesmo contrato do Web)', async () => {
    mockedApiRequest.mockResolvedValue({ id: 'booking-1' });

    await createBooking('token', 'arena-1', 'court-1', '2026-09-07T13:00:00.000Z', 'key', []);

    const [, options] = mockedApiRequest.mock.calls[0] as [string, { body: unknown }];
    expect(options.body).toEqual({ startsAt: '2026-09-07T13:00:00.000Z' });
  });

  it('inclui additionalStartTimes quando presente', async () => {
    mockedApiRequest.mockResolvedValue([{ id: 'booking-1' }, { id: 'booking-2' }]);

    await createBooking('token', 'arena-1', 'court-1', '2026-09-07T13:00:00.000Z', 'key', [
      '2026-09-07T14:00:00.000Z',
    ]);

    const [, options] = mockedApiRequest.mock.calls[0] as [string, { body: unknown }];
    expect(options.body).toEqual({
      startsAt: '2026-09-07T13:00:00.000Z',
      additionalStartTimes: ['2026-09-07T14:00:00.000Z'],
    });
  });

  it('devolve exatamente o que a API respondeu — objeto único ou array', async () => {
    const single = { id: 'booking-1' };
    mockedApiRequest.mockResolvedValueOnce(single);
    await expect(
      createBooking('token', 'arena-1', 'court-1', '2026-09-07T13:00:00.000Z', 'key'),
    ).resolves.toEqual(single);

    const many = [{ id: 'booking-1' }, { id: 'booking-2' }];
    mockedApiRequest.mockResolvedValueOnce(many);
    await expect(
      createBooking('token', 'arena-1', 'court-1', '2026-09-07T13:00:00.000Z', 'key', [
        '2026-09-07T15:00:00.000Z',
      ]),
    ).resolves.toEqual(many);
  });

  it('getMyBookings chama GET /users/me/bookings com o token', async () => {
    mockedApiRequest.mockResolvedValue([]);

    await getMyBookings('session-token');

    expect(mockedApiRequest).toHaveBeenCalledWith('/users/me/bookings', { token: 'session-token' });
  });

  it('getMyBookings devolve exatamente o array retornado pela API', async () => {
    const bookings = [{ id: 'booking-1', status: 'CONFIRMED' }];
    mockedApiRequest.mockResolvedValue(bookings);

    await expect(getMyBookings('token')).resolves.toEqual(bookings);
  });

  it('getMyBooking chama GET /users/me/bookings/:bookingId com o token', async () => {
    mockedApiRequest.mockResolvedValue({ id: 'booking-1' });

    await getMyBooking('session-token', 'booking-1');

    expect(mockedApiRequest).toHaveBeenCalledWith('/users/me/bookings/booking-1', {
      token: 'session-token',
    });
  });

  it('cancelBooking chama POST .../bookings/:bookingId/cancel, sem Idempotency-Key e sem corpo', async () => {
    mockedApiRequest.mockResolvedValue({ id: 'booking-1', status: 'CANCELLED' });

    await cancelBooking('session-token', 'arena-1', 'court-1', 'booking-1');

    expect(mockedApiRequest).toHaveBeenCalledWith(
      '/arenas/arena-1/courts/court-1/bookings/booking-1/cancel',
      { token: 'session-token', method: 'POST' },
    );
    const [, options] = mockedApiRequest.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.headers).toBeUndefined();
    expect(options.body).toBeUndefined();
  });

  it('cancelBooking devolve exatamente o Booking retornado pela API', async () => {
    const cancelled = { id: 'booking-1', status: 'CANCELLED' };
    mockedApiRequest.mockResolvedValue(cancelled);

    await expect(cancelBooking('token', 'arena-1', 'court-1', 'booking-1')).resolves.toEqual(cancelled);
  });
});
