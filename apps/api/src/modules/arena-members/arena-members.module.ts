import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ArenaMembersService } from './arena-members.service';
import { ArenaAccessGuard } from './arena-access.guard';

@Module({
  imports: [UsersModule],
  providers: [ArenaMembersService, ArenaAccessGuard],
  // Reexporta UsersModule: ArenaAccessGuard depende de UsersService, e o
  // encapsulamento de módulos do Nest exige que essa dependência também
  // esteja visível em qualquer módulo que use o guard (não só aqui) —
  // reexportar evita ter que lembrar de importar UsersModule em todo lugar
  // que usa ArenaAccessGuard (ex: CourtsModule).
  exports: [ArenaMembersService, ArenaAccessGuard, UsersModule],
})
export class ArenaMembersModule {}
