import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
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

// Fase 18 (item 12): "valores de desenvolvimento não podem silenciosamente
// virar configuração de produção". WEB_APP_URL tem um default de
// desenvolvimento (http://localhost:3000, ver enableCors abaixo) — sem essa
// checagem, um deploy de produção configurado incompletamente subiria
// silenciosamente com CORS liberado só para localhost (não é um wildcard
// permissivo, mas quebra o frontend real e mascara o erro de configuração
// atrás de um CORS confuso no browser em vez de uma falha clara no boot).
function assertProductionSafety(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const problems: string[] = [];
  if (!process.env.WEB_APP_URL) {
    problems.push(
      'WEB_APP_URL é obrigatória em produção (o default de desenvolvimento http://localhost:3000 nunca deve ser usado).',
    );
  }
  if (problems.length > 0) {
    Logger.error(`Configuração de produção inválida: ${problems.join(' ')}`, 'Bootstrap');
    process.exit(1);
  }
}

async function bootstrap() {
  assertRequiredEnv();
  assertProductionSafety();

  // rawBody: true expõe request.rawBody (Buffer) — necessário para o webhook
  // do Clerk, cuja assinatura Svix é computada sobre os bytes crus do corpo,
  // não sobre o JSON já parseado.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // O middleware de correlação (X-Request-Id) e helmet TAMBÉM estão
  // registrados em AppModule.configure() (Fase 18, itens 5/9) — para
  // ficarem ativos nos testes e2e, que nunca executam esta função
  // `bootstrap()` (cada `*.e2e-spec.ts` monta seu próprio
  // `Test.createTestingModule({ imports: [AppModule] })`). Repetir o
  // registro do helmet AQUI, antes de `enableCors`, é deliberado e não
  // redundante: o middleware de CORS intercepta e finaliza sozinho toda
  // requisição de preflight (`OPTIONS`) ANTES dela alcançar o middleware
  // registrado a nível de módulo — sem este segundo registro, um preflight
  // OPTIONS vazaria `X-Powered-By: Express` mesmo com o helmet
  // "ativo" (achado real ao testar a imagem Docker desta fase contra um
  // preflight de verdade). Rodar helmet duas vezes é inofensivo (só
  // reescreve os mesmos headers). A configuração DEFAULT do helmet
  // (inclusive o CSP default) nunca arrisca quebrar nada aqui: esta API só
  // responde JSON (nunca HTML), e CSP só é interpretado pelo browser em
  // documentos renderizados — a preocupação real de "CSP pode quebrar
  // Clerk/Next" (item 5/6 do prompt) é do FRONTEND
  // (apps/web/next.config.ts), que já documenta a decisão de deixar CSP
  // pendente até validar contra o domínio de produção real.
  app.use(helmet());

  // Fase 18 (item 4/6): em produção, a plataforma (Railway) sempre está
  // atrás de um proxy reverso — sem `trust proxy`, `req.ip` (usado como
  // chave do rate limiter, item 4) seria sempre o IP interno do proxy, e
  // TODOS os clientes compartilhariam o mesmo contador, tornando o rate
  // limiting inútil (um único usuário abusivo bloquearia todo mundo) ou
  // inofensivo (nunca bloqueia ninguém de verdade, dependendo de qual lado
  // do bug). `1` confia exatamente um hop (o proxy da própria plataforma),
  // nunca a cadeia inteira de X-Forwarded-For (que o cliente poderia
  // forjar). Em desenvolvimento, sem proxy nenhum, isso fica desligado.
  if (process.env.NODE_ENV === 'production') {
    const expressInstance = app.getHttpAdapter().getInstance() as {
      set: (key: string, value: unknown) => void;
    };
    expressInstance.set('trust proxy', 1);
  }

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
  // Fase 18 (item 6): `.map(trim)` — sem isso, "https://a.com, https://b.com"
  // (com espaço depois da vírgula, forma comum de configurar múltiplas
  // origens) quebraria silenciosamente a segunda origem. `methods`
  // explícito documenta exatamente o que a API aceita (nunca um mecanismo
  // de autenticação — webhooks, que não passam por CORS nenhum porque não
  // são chamados por um browser, continuam protegidos só pela própria
  // verificação de assinatura, nunca por CORS).
  app.enableCors({
    origin: (process.env.WEB_APP_URL ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
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
