import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { type AuthenticatedUser, ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from '../users/users.service';
import { BookingsService, MyBooking } from './bookings.service';

// Fase 6, item 28-31: "minhas reservas" — cross-arena por natureza (as
// reservas de um cliente podem estar em quadras/arenas diferentes), por
// isso não aninhado sob /arenas/:arenaId/courts/:courtId como o resto de
// BookingsController. Cancelamento continua sendo a rota já existente
// (/arenas/:arenaId/courts/:courtId/bookings/:bookingId/cancel) — o
// frontend monta essa URL a partir de `court`/`court.arena` que vêm
// embutidos na resposta abaixo, sem precisar de um endpoint novo de
// cancelamento (item 34).
@Controller('users/me/bookings')
@UseGuards(ClerkAuthGuard)
export class MyBookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async findMine(@CurrentUser() authUser: AuthenticatedUser): Promise<MyBooking[]> {
    const user = await this.usersService.findByClerkId(authUser.clerkId);
    return this.bookingsService.findMyBookings(user.id);
  }

  @Get(':bookingId')
  async findOne(
    @CurrentUser() authUser: AuthenticatedUser,
    @Param('bookingId') bookingId: string,
  ): Promise<MyBooking> {
    const user = await this.usersService.findByClerkId(authUser.clerkId);
    return this.bookingsService.findMyBookingDetail(user.id, bookingId);
  }
}
