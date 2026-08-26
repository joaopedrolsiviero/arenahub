import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type AuthenticatedUser, ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from '../users/users.service';
import { PaymentsService, PaymentView } from './payments.service';

// Aninhado sob `users/me/bookings/:bookingId`, mesma convenção de
// `MyBookingsController` (Fase 6) — cross-arena por natureza (o cliente
// paga a PRÓPRIA reserva, em qualquer arena). Sem `@Body()` em nenhum
// método: não há nenhum campo legítimo que o cliente possa enviar (item 4
// do prompt — "nunca aceite do frontend: amount/total/price/status/..."),
// então a defesa mais forte contra mass assignment é simplesmente não
// existir um DTO pra aceitar nada.
@Controller('users/me/bookings/:bookingId')
@UseGuards(ClerkAuthGuard)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly usersService: UsersService,
  ) {}

  // Mesmo padrão de Idempotency-Key obrigatória já usado pela criação de
  // Booking (Fase 4/BookingsController) — nenhum mecanismo novo.
  //
  // Fase 18 (item 4/19): cada tentativa nova chama o gateway de pagamento
  // (custo/rate limit do lado do Mercado Pago também) — limite dedicado no
  // mesmo patamar do endpoint de IA, pela mesma razão (endpoint caro que
  // fala com um provider externo).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  async createPayment(
    @CurrentUser() authUser: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PaymentView> {
    this.assertIdempotencyKey(idempotencyKey);
    const user = await this.usersService.findByClerkId(authUser.clerkId);
    return this.paymentsService.createPayment(user.id, bookingId, idempotencyKey);
  }

  @Get('payment')
  async getPayment(
    @CurrentUser() authUser: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<PaymentView | null> {
    const user = await this.usersService.findByClerkId(authUser.clerkId);
    return this.paymentsService.getPaymentForBooking(user.id, bookingId);
  }

  private assertIdempotencyKey(key: string | undefined): asserts key is string {
    if (!key || key.trim().length === 0) {
      throw new BadRequestException('Header Idempotency-Key é obrigatório.');
    }
  }
}
