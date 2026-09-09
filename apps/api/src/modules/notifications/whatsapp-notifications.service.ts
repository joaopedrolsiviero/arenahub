import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { Booking } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppProvider } from '../whatsapp/providers/whatsapp-provider';
import {
  formatDateLabel,
  formatPriceBRL,
  formatTimeLabel,
  whatsappMessages,
} from '../whatsapp/messages';

type NotificationKind =
  'booking_confirmed' | 'booking_cancelled' | 'payment_confirmed' | 'refund_confirmed';

interface BookingContext {
  courtName: string;
  dateLabel: string;
  timeLabel: string;
}

/**
 * Fase W2 — canal proativo do WhatsApp: reage a eventos de negócio já
 * decididos em outro lugar (BookingsController, PaymentsWebhookService),
 * nunca decide nada de domínio aqui — mesma separação borda/domínio já
 * usada em `PushNotificationsService` (M7), do qual este service é a
 * contraparte no canal WhatsApp (texto livre em vez de push nativo).
 *
 * Deliberadamente SEPARADO de `WhatsAppService`/`ConversationService`
 * (item 10 do prompt da fase): o envio proativo nunca lê nem altera
 * `WhatsAppConversation` — não depende de o cliente já ter uma conversa
 * ativa (a identidade do destinatário vem sempre de `User.phone`, o mesmo
 * campo sincronizado do Clerk, nunca de um número que o cliente digitou),
 * e nunca corrompe o estado de uma conversa em andamento.
 *
 * Reaproveita literalmente `WhatsAppProvider` (mesma abstração, mesmo
 * adapter `MetaWhatsAppProviderService` — registrado de novo aqui, não uma
 * segunda integração: a classe é sem estado, só lê `process.env` por
 * chamada, então duas instâncias DI são equivalentes a uma) e as MESMAS
 * strings de `whatsapp/messages.ts` já usadas pelas respostas diretas do
 * bot — nenhum texto novo inventado além do necessário (refundConfirmed).
 *
 * Janela de 24h da Meta (item 3 do prompt): esta implementação só sabe
 * enviar mensagem de texto livre (`WhatsAppProvider.sendMessage`, único
 * método existente hoje) — a Cloud API só entrega texto livre pra um
 * cliente que mandou mensagem nas últimas 24h; fora dessa janela, a Meta
 * exige uma mensagem de TEMPLATE pré-aprovado, que este projeto não
 * implementa (não há credencial/registro real da Meta neste ambiente pra
 * validar templates de verdade). Como muitos destinatários daqui nunca
 * mandaram mensagem pelo WhatsApp (reservaram pelo site/app), não há sequer
 * um `WhatsAppConversation` pra inspecionar nesses casos — não existe um
 * jeito confiável de "adivinhar" a janela sem essa integração. A decisão
 * desta fase é tentar o envio de texto livre sempre; se a Meta rejeitar por
 * estar fora da janela (não observável neste ambiente sem credencial real),
 * o erro cai no mesmo tratamento de falha de qualquer outro (log, nunca
 * desfaz o evento de negócio) — nunca finge que a mensagem foi entregue.
 */
@Injectable()
export class WhatsAppNotificationsService {
  private readonly logger = new Logger(WhatsAppNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappProvider: WhatsAppProvider,
  ) {}

  async notifyBookingConfirmed(booking: Booking): Promise<void> {
    await this.notify(booking, 'booking_confirmed', (ctx) =>
      whatsappMessages.bookingConfirmed(
        ctx.courtName,
        ctx.dateLabel,
        ctx.timeLabel,
        formatPriceBRL(Number(booking.total)),
      ),
    );
  }

  async notifyBookingCancelled(booking: Booking): Promise<void> {
    await this.notify(booking, 'booking_cancelled', (ctx) =>
      whatsappMessages.cancelConfirmed(`${ctx.courtName} — ${ctx.dateLabel} às ${ctx.timeLabel}`),
    );
  }

  async notifyPaymentConfirmed(booking: Booking): Promise<void> {
    // Mesma string exata que a resposta direta do bot usa pra PaymentStatus.PAID
    // (whatsapp/messages.ts) — nenhum texto duplicado/paralelo.
    await this.notify(booking, 'payment_confirmed', () =>
      whatsappMessages.paymentStatus('PAID', null),
    );
  }

  async notifyRefundConfirmed(booking: Booking): Promise<void> {
    await this.notify(booking, 'refund_confirmed', () => whatsappMessages.refundConfirmed);
  }

  private async notify(
    booking: Booking,
    kind: NotificationKind,
    buildText: (ctx: BookingContext) => string,
  ): Promise<void> {
    // Mesmo guard de PushNotificationsService: BLOCK/MAINTENANCE têm
    // userId do administrador que criou, nunca um cliente esperando
    // notificação; userId nulo idem.
    if (!booking.userId || booking.type !== 'CUSTOMER') {
      return;
    }

    try {
      const court = await this.prisma.court.findUnique({
        where: { id: booking.courtId },
        select: {
          name: true,
          arena: { select: { name: true, timezone: true, whatsappPhoneNumberId: true } },
        },
      });
      // Arena sem número de WhatsApp configurado — nunca envia (nada pra
      // usar como `fromPhoneNumberId`, item de segurança: nunca inventa um
      // remetente).
      if (!court || !court.arena.whatsappPhoneNumberId) {
        return;
      }

      // Identidade do destinatário SEMPRE de `User.phone` (sincronizado do
      // Clerk) — nunca de um telefone que o cliente digitou em algum lugar,
      // nunca de `WhatsAppConversation` (que pode nem existir pra quem
      // nunca mandou mensagem via WhatsApp).
      const user = await this.prisma.user.findUnique({
        where: { id: booking.userId },
        select: { phone: true },
      });
      if (!user?.phone) {
        return;
      }

      const zoned = DateTime.fromJSDate(booking.startsAt, { zone: court.arena.timezone });
      const text = buildText({
        courtName: court.name,
        dateLabel: formatDateLabel(zoned),
        timeLabel: formatTimeLabel(zoned.hour, zoned.minute),
      });

      // Nunca IDs internos, nunca payload bruto do provider, nunca dado de
      // outro usuário/arena — só o texto pt-BR já validado em
      // whatsapp/messages.ts.
      await this.whatsappProvider.sendMessage({
        fromPhoneNumberId: court.arena.whatsappPhoneNumberId,
        to: user.phone,
        text,
      });
    } catch (error) {
      // Falha de ENTREGA nunca pode desfazer o evento de negócio que já
      // aconteceu (reserva criada/cancelada, pagamento aprovado, reembolso
      // confirmado) — só loga, mesma disciplina de PushNotificationsService/
      // refundIfPaid.
      this.logger.error(
        `Falha ao notificar via WhatsApp (${kind}) para Booking ${booking.id}: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    }
  }
}
