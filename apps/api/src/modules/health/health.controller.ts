import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface LivenessResponse {
  status: 'ok';
  service: 'arenahub-api';
  timestamp: string;
}

interface ReadinessResponse extends LivenessResponse {
  database: 'ok';
}

// Fase 9 (itens 36-39): liveness e readiness são conceitualmente
// diferentes. Liveness ("o processo está vivo?") nunca depende do banco —
// uma falha temporária de conectividade com o Postgres não pode fazer a
// plataforma reiniciar o processo em loop achando que ele travou. Readiness
// ("pode receber tráfego?") verifica o banco de verdade. Nenhuma das duas
// exige autenticação (a plataforma de deploy não tem um token do Clerk pra
// oferecer), e nenhuma vaza detalhe interno — nem mensagem de erro do
// driver/Prisma, nem DATABASE_URL, nem stack trace.
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check(): LivenessResponse {
    return {
      status: 'ok',
      service: 'arenahub-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready(): Promise<ReadinessResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      // Nunca repassa o erro original (poderia conter host/porta do banco).
      throw new ServiceUnavailableException('Serviço não está pronto para receber tráfego.');
    }

    return {
      status: 'ok',
      service: 'arenahub-api',
      timestamp: new Date().toISOString(),
      database: 'ok',
    };
  }
}
