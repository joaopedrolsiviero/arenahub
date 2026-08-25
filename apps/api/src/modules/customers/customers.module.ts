import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArenaMembersModule } from '../arena-members/arena-members.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [AuthModule, ArenaMembersModule, PrismaModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
