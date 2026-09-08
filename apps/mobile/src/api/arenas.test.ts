import { apiRequest } from './client';
import { discoverArenaBySlug, discoverArenas } from './arenas';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));

const mockedApiRequest = apiRequest as jest.Mock;

describe('api/arenas', () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it('discoverArenas chama GET /arenas/discover sem token', async () => {
    mockedApiRequest.mockResolvedValue([]);

    await discoverArenas();

    expect(mockedApiRequest).toHaveBeenCalledWith('/arenas/discover');
  });

  it('discoverArenaBySlug chama GET /arenas/discover/slug/:slug', async () => {
    mockedApiRequest.mockResolvedValue({ id: 'arena-1' });

    await discoverArenaBySlug('arena-central');

    expect(mockedApiRequest).toHaveBeenCalledWith('/arenas/discover/slug/arena-central');
  });

  it('discoverArenaBySlug escapa o slug na URL', async () => {
    mockedApiRequest.mockResolvedValue({ id: 'arena-1' });

    await discoverArenaBySlug('arena com espaço');

    expect(mockedApiRequest).toHaveBeenCalledWith('/arenas/discover/slug/arena%20com%20espa%C3%A7o');
  });
});
