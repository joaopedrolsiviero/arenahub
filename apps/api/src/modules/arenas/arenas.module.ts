import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { OperatingHoursModule } from '../operating-hours/operating-hours.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ArenasController } from './arenas.controller';
import { ArenasService } from './arenas.service';

@Module({
  // OperatingHoursModule (Fase 28) — reaproveita `hasAnyForArena` pra
  // compor "arena pronta" (setupStatus); nenhuma segunda query de horários
  // reimplementada aqui.
  imports: [AuthModule, UsersModule, ArenaMembersModule, OperatingHoursModule, PrismaModule],
  controllers: [ArenasController],
  providers: [ArenasService],
  exports: [ArenasService],
})
export class ArenasModule {}
