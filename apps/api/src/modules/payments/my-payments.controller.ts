import { Controller, Get, UseGuards } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { type AuthenticatedUser, ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from '../users/users.service';
import { PaymentsService } from './payments.service';

// Fase 26, item 14 do prompt: "Minhas reservas" precisa mostrar status do
// pagamento junto do status da reserva — endpoint separado (em vez de
// aninhar em MyBookingsController) porque BookingsModule nunca importa
// PaymentsModule (mesma regra "Booking nunca depende de Payment" da Fase 4,
// aplicada também no grafo de módulos do Nest, não só no modelo de dados).
// O frontend busca as duas listas em paralelo e mescla por bookingId.
@Controller('users/me/payments')
@UseGuards(ClerkAuthGuard)
export class MyPaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async findMine(
    @CurrentUser() authUser: AuthenticatedUser,
  ): Promise<Record<string, PaymentStatus>> {
    const user = await this.usersService.findByClerkId(authUser.clerkId);
    return this.paymentsService.getLatestPaymentStatusesForUser(user.id);
  }
}
