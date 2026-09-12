import { Injectable, Logger } from '@nestjs/common';
import {
  ConsoleInvitationEmailService,
  InvitationEmailPayload,
  InvitationEmailService,
} from './invitation-email.service';

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_TIMEOUT_MS = 15_000;
// Fase de fechamento de convites (2026-09) — remetente fixo do domínio
// oficial (sivierotech.com.br), decisão de produto desta fase, não um
// detalhe de deploy: por isso é uma constante, não uma env var (diferente
// de AI_PROVIDER_MODEL/PAYMENT_TIMEOUT_MS, que variam por ambiente).
const FROM_ADDRESS = 'ArenaHub <convites@sivierotech.com.br>';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Item 6 do prompt: simples, sem token separado, sem dado sensível da
// arena além do nome — o link já contém tudo que o backend precisa pra
// validar o aceite (mesma regra de sempre: token de alta entropia,
// nunca reconstruído a partir de outra informação).
function renderInvitationHtml(payload: InvitationEmailPayload): string {
  const arenaName = escapeHtml(payload.arenaName);
  const invitedByName = payload.invitedByName ? escapeHtml(payload.invitedByName) : null;
  const acceptUrl = escapeHtml(payload.acceptUrl);
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td style="font-size:18px;font-weight:bold;padding-bottom:16px;">ArenaHub</td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:1.5;padding-bottom:16px;">
                ${invitedByName ? `${invitedByName} convidou você` : 'Você foi convidado'} para administrar
                <strong>${arenaName}</strong> no ArenaHub.
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${acceptUrl}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;">Aceitar convite</a>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#71717a;padding-bottom:16px;">
                Se o botão não funcionar, copie e cole este link no navegador:<br />
                <a href="${acceptUrl}" style="color:#3f3f46;">${acceptUrl}</a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#a1a1aa;border-top:1px solid #e4e4e7;padding-top:16px;">
                Se você não esperava este convite, pode ignorar este e-mail com segurança — nenhuma
                ação será tomada sem que você aceite.<br />
                Enviado por ArenaHub — Siviero Tech.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

interface ResendErrorBody {
  message?: string;
  name?: string;
}

/**
 * Adapter real de `InvitationEmailService` (fecha a lacuna documentada
 * desde a Fase 11: nenhum provedor real estava configurado). `fetch`
 * nativo do Node, sem SDK — mesma filosofia de dependências mínimas já
 * seguida por `OpenAiAiProviderService`/`MetaWhatsAppProviderService`/
 * `MercadoPagoPaymentProviderService` (nenhuma dessas usa o SDK oficial do
 * respectivo provedor).
 *
 * Sem `RESEND_API_KEY` configurada, degrada pro MESMO comportamento de
 * `ConsoleInvitationEmailService` (nunca lança, loga o link só fora de
 * produção) — preserva 100% o fluxo local/teste existente sem exigir uma
 * chave real pra desenvolver.
 */
@Injectable()
export class ResendInvitationEmailService implements InvitationEmailService {
  private readonly logger = new Logger(ResendInvitationEmailService.name);
  private readonly consoleFallback = new ConsoleInvitationEmailService();

  async sendInvitation(payload: InvitationEmailPayload): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return this.consoleFallback.sendInvitation(payload);
    }

    const timeoutMs = Number(process.env.RESEND_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [payload.to],
          subject: `Convite para administrar ${payload.arenaName} no ArenaHub`,
          html: renderInvitationHtml(payload),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Nunca repassa o corpo bruto do erro (poderia vazer detalhe
        // interno da conta Resend) — só um resumo sanitizado, e NUNCA a
        // URL/token do convite (item 8).
        const body = (await response.json().catch(() => null)) as ResendErrorBody | null;
        this.logger.error(
          `Resend respondeu ${response.status} em ${Date.now() - startedAt}ms` +
            (body?.message ? ` (${body.message})` : '') +
            ` — invitation destino=${this.maskEmail(payload.to)}, arena=${payload.arenaName}.`,
        );
        throw new Error(`Resend respondeu ${response.status}`);
      }

      this.logger.log(
        `E-mail de convite enviado via Resend em ${Date.now() - startedAt}ms ` +
          `(destino=${this.maskEmail(payload.to)}, arena=${payload.arenaName}).`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error(`Resend não respondeu em ${timeoutMs}ms — timeout.`);
        throw new Error('Timeout ao enviar e-mail via Resend.');
      }
      if (error instanceof Error && error.message.startsWith('Resend respondeu')) {
        throw error;
      }
      this.logger.error(
        `Falha ao chamar Resend: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      );
      throw new Error('Falha ao enviar e-mail via Resend.');
    } finally {
      clearTimeout(timeout);
    }
  }

  // Item 8 do prompt: log pode informar o destinatário, mas mascarado é
  // mais conservador que expor o e-mail completo em texto puro nos logs
  // de produção — mantém o suficiente pra correlacionar com o invitation
  // id já logado pelo chamador (InvitationsService).
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***';
    const visible = local.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
  }
}
