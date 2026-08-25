import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { UserWebhookEvent } from '@clerk/backend';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePhoneE164 } from './phone.util';

// Nunca inclui clerkId (irrelevante para o cliente, que já tem sua própria
// sessão Clerk) nem qualquer campo interno que venha a ser adicionado ao
// model User no futuro — funciona como uma allowlist explícita, não uma
// blocklist.
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByClerkId(clerkId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });

    if (!user) {
      // Caso conhecido: o webhook do Clerk ainda não processou o evento
      // user.created para este usuário (race condition entre o login no
      // frontend e a chegada do webhook). Documentado no relatório da Fase 2.
      throw new NotFoundException(
        'Usuário autenticado ainda não sincronizado. Tente novamente em instantes.',
      );
    }

    return toPublicUser(user);
  }

  // Fase 16: resolve a identidade de quem envia uma mensagem de WhatsApp —
  // sempre o MESMO User usado pelo resto do produto (Clerk continua sendo a
  // única fonte de identidade; nenhuma conta paralela criada aqui). `null`
  // (nunca exceção) quando não há vínculo: quem chama decide a mensagem
  // amigável a devolver, isso não é um "recurso não encontrado" HTTP.
  async findByPhone(phone: string): Promise<PublicUser | null> {
    const normalized = normalizePhoneE164(phone);
    if (!normalized) {
      return null;
    }
    const user = await this.prisma.user.findUnique({ where: { phone: normalized } });
    return user ? toPublicUser(user) : null;
  }

  // Chamado pelo WebhooksController após a assinatura do evento já ter sido
  // verificada — esta função nunca deve ser chamada com payload não confiável.
  async syncFromClerkEvent(event: UserWebhookEvent): Promise<void> {
    if (event.type === 'user.deleted') {
      const clerkId = event.data.id;
      if (!clerkId) {
        return;
      }
      await this.prisma.user.deleteMany({ where: { clerkId } });
      this.logger.log(`User removido (clerkId=${clerkId})`);
      return;
    }

    const data = event.data;
    const primaryEmail = data.email_addresses.find(
      (candidate) => candidate.id === data.primary_email_address_id,
    );
    const email = (primaryEmail ?? data.email_addresses[0])?.email_address;

    if (!email) {
      this.logger.warn(`Evento ${event.type} sem email para clerkId=${data.id}, ignorado`);
      return;
    }

    const primaryPhone = data.phone_numbers.find(
      (candidate) => candidate.id === data.primary_phone_number_id,
    );
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ').trim() || null;
    // Normalizado (Fase 16, item 7) — Clerk já entrega E.164, mas a coluna é
    // `@unique` agora (identidade do WhatsApp depende de um match exato), e
    // normalizar aqui garante que a comparação nunca dependa do formato
    // exato que o Clerk devolveu.
    const phone = normalizePhoneE164(primaryPhone?.phone_number);

    await this.prisma.user.upsert({
      where: { clerkId: data.id },
      create: {
        clerkId: data.id,
        email: email.toLowerCase(),
        name,
        phone,
        avatarUrl: data.image_url || null,
      },
      update: {
        email: email.toLowerCase(),
        name,
        phone,
        avatarUrl: data.image_url || null,
      },
    });
    this.logger.log(`User sincronizado (clerkId=${data.id}, event=${event.type})`);
  }
}
