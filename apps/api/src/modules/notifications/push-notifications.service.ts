import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { Booking } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PushTokensService } from './push-tokens.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type NotificationType = 'booking_confirmed' | 'booking_cancelled' | 'payment_confirmed';

interface ExpoPushTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Disparo real de push via Expo Push Service (M7) — `fetch` nativo, sem
 * `expo-server-sdk` (mesma filosofia de dependências mínimas já usada em
 * MercadoPagoPaymentProviderService/MetaWhatsAppProviderService: um POST
 * JSON simples não justifica uma dependência nova). NUNCA lança para quem
 * chamou — uma falha de push jamais pode derrubar a criação/cancelamento de
 * reserva ou o processamento do webhook de pagamento que a disparou (mesma
 * disciplina de `PaymentsService.refundIfPaid`).
 *
 * Payload da notificação (item 6 do prompt: "não coloque dados sensíveis") —
 * contém só `type` + `bookingId`: o suficiente para o Mobile navegar ao
 * detalhe da reserva já existente (M5), que por sua vez SEMPRE relê os
 * dados reais via `GET /users/me/bookings/:bookingId` (404 se não for do
 * usuário) — nunca confiando em nada do payload da notificação em si. Nunca
 * inclui QR code, código PIX, valor, token de sessão ou qualquer dado
 * financeiro/de autenticação.
 */
@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushTokensService: PushTokensService,
  ) {}

  async notifyBookingConfirmed(booking: Booking): Promise<void> {
    await this.notifyBookingEvent(booking, 'booking_confirmed', 'Reserva confirmada');
  }

  async notifyBookingCancelled(booking: Booking): Promise<void> {
    await this.notifyBookingEvent(booking, 'booking_cancelled', 'Reserva cancelada');
  }

  async notifyPaymentConfirmed(booking: Booking): Promise<void> {
    await this.notifyBookingEvent(booking, 'payment_confirmed', 'Pagamento confirmado');
  }

  private async notifyBookingEvent(
    booking: Booking,
    type: NotificationType,
    title: string,
  ): Promise<void> {
    // BLOCK/MAINTENANCE têm `userId` do administrador que criou (Fase 7),
    // nunca um cliente esperando notificação de reserva — nunca notifica
    // esses tipos. `userId` nulo (bloqueio programático futuro) idem.
    if (!booking.userId || booking.type !== 'CUSTOMER') {
      return;
    }

    try {
      const court = await this.prisma.court.findUnique({
        where: { id: booking.courtId },
        select: { name: true, arena: { select: { name: true, timezone: true } } },
      });
      if (!court) {
        return;
      }

      const when = this.formatWhen(booking.startsAt, court.arena.timezone);
      const body =
        type === 'payment_confirmed'
          ? `Pagamento da reserva em ${court.arena.name} · ${court.name} · ${when} confirmado.`
          : `${court.arena.name} · ${court.name} · ${when}`;

      await this.sendToUser(booking.userId, {
        title,
        body,
        data: { type, bookingId: booking.id },
      });
    } catch (error) {
      this.logger.error(
        `Falha ao montar notificação (${type}) para Booking ${booking.id}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }

  private formatWhen(startsAt: Date, timezone: string): string {
    return DateTime.fromJSDate(startsAt, { zone: 'utc' })
      .setZone(timezone)
      .setLocale('pt-BR')
      .toFormat("dd/MM 'às' HH:mm");
  }

  private async sendToUser(
    userId: string,
    notification: { title: string; body: string; data: Record<string, unknown> },
  ): Promise<void> {
    try {
      const tokens = await this.pushTokensService.findTokensForUser(userId);
      if (tokens.length === 0) {
        return;
      }

      const messages = tokens.map((pushToken) => ({
        to: pushToken.token,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        sound: 'default',
      }));

      // Sem accessToken configurado (EXPO_ACCESS_TOKEN, opcional — ver
      // .env.example), o Expo Push Service aceita a requisição no modo
      // padrão (não é exigido pra uso básico, só para "Enhanced Push
      // Notification Security", que este projeto não tem credencial pra
      // habilitar nesta fase — ver relatório final, seção BLOCKED BY
      // ENVIRONMENT).
      const accessToken = process.env.EXPO_ACCESS_TOKEN;
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(messages),
      });

      if (!response.ok) {
        this.logger.error(`Expo Push Service respondeu ${response.status}.`);
        return;
      }

      const result = (await response.json()) as { data?: ExpoPushTicket[] };
      const tickets = result.data ?? [];

      // Autolimpeza (item 5 do prompt: "tratamento de tokens inválidos") —
      // um ticket por mensagem, na MESMA ordem em que foram enviadas
      // (contrato documentado do Expo Push Service).
      await Promise.all(
        tickets.map(async (ticket, index) => {
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            const invalidToken = tokens[index]?.token;
            if (invalidToken) {
              await this.pushTokensService.removeByToken(invalidToken);
              this.logger.log('Token de push inválido removido (DeviceNotRegistered).');
            }
          }
        }),
      );
    } catch (error) {
      this.logger.error(
        `Falha ao enviar notificação push para userId=${userId}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }
}
