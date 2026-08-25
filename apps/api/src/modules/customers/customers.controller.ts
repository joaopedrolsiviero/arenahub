import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ArenaRole } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ArenaAccessGuard } from '../arena-members/arena-access.guard';
import { RequireArenaRole } from '../arena-members/require-arena-role.decorator';
import {
  CustomerBookingItem,
  CustomerListResult,
  CustomerSummary,
  CustomersService,
} from './customers.service';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

// Fase 14: visão operacional de clientes — só OWNER/ADMIN, explícito via
// @RequireArenaRole(OWNER, ADMIN) (mesma convenção da Fase 12/AiController,
// nunca o @RequireArenaRole() vazio "qualquer membro" — CUSTOMER nunca é
// ArenaMember, então já ficaria de fora de qualquer forma, mas a intenção
// fica explícita). Reaproveita ClerkAuthGuard/ArenaAccessGuard sem
// modificação — nenhum sistema de autorização novo.
@Controller('arenas/:arenaId/customers')
@UseGuards(ClerkAuthGuard, ArenaAccessGuard)
@RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(
    @Param('arenaId') arenaId: string,
    @Query() query: ListCustomersQueryDto,
  ): Promise<CustomerListResult> {
    return this.customersService.listCustomers(arenaId, query);
  }

  @Get(':userId')
  getSummary(
    @Param('arenaId') arenaId: string,
    @Param('userId') userId: string,
  ): Promise<CustomerSummary> {
    return this.customersService.getCustomerSummary(arenaId, userId);
  }

  @Get(':userId/bookings')
  getBookings(
    @Param('arenaId') arenaId: string,
    @Param('userId') userId: string,
  ): Promise<CustomerBookingItem[]> {
    return this.customersService.getCustomerBookings(arenaId, userId);
  }
}
