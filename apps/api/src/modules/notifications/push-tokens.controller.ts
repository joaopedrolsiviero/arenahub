import { Body, Controller, Delete, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { type AuthenticatedUser, ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from '../users/users.service';
import { PushTokensService } from './push-tokens.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { RemovePushTokenDto } from './dto/remove-push-token.dto';

// M7 — o ÚNICO contrato novo desta fase (menor solução end-to-end
// necessária, ver relatório final): registrar/remover o token de push do
// dispositivo do usuário autenticado. Mesmo padrão de autorização de
// `MyBookingsController`/`MyPaymentsController` (nunca aninhado sob
// arena/court — é sobre o usuário, cross-arena por natureza).
@Controller('users/me/push-tokens')
@UseGuards(ClerkAuthGuard)
export class PushTokensController {
  constructor(
    private readonly pushTokensService: PushTokensService,
    private readonly usersService: UsersService,
  ) {}

  // Idempotente por natureza (upsert por token) — chamar de novo com o
  // MESMO token nunca cria uma segunda linha; nenhum Idempotency-Key
  // necessário (mesmo raciocínio já documentado para o cancelamento de
  // Booking: a operação já converge pro mesmo estado por construção).
  @Post()
  @HttpCode(HttpStatus.OK)
  async register(
    @CurrentUser() authUser: AuthenticatedUser,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<{ ok: true }> {
    const user = await this.usersService.findByClerkId(authUser.clerkId);
    await this.pushTokensService.register(user.id, dto.token, dto.platform);
    return { ok: true };
  }

  // Chamado no logout (item 14 do prompt) — nunca lança se o token já não
  // existir mais (deleteMany), sempre 200.
  @Delete()
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser() authUser: AuthenticatedUser,
    @Body() dto: RemovePushTokenDto,
  ): Promise<{ ok: true }> {
    const user = await this.usersService.findByClerkId(authUser.clerkId);
    await this.pushTokensService.remove(user.id, dto.token);
    return { ok: true };
  }
}
