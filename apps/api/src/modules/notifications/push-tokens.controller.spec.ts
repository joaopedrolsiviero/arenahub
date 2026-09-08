import { PushTokensController } from './push-tokens.controller';
import { PushTokensService } from './push-tokens.service';
import { UsersService } from '../users/users.service';

describe('PushTokensController', () => {
  let pushTokensService: { register: jest.Mock; remove: jest.Mock };
  let usersService: { findByClerkId: jest.Mock };
  let controller: PushTokensController;

  beforeEach(() => {
    pushTokensService = {
      register: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    usersService = { findByClerkId: jest.fn().mockResolvedValue({ id: 'user-1' }) };
    controller = new PushTokensController(
      pushTokensService as unknown as PushTokensService,
      usersService as unknown as UsersService,
    );
  });

  describe('POST /users/me/push-tokens', () => {
    it('resolve o userId a partir da sessão autenticada (Clerk), nunca de um campo do corpo', async () => {
      const result = await controller.register(
        { clerkId: 'clerk-1' },
        { token: 'ExponentPushToken[abc]', platform: 'ios' },
      );

      expect(usersService.findByClerkId).toHaveBeenCalledWith('clerk-1');
      expect(pushTokensService.register).toHaveBeenCalledWith(
        'user-1',
        'ExponentPushToken[abc]',
        'ios',
      );
      expect(result).toEqual({ ok: true });
    });

    // Segurança (item 6 do prompt): mesmo que o DTO um dia ganhe campos
    // extras enviados por um cliente malicioso, o controller nunca lê nada
    // além de token/platform do corpo — o teste acima já prova que o
    // userId usado vem exclusivamente de `usersService.findByClerkId`.
    it('nunca usa um userId vindo do corpo da requisição, mesmo que um exista (DTO não declara esse campo)', async () => {
      await controller.register(
        { clerkId: 'clerk-1' },
        {
          token: 'x',
          platform: 'android',
          ...({ userId: 'user-forjado' } as Record<string, unknown>),
        },
      );

      expect(pushTokensService.register).toHaveBeenCalledWith('user-1', 'x', 'android');
      expect(pushTokensService.register).not.toHaveBeenCalledWith(
        'user-forjado',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('DELETE /users/me/push-tokens', () => {
    it('resolve o userId a partir da sessão autenticada, nunca do corpo', async () => {
      const result = await controller.remove(
        { clerkId: 'clerk-1' },
        { token: 'ExponentPushToken[abc]' },
      );

      expect(usersService.findByClerkId).toHaveBeenCalledWith('clerk-1');
      expect(pushTokensService.remove).toHaveBeenCalledWith('user-1', 'ExponentPushToken[abc]');
      expect(result).toEqual({ ok: true });
    });
  });
});
