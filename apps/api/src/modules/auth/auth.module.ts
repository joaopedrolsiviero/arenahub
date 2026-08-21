import { Module } from '@nestjs/common';
import { ClerkService } from './clerk.service';
import { ClerkAuthGuard } from './clerk-auth.guard';

// Não é @Global(): módulos que precisam autenticar rotas importam AuthModule
// explicitamente e usam ClerkAuthGuard/CurrentUser — deixa claro, em cada
// módulo, quais rotas dependem de autenticação.
@Module({
  providers: [ClerkService, ClerkAuthGuard],
  exports: [ClerkService, ClerkAuthGuard],
})
export class AuthModule {}
