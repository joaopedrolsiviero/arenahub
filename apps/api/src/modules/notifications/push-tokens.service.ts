import { Injectable } from '@nestjs/common';
import type { PushToken } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Ciclo de vida do token de push (M7, item 5 do prompt): instalação/login
 * gera um token novo (ou reaproveita o existente) e chama `register`;
 * logout/troca de usuário chama `remove` primeiro. `token` é `@unique`
 * globalmente — o mesmo dispositivo físico nunca acumula linhas, e
 * reassociar o MESMO token a outro usuário (logout de A, login de B no
 * mesmo aparelho) é resolvido por upsert normal, nunca uma segunda
 * identidade para o mesmo dispositivo.
 *
 * A identidade (`userId`) SEMPRE vem do usuário autenticado resolvido pelo
 * controller via ClerkAuthGuard — nunca de um campo enviado pelo cliente
 * (item 6 do prompt: "o backend jamais deve aceitar um userId arbitrário").
 */
@Injectable()
export class PushTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, token: string, platform: string): Promise<PushToken> {
    return this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      // Cobre reinstalação/token alterado (Expo pode reemitir o mesmo token
      // pro mesmo dispositivo) e troca de usuário no mesmo aparelho —
      // sempre a identidade de QUEM está chamando agora, nunca preserva o
      // dono anterior.
      update: { userId, platform },
    });
  }

  // Escopado por userId ALÉM de token (defesa em profundidade — token já é
  // @unique, então isto nunca deveria discriminar um caso real, mas garante
  // que a remoção nunca pode ser usada como vetor de "apagar o token de
  // outra pessoa" caso a unicidade global algum dia mude). `deleteMany`
  // (nunca `delete`) porque o alvo pode legitimamente não existir mais
  // (double logout, token já removido) — nunca deve lançar nesse caso.
  async remove(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  async findTokensForUser(userId: string): Promise<PushToken[]> {
    return this.prisma.pushToken.findMany({ where: { userId } });
  }

  // Chamado pelo PushNotificationsService quando o Expo Push Service
  // reporta `DeviceNotRegistered` para um token — autolimpeza (item 5 do
  // prompt: "tratamento de tokens inválidos"), nunca deixa lixo acumulando.
  async removeByToken(token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { token } });
  }
}
