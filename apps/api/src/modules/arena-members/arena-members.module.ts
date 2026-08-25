import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ArenaMembersService } from './arena-members.service';
import { ArenaAccessGuard } from './arena-access.guard';
import { ArenaMembersController } from './arena-members.controller';
import { OwnershipController } from './ownership.controller';

@Module({
  // AuthModule: o novo ArenaMembersController usa ClerkAuthGuard (Fase 10)
  // — mesmo motivo pelo qual CourtsModule/ArenasModule também o importam.
  imports: [AuthModule, UsersModule],
  controllers: [ArenaMembersController, OwnershipController],
  providers: [ArenaMembersService, ArenaAccessGuard],
  // Reexporta UsersModule: ArenaAccessGuard depende de UsersService, e o
  // encapsulamento de módulos do Nest exige que essa dependência também
  // esteja visível em qualquer módulo que use o guard (não só aqui) —
  // reexportar evita ter que lembrar de importar UsersModule em todo lugar
  // que usa ArenaAccessGuard (ex: CourtsModule).
  exports: [ArenaMembersService, ArenaAccessGuard, UsersModule],
})
export class ArenaMembersModule {}
