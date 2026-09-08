import { apiRequest } from './client';
import { getCourtAvailability } from './availability';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));

const mockedApiRequest = apiRequest as jest.Mock;

describe('api/availability', () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it('monta a URL com arenaId, courtId e a janela from/to em ISO 8601', async () => {
    mockedApiRequest.mockResolvedValue({ slots: [] });

    await getCourtAvailability(
      'arena-1',
      'court-1',
      '2026-09-07T03:00:00.000Z',
      '2026-09-08T03:00:00.000Z',
    );

    expect(mockedApiRequest).toHaveBeenCalledWith(
      '/arenas/arena-1/courts/court-1/availability?from=2026-09-07T03%3A00%3A00.000Z&to=2026-09-08T03%3A00%3A00.000Z',
    );
  });

  it('devolve exatamente o que a API respondeu, sem transformar', async () => {
    const result = {
      courtId: 'court-1',
      timezone: 'America/Sao_Paulo',
      from: '2026-09-07T03:00:00.000Z',
      to: '2026-09-08T03:00:00.000Z',
      slots: [{ startsAt: '2026-09-07T13:00:00.000Z', endsAt: '2026-09-07T14:00:00.000Z', available: true }],
    };
    mockedApiRequest.mockResolvedValue(result);

    await expect(
      getCourtAvailability('arena-1', 'court-1', result.from, result.to),
    ).resolves.toEqual(result);
  });
});
