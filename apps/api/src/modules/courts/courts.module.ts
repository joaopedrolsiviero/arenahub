import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CourtsController } from './courts.controller';
import { CourtsService } from './courts.service';

@Module({
  imports: [AuthModule, ArenaMembersModule, PrismaModule],
  controllers: [CourtsController],
  providers: [CourtsService],
  // Exporta CourtsService: BookingsModule reutiliza findOne (validação
  // arena→court + 404) em vez de duplicar essa checagem — ver
  // docs/ARCHITECTURE.md, Fase 4, item 41.
  exports: [CourtsService],
})
export class CourtsModule {}
