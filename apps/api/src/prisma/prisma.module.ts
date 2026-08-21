import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Módulo global (ver docs/ARCHITECTURE.md, Parte 6): qualquer módulo de
// domínio pode injetar PrismaService sem reimportar este módulo. Importado
// pela primeira vez em UsersModule (Fase 2) — a partir daí, todo módulo de
// domínio que precisa do Postgres (Fase 3: arenas, courts) passou a exigir
// um Postgres vivo para inicializar, inclusive em testes e2e.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
