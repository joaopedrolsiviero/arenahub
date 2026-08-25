import { Body, Controller, Post, Param, UseGuards } from '@nestjs/common';
import { ArenaRole } from '@prisma/client';
import { type AuthenticatedUser, ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ArenaAccessGuard } from './arena-access.guard';
import { RequireArenaRole } from './require-arena-role.decorator';
import { ArenaMembersService, OwnershipTransferResult } from './arena-members.service';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';

// Endpoint explícito e separado de /members (item 43) — nunca PATCH
// /members/:userId. Path próprio ("ownership", não "members") deixa claro
// que essa é uma operação crítica diferente de uma edição de papel comum.
@Controller('arenas/:arenaId/ownership')
@UseGuards(ClerkAuthGuard, ArenaAccessGuard)
export class OwnershipController {
  constructor(private readonly arenaMembersService: ArenaMembersService) {}

  @Post('transfer')
  @RequireArenaRole(ArenaRole.OWNER)
  transfer(
    @Param('arenaId') arenaId: string,
    @Body() dto: TransferOwnershipDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OwnershipTransferResult> {
    return this.arenaMembersService.transferOwnership(arenaId, dto, user.clerkId);
  }
}
