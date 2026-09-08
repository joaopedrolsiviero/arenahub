import { apiRequest } from './client';
import { getMyProfile } from './users';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));

const mockedApiRequest = apiRequest as jest.Mock;

describe('api/users', () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it('getMyProfile chama GET /users/me com o token', async () => {
    mockedApiRequest.mockResolvedValue({ id: 'user-1' });

    await getMyProfile('session-token');

    expect(mockedApiRequest).toHaveBeenCalledWith('/users/me', { token: 'session-token' });
  });

  it('devolve exatamente o PublicUser retornado pela API, sem transformar', async () => {
    const user = {
      id: 'user-1',
      email: 'cliente@example.com',
      name: 'Cliente Exemplo',
      phone: '+5511999999999',
      avatarUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    mockedApiRequest.mockResolvedValue(user);

    await expect(getMyProfile('token')).resolves.toEqual(user);
  });
});
