import { apiRequest } from './client';
import { registerPushToken, removePushToken } from './push-tokens';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));

const mockedApiRequest = apiRequest as jest.Mock;

describe('api/push-tokens', () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it('registerPushToken chama POST /users/me/push-tokens com Authorization e o corpo correto', async () => {
    mockedApiRequest.mockResolvedValue({ ok: true });

    await registerPushToken('session-token', 'ExponentPushToken[abc]', 'ios');

    expect(mockedApiRequest).toHaveBeenCalledWith('/users/me/push-tokens', {
      token: 'session-token',
      method: 'POST',
      body: { token: 'ExponentPushToken[abc]', platform: 'ios' },
    });
  });

  it('removePushToken chama DELETE /users/me/push-tokens com o token no corpo', async () => {
    mockedApiRequest.mockResolvedValue({ ok: true });

    await removePushToken('session-token', 'ExponentPushToken[abc]');

    expect(mockedApiRequest).toHaveBeenCalledWith('/users/me/push-tokens', {
      token: 'session-token',
      method: 'DELETE',
      body: { token: 'ExponentPushToken[abc]' },
    });
  });

  it('nunca envia nenhum campo além de token/platform (mass assignment)', async () => {
    mockedApiRequest.mockResolvedValue({ ok: true });

    await registerPushToken('session-token', 'ExponentPushToken[abc]', 'android');

    const [, options] = mockedApiRequest.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(Object.keys(options.body)).toEqual(['token', 'platform']);
  });
});
