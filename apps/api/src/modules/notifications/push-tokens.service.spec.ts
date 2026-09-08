import { PushTokensService } from './push-tokens.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PushTokensService', () => {
  let prisma: { pushToken: { upsert: jest.Mock; deleteMany: jest.Mock; findMany: jest.Mock } };
  let service: PushTokensService;

  beforeEach(() => {
    prisma = {
      pushToken: {
        upsert: jest.fn().mockResolvedValue({ id: 'token-row-1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new PushTokensService(prisma as unknown as PrismaService);
  });

  describe('register', () => {
    it('faz upsert por token — cria com o userId autenticado quando o token é novo', async () => {
      await service.register('user-1', 'ExponentPushToken[abc]', 'ios');

      expect(prisma.pushToken.upsert).toHaveBeenCalledWith({
        where: { token: 'ExponentPushToken[abc]' },
        create: { userId: 'user-1', token: 'ExponentPushToken[abc]', platform: 'ios' },
        update: { userId: 'user-1', platform: 'ios' },
      });
    });

    // M7, item 5/6: mesmo dispositivo físico (mesmo token), login de OUTRO
    // usuário depois de um logout — a linha é REASSOCIADA (upsert.update),
    // nunca duplicada, e a identidade usada é sempre a do chamador atual.
    it('reassocia o MESMO token a um usuário diferente (logout + login de outra conta no mesmo aparelho)', async () => {
      await service.register('user-2', 'ExponentPushToken[abc]', 'android');

      expect(prisma.pushToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: 'ExponentPushToken[abc]' },
          update: { userId: 'user-2', platform: 'android' },
        }),
      );
    });
  });

  describe('remove', () => {
    it('remove escopado por userId E token — nunca só por token (defesa contra IDOR)', async () => {
      await service.remove('user-1', 'ExponentPushToken[abc]');

      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', token: 'ExponentPushToken[abc]' },
      });
    });

    it('nunca lança quando o token já não existe mais (double logout)', async () => {
      prisma.pushToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('user-1', 'token-inexistente')).resolves.toBeUndefined();
    });
  });

  describe('removeByToken (autolimpeza de token inválido)', () => {
    it('remove por token, sem exigir userId (chamado a partir da resposta do Expo Push Service)', async () => {
      await service.removeByToken('ExponentPushToken[invalido]');

      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'ExponentPushToken[invalido]' },
      });
    });
  });

  describe('findTokensForUser', () => {
    it('busca todos os tokens do usuário (múltiplos dispositivos)', async () => {
      const tokens = [
        { id: 't1', token: 'ExponentPushToken[a]' },
        { id: 't2', token: 'ExponentPushToken[b]' },
      ];
      prisma.pushToken.findMany.mockResolvedValue(tokens);

      await expect(service.findTokensForUser('user-1')).resolves.toEqual(tokens);
      expect(prisma.pushToken.findMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });
  });
});
