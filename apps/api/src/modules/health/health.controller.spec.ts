import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../../prisma/prisma.service';

describe('HealthController', () => {
  let prisma: { $queryRaw: jest.Mock };
  let controller: HealthController;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    controller = new HealthController(prisma as unknown as PrismaService);
  });

  describe('GET /health (liveness)', () => {
    it('retorna ok com timestamp, sem tocar o banco', () => {
      const result = controller.check();

      expect(result.status).toBe('ok');
      expect(result.service).toBe('arenahub-api');
      expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('GET /health/ready (readiness)', () => {
    it('retorna ok + database:ok quando o Postgres responde', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const result = await controller.ready();

      expect(result).toMatchObject({ status: 'ok', database: 'ok' });
    });

    it('lança 503 (nunca vaza o erro original) quando o Postgres não responde', async () => {
      prisma.$queryRaw.mockRejectedValue(
        new Error('connect ECONNREFUSED postgres-internal-host:5432'),
      );

      let caught: unknown;
      try {
        await controller.ready();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ServiceUnavailableException);
      // A mensagem exposta nunca deve conter host/porta/detalhe do driver.
      expect((caught as ServiceUnavailableException).message).not.toContain(
        'postgres-internal-host',
      );
    });
  });
});
