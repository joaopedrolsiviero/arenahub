import { Injectable, Logger } from '@nestjs/common';

export interface InvitationEmailPayload {
  to: string;
  arenaName: string;
  invitedByName: string | null;
  acceptUrl: string;
  expiresAt: Date;
}

// Abstração deliberada (item 20 do prompt): o domínio de convites nunca
// conhece um provedor de e-mail específico. Classe abstrata (não interface)
// porque interfaces TS não existem em runtime — precisamos de um token de
// injeção real para o Nest resolver a implementação concreta
// (`InvitationsModule` decide qual).
export abstract class InvitationEmailService {
  abstract sendInvitation(payload: InvitationEmailPayload): Promise<void>;
}

// Único adapter existente nesta fase: nenhum provedor de e-mail real está
// configurado neste ambiente (nenhuma credencial de SMTP/SendGrid/SES
// existe no projeto) — inventar uma dependência de credencial que não
// existe seria pior do que documentar a limitação (item 21). Em
// desenvolvimento/teste, registra o link no log (única forma de testar o
// fluxo de aceite sem um provedor real). Em produção, NUNCA loga o link —
// só um aviso de que o envio real depende de configuração futura (itens 21,
// 22, 71): a criação do convite nunca falha por causa disso, o e-mail é um
// efeito posterior best-effort, nunca uma dependência crítica da transação.
@Injectable()
export class ConsoleInvitationEmailService implements InvitationEmailService {
  private readonly logger = new Logger(ConsoleInvitationEmailService.name);

  // Não há trabalho assíncrono real neste adapter (nenhum provedor de
  // e-mail configurado) — o retorno continua `Promise<void>` porque é isso
  // que a abstração `InvitationEmailService` declara para qualquer adapter
  // futuro que de fato fizer I/O.
  sendInvitation(payload: InvitationEmailPayload): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      this.logger.warn(
        `Convite criado para ${payload.arenaName}, mas nenhum provedor de e-mail está ` +
          'configurado para produção — o e-mail não foi enviado. Configure um adapter real ' +
          'de InvitationEmailService antes de depender deste fluxo em produção.',
      );
      return Promise.resolve();
    }

    this.logger.log(
      `[dev] Convite para ${payload.to} (${payload.arenaName}, convidado por ` +
        `${payload.invitedByName ?? 'alguém'}) — expira em ${payload.expiresAt.toISOString()}. ` +
        `Link: ${payload.acceptUrl}`,
    );
    return Promise.resolve();
  }
}
