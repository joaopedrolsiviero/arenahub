import { DateTime } from 'luxon';
import { PaymentStatus } from '@prisma/client';

// Todo texto que o cliente vê nesta fase vem SOMENTE daqui — nunca prosa
// gerada pelo LLM (a única saída do modelo, em `intent.service.ts`, é um
// JSON fechado de classificação, nunca texto mostrado ao cliente). Isso é a
// principal defesa contra prompt injection (item 28/48): mesmo que o
// classificador seja completamente manipulado por uma mensagem maliciosa, o
// pior que ele pode produzir é `UNKNOWN` — nenhuma resposta possível
// interpola texto do LLM na mensagem final. Mesmo padrão de
// `ai/prompts.ts` (Fase 12): strings centralizadas, nunca espalhadas pelo
// service (item 62: sempre pt-BR, curtas, sem IDs internos, sem jargão
// técnico).

export function formatDateLabel(date: DateTime): string {
  return date.setLocale('pt-BR').toFormat('dd/MM');
}

export function formatTimeLabel(hour: number, minute: number): string {
  return minute === 0 ? `${hour}h` : `${hour}h${String(minute).padStart(2, '0')}`;
}

export function formatPriceBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export interface NumberedOption {
  label: string;
}

function numberedList(options: NumberedOption[]): string {
  return options.map((option, index) => `${index + 1}. ${option.label}`).join('\n');
}

export const whatsappMessages = {
  identityNotLinked:
    'Não encontramos uma conta ArenaHub vinculada a este número. Cadastre-se no site/app e adicione este telefone ao seu perfil para usar o WhatsApp.',

  genericHelp:
    'Posso ajudar você a: consultar horários disponíveis, fazer uma reserva, ver ou cancelar suas reservas, e informações da arena (endereço, quadras, preços). O que você gostaria?',

  aiUnavailable:
    'Não consegui entender sua mensagem agora. Tente novamente, ou diga algo como "reservar", "minhas reservas", "cancelar" ou "informações da arena".',

  askDate: 'Para qual dia você gostaria de reservar?',
  askTime: (dateLabel: string) => `Certo, ${dateLabel}. Que horário?`,
  invalidDate: 'Não entendi a data. Pode informar algo como "amanhã", "sábado" ou "25/12"?',
  invalidTime: 'Não entendi o horário. Pode informar algo como "19h" ou "19:30"?',

  noCourtsAvailable: (dateLabel: string, timeLabel: string) =>
    `Nenhuma quadra disponível em ${dateLabel} às ${timeLabel}. Quer tentar outro horário?`,

  courtOptions: (options: { name: string; priceBRL: string }[]) =>
    `Encontrei estas opções:\n${numberedList(options.map((o) => ({ label: `${o.name} — ${o.priceBRL}` })))}\nQual você prefere? Responda com o número.`,

  invalidNumericChoice: (max: number) => `Não entendi. Responda com um número de 1 a ${max}.`,

  bookingSummary: (courtName: string, dateLabel: string, timeLabel: string, priceBRL: string) =>
    `Confirmo a reserva da ${courtName}, ${dateLabel}, às ${timeLabel}, por ${priceBRL}?\n` +
    'Responda "sim" para confirmar ou "não" para desistir.',

  confirmationUnclear: 'Não entendi. Responda "sim" para confirmar ou "não" para desistir.',
  confirmationExpired: 'Essa confirmação expirou. Pode repetir o que você gostaria de fazer?',

  bookingConfirmed: (courtName: string, dateLabel: string, timeLabel: string, priceBRL: string) =>
    `Reserva confirmada! 🏐\n${courtName}\n${dateLabel} às ${timeLabel}\n${priceBRL}`,

  // W1 — arena ONLINE: a reserva já está confirmada, mas só é garantida
  // após o pagamento (mesma regra do site/app). O código PIX vem SEMPRE do
  // backend/provider (PaymentsService/Mercado Pago) — nunca gerado ou
  // alterado aqui.
  bookingConfirmedPixPending: (
    courtName: string,
    dateLabel: string,
    timeLabel: string,
    priceBRL: string,
    pixCopyPaste: string,
  ) =>
    `Reserva confirmada! 🏐\n${courtName}\n${dateLabel} às ${timeLabel}\n${priceBRL}\n\n` +
    `Para garantir sua reserva, finalize o pagamento via PIX (copia e cola):\n${pixCopyPaste}\n\n` +
    'Envie "status" a qualquer momento para conferir se o pagamento já foi aprovado.',

  bookingConfirmedPaymentFailed: (courtName: string, dateLabel: string, timeLabel: string) =>
    `Reserva confirmada! 🏐\n${courtName}\n${dateLabel} às ${timeLabel}\n\n` +
    'Não consegui gerar o pagamento PIX agora. Envie "status" em alguns instantes para tentar novamente — nenhuma cobrança duplicada será feita.',

  paymentStatusNotFound: 'Não encontrei nenhum pagamento para consultar no momento.',

  paymentStatus: (status: PaymentStatus, pixCopyPaste: string | null) => {
    switch (status) {
      case PaymentStatus.PAID:
        return 'Seu pagamento foi aprovado! ✅ Reserva confirmada.';
      case PaymentStatus.PENDING:
        return pixCopyPaste
          ? `Seu pagamento ainda está pendente. Aqui está o código PIX novamente:\n${pixCopyPaste}`
          : 'Seu pagamento ainda está pendente.';
      case PaymentStatus.FAILED:
        return 'O pagamento não foi aprovado. Envie "status" novamente em instantes ou entre em contato com a arena.';
      case PaymentStatus.EXPIRED:
        return 'O prazo para pagamento expirou. Entre em contato com a arena para verificar sua reserva.';
      case PaymentStatus.CANCELLED:
        return 'Este pagamento foi cancelado.';
      case PaymentStatus.REFUNDING:
        return 'Seu reembolso está sendo processado.';
      case PaymentStatus.REFUNDED:
        return 'Seu pagamento foi reembolsado.';
      default:
        return 'Não consegui identificar o status do pagamento agora.';
    }
  },

  bookingDeclined: 'Tudo bem, a reserva não foi confirmada.',
  bookingConflict:
    'Esse horário acabou de ser reservado por outra pessoa. Quer que eu verifique outras opções?',
  bookingOutsideHours: 'Esse horário está fora do funcionamento da arena.',
  bookingError: 'Não consegui concluir a reserva agora. Tente novamente em instantes.',

  noUpcomingBookings: 'Você não tem reservas futuras nesta arena.',
  myBookingsList: (items: { label: string }[]) =>
    `Suas próximas reservas nesta arena:\n${numberedList(items)}`,

  cancelNoMatches: 'Não encontrei nenhuma reserva sua para cancelar nesta arena.',
  cancelOptions: (items: { label: string }[]) =>
    `Qual reserva você quer cancelar?\n${numberedList(items)}\nResponda com o número.`,
  cancelSummary: (label: string) =>
    `Confirma o cancelamento de: ${label}?\nResponda "sim" para confirmar ou "não" para manter a reserva.`,
  cancelConfirmed: (label: string) => `Reserva cancelada: ${label}.`,
  cancelDeclined: 'Ok, sua reserva continua confirmada.',
  cancelError: 'Não consegui cancelar agora. Tente novamente em instantes.',

  // W2 — notificação proativa (nunca uma resposta a mensagem do cliente):
  // só é enviada quando `PaymentsService.refundIfPaid` confirma
  // sincronamente `status: 'REFUNDED'` na resposta do provider (nunca um
  // estado "solicitado"/"em processamento" — ver payments.service.ts e o
  // relatório da fase pra decisão completa sobre o que fica de fora).
  refundConfirmed: 'Reembolso confirmado — o valor já foi devolvido. 💸',

  arenaInfo: (name: string, phone: string | null, description: string | null) =>
    [`${name}`, description, phone ? `Telefone: ${phone}` : null].filter(Boolean).join('\n'),

  courtsInfo: (courts: { name: string; sport: string }[]) =>
    courts.length === 0
      ? 'Não há quadras ativas no momento.'
      : `Quadras disponíveis:\n${numberedList(courts.map((c) => ({ label: c.name })))}`,

  pricesInfo: (courts: { name: string; priceBRL: string; durationMinutes: number }[]) =>
    courts.length === 0
      ? 'Não tenho essa informação disponível no momento.'
      : `Preços por horário de ${courts[0]!.durationMinutes} minutos:\n` +
        numberedList(courts.map((c) => ({ label: `${c.name} — ${c.priceBRL}` }))),

  unknownInfo: 'Não tenho essa informação disponível no momento.',
};
