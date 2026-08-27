import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { LoggingInterceptor } from './common/logging.interceptor';
import { requestIdMiddleware } from './common/request-id.middleware';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ArenaMembersModule } from './modules/arena-members/arena-members.module';
import { ArenasModule } from './modules/arenas/arenas.module';
import { CourtsModule } from './modules/courts/courts.module';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { OperatingHoursModule } from './modules/operating-hours/operating-hours.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { AiModule } from './modules/ai/ai.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ReportsModule } from './modules/reports/reports.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { PaymentsModule } from './modules/payments/payments.module';

@Module({
  imports: [
    // Fase 18 (item 4): rate limiting em memória, por instância — NUNCA uma
    // garantia distribuída (ver docs/ARCHITECTURE.md, Fase 18, e o
    // comentário de REDIS_URL em .env.example: Redis já está provisionado
    // no docker-compose mas nenhum código o usa; introduzi-lo só para isto
    // seria infraestrutura nova sem necessidade comprovada para o volume
    // atual). Em produção com múltiplas instâncias, o limite efetivo por
    // usuário multiplica pelo número de instâncias — aceitável para o MVP
    // (single-instance no Railway), documentado como limitação conhecida.
    // Limite padrão generoso (qualquer rota sem override abaixo); rotas
    // sensíveis a abuso (IA, convites, reservas, disponibilidade,
    // clientes, relatórios) têm limites dedicados mais apertados via
    // @Throttle() no controller (ver cada um). Webhooks e health check
    // usam @SkipThrottle() — nunca dependem de rate limiting por IP (ver
    // justificativa nos próprios controllers).
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
        limit: Number(process.env.RATE_LIMIT_MAX ?? 300),
      },
    ]),
    HealthModule,
    AuthModule,
    UsersModule,
    WebhooksModule,
    ArenaMembersModule,
    ArenasModule,
    CourtsModule,
    IdempotencyModule,
    OperatingHoursModule,
    BookingsModule,
    AvailabilityModule,
    DashboardModule,
    InvitationsModule,
    AiModule,
    CustomersModule,
    ReportsModule,
    WhatsAppModule,
    PaymentsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  // Fase 18 (itens 5/9): registrado aqui (via NestModule.configure), não
  // como `app.use(...)` imperativo em main.ts — main.ts NUNCA é executado
  // pelos testes e2e (cada `*.e2e-spec.ts` monta seu próprio
  // `Test.createTestingModule({ imports: [AppModule] })`, igual a como
  // ClerkAuthGuard/ArenaAccessGuard já funcionam nos testes só por estarem
  // registrados via decorator/provider, nunca por causa de main.ts).
  // Registrar aqui garante que o middleware de correlação e os headers de
  // segurança HTTP estão realmente ativos em CADA teste e2e da suíte —
  // não só documentados, verificáveis (ver test/production-hardening.e2e-spec.ts).
  // Fase 20: `forRoutes('*')` (sintaxe antiga do path-to-regexp) gerava um
  // WARN de depreciação do Express em TODO boot em produção
  // ("Unsupported route path... Attempting to auto-convert to
  // '/v1/{*path}'") — funcionava (o auto-convert cobre o caso), mas
  // poluía o log a cada deploy sem necessidade. `'{*path}'` é a sintaxe
  // nomeada que o path-to-regexp novo já espera diretamente, sem shim de
  // conversão nem warning.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware, helmet()).forRoutes('{*path}');
  }
}
