import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ArenasController } from './arenas.controller';
import { ArenasService } from './arenas.service';

@Module({
  imports: [AuthModule, UsersModule, ArenaMembersModule, PrismaModule],
  controllers: [ArenasController],
  providers: [ArenasService],
  exports: [ArenasService],
})
export class ArenasModule {}
