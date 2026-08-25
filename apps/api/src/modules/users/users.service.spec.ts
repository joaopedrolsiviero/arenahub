import type { UserWebhookEvent } from '@clerk/backend';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('UsersService', () => {
  let prisma: { user: { findUnique: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock } };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('findByPhone (Fase 16 — identidade do WhatsApp)', () => {
    it('normaliza o telefone recebido antes de consultar', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.findByPhone('55 11 99999-8888');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { phone: '+5511999998888' } });
    });

    it('devolve o User público quando o telefone está vinculado', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'joao@example.com',
        name: 'João',
        phone: '+5511999998888',
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.findByPhone('+5511999998888');

      expect(result?.id).toBe('user-1');
    });

    it('devolve null (nunca lança) quando não há vínculo', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findByPhone('+5511999998888')).resolves.toBeNull();
    });

    it('telefone vazio/irreconhecível devolve null sem consultar o banco', async () => {
      await expect(service.findByPhone('')).resolves.toBeNull();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('syncFromClerkEvent — normalização de telefone (Fase 16)', () => {
    function userEvent(overrides: Partial<Record<string, unknown>> = {}): UserWebhookEvent {
      return {
        type: 'user.created',
        data: {
          id: 'clerk_1',
          email_addresses: [{ id: 'email_1', email_address: 'joao@example.com' }],
          primary_email_address_id: 'email_1',
          phone_numbers: [{ id: 'phone_1', phone_number: '+55 11 99999-8888' }],
          primary_phone_number_id: 'phone_1',
          first_name: 'João',
          last_name: 'Pedro',
          image_url: null,
          ...overrides,
        },
      } as unknown as UserWebhookEvent;
    }

    it('normaliza o telefone primário do Clerk antes de persistir', async () => {
      await service.syncFromClerkEvent(userEvent());

      const [[call]] = prisma.user.upsert.mock.calls as [
        [{ create: { phone: string | null }; update: { phone: string | null } }],
      ];
      expect(call.create.phone).toBe('+5511999998888');
      expect(call.update.phone).toBe('+5511999998888');
    });

    it('sem telefone cadastrado no Clerk, persiste phone null', async () => {
      await service.syncFromClerkEvent(
        userEvent({ phone_numbers: [], primary_phone_number_id: null }),
      );

      const [[call]] = prisma.user.upsert.mock.calls as [[{ create: { phone: string | null } }]];
      expect(call.create.phone).toBeNull();
    });
  });
});
