import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// Fase 9 (item 55): falhar rápido e com uma mensagem clara na ausência de
// uma variável obrigatória — nunca subir parcialmente configurado e deixar
// o primeiro request real (ou a primeira tentativa de conexão do Prisma)
// revelar o problema de um jeito confuso. Nunca imprime o VALOR de nenhuma
// variável, só o nome de quais estão faltando.
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'CLERK_SECRET_KEY',
  'CLERK_WEBHOOK_SIGNING_SECRET',
] as const;

function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    Logger.error(
      `Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}. Veja apps/api/.env.example.`,
      'Bootstrap',
    );
    process.exit(1);
  }
}

async function bootstrap() {
  assertRequiredEnv();

  // rawBody: true expõe request.rawBody (Buffer) — necessário para o webhook
  // do Clerk, cuja assinatura Svix é computada sobre os bytes crus do corpo,
  // não sobre o JSON já parseado.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('v1');
  // Fase 9 (item 40): sem isso, SIGTERM (enviado pela plataforma em todo
  // redeploy/scale-down) não aciona o ciclo de vida do Nest — os hooks
  // OnModuleDestroy (ex: PrismaService.$disconnect) nunca rodam, e o
  // processo é encerrado abruptamente em vez de fechar conexões primeiro.
  // Bookings em andamento não são afetados por isso: o advisory lock e a
  // transação são do Postgres, não da API — mesmo um encerramento abrupto
  // do processo libera o lock automaticamente (é transacional).
  app.enableShutdownHooks();
  // Fase 6: o frontend (Next.js, outra origem/porta) passou a chamar a API
  // direto do browser (fetch client-side com o Bearer token do Clerk) — sem
  // isso, todo request cross-origin seria bloqueado. Sem credentials
  // (cookies): a autenticação é sempre via header Authorization, nunca
  // cookie de sessão, então não há necessidade de `credentials: true`.
  app.enableCors({
    origin: (process.env.WEB_APP_URL ?? 'http://localhost:3000').split(','),
  });
  // Conforme ARCHITECTURE.md, Parte 10: DTOs com class-validator em toda
  // rota, nunca confiando só na validação do frontend. whitelist/forbidNon
  // rejeitam qualquer campo fora do DTO (em vez de ignorá-lo silenciosamente);
  // transform converte query params (?includeInactive=true) e instancia os
  // DTOs para que os decorators de validação funcionem corretamente.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  // Fase 9 (item 96): só informação operacional útil pra saber "o que está
  // rodando" (nunca DATABASE_URL/secrets — nenhum deles aparece aqui).
  Logger.log(
    `ArenaHub API ouvindo na porta ${port} — NODE_ENV=${process.env.NODE_ENV ?? 'development'}` +
      (process.env.APP_VERSION ? `, versão ${process.env.APP_VERSION}` : ''),
    'Bootstrap',
  );
}
void bootstrap();
