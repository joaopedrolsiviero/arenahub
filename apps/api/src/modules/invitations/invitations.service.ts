import { randomBytes, createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArenaRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ArenaMembersService } from '../arena-members/arena-members.service';
import { InvitationEmailService } from './email/invitation-email.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';

const INVITATION_EXPIRES_DAYS = Number(process.env.INVITATION_EXPIRES_DAYS ?? 7);

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface InvitationSummary {
  id: string;
  email: string;
  role: ArenaRole;
  status: InvitationStatus;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  invitedBy: { id: string; name: string | null; email: string } | null;
}

// Resposta pública de GET /v1/invitations/:token (item 73) — nunca inclui
// tokenHash, dados de outros membros, ou qualquer coisa administrativa da
// arena além do nome. `email` é o e-mail convidado (não mascarado): o
// frontend precisa dele pra comparar contra o usuário autenticado e mostrar
// "este convite foi enviado para outro endereço" (item 63) — mascarar
// quebraria essa checagem.
export interface PublicInvitation {
  arenaId: string;
  arenaName: string;
  role: ArenaRole;
  email: string;
  expiresAt: Date;
  status: InvitationStatus;
}

interface InvitationRow {
  id: string;
  email: string;
  role: ArenaRole;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function deriveStatus(invitation: InvitationRow): InvitationStatus {
  if (invitation.acceptedAt) return 'ACCEPTED';
  if (invitation.revokedAt) return 'REVOKED';
  if (invitation.expiresAt.getTime() <= Date.now()) return 'EXPIRED';
  return 'PENDING';
}

function generateToken(): { token: string; tokenHash: string } {
  // 256 bits de entropia, alfabeto URL-safe — vai direto num path de URL de
  // e-mail sem precisar de encoding adicional (item 8).
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

// SHA-256 é apropriado aqui porque o segredo (token) já tem alta entropia
// própria — diferente de senha, não precisa de um KDF lento tipo bcrypt/
// argon2 (que existe pra compensar BAIXA entropia de senhas escolhidas por
// humanos). Nunca MD5/SHA-1 (item 10).
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function expiresAtFromNow(): Date {
  return new Date(Date.now() + INVITATION_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly arenaMembersService: ArenaMembersService,
    private readonly emailService: InvitationEmailService,
  ) {}

  async createInvitation(
    arenaId: string,
    dto: CreateInvitationDto,
    requesterClerkId: string,
  ): Promise<InvitationSummary> {
    const email = normalizeEmail(dto.email);
    const requester = await this.usersService.findByClerkId(requesterClerkId);

    // Itens 15-17: e-mail já pertence a um membro (OWNER ou ADMIN) desta
    // arena -> não cria convite, nunca duplica membership.
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser && (await this.arenaMembersService.isMember(existingUser.id, arenaId))) {
      throw new ConflictException('Este usuário já faz parte da equipe desta arena.');
    }

    // Item 14: convite ainda aberto (nem aceito, nem revogado) pra este
    // e-mail+role já existe -> conflito amigável, aponta pro reenvio em vez
    // de criar um segundo convite concorrente.
    const openInvitation = await this.prisma.arenaInvitation.findFirst({
      where: { arenaId, email, role: ArenaRole.ADMIN, acceptedAt: null, revokedAt: null },
      select: { id: true },
    });
    if (openInvitation) {
      throw new ConflictException(
        'Já existe um convite pendente para este e-mail. Revogue-o ou reenvie em vez de criar outro.',
      );
    }

    const { arena, invitation } = await this.persistInvitation(arenaId, email, requester.id);
    await this.sendInvitationEmail(invitation, arena.name, requester.name ?? requester.email);
    return this.toSummary(invitation, {
      id: requester.id,
      name: requester.name,
      email: requester.email,
    });
  }

  async listInvitations(arenaId: string): Promise<InvitationSummary[]> {
    const invitations = await this.prisma.arenaInvitation.findMany({
      where: { arenaId },
      orderBy: { createdAt: 'desc' },
      include: { invitedBy: { select: { id: true, name: true, email: true } } },
    });
    return invitations.map((invitation) => this.toSummary(invitation, invitation.invitedBy));
  }

  // Item 38: só revoga convite ainda pendente/aberto — nunca transforma
  // ACCEPTED em REVOKED (histórico de um convite já usado não muda).
  async revokeInvitation(arenaId: string, invitationId: string): Promise<void> {
    const invitation = await this.findOwnInvitationOrThrow(arenaId, invitationId);
    if (invitation.acceptedAt) {
      throw new ConflictException('Este convite já foi aceito e não pode ser revogado.');
    }
    if (invitation.revokedAt) {
      return; // já revogado — idempotente, não é erro reenviar a mesma revogação.
    }

    const result = await this.prisma.arenaInvitation.updateMany({
      where: { id: invitationId, arenaId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      // Alguém aceitou/revogou entre o findOwnInvitationOrThrow e aqui —
      // mesma proteção de corrida usada no accept (item 13/32).
      throw new ConflictException('Este convite não está mais pendente.');
    }
  }

  // Item 39: gera um token NOVO no MESMO registro — nunca mantém dois
  // tokens válidos pro mesmo convite. Convite expirado pode ser reenviado;
  // revogado ou aceito não podem.
  async resendInvitation(arenaId: string, invitationId: string): Promise<InvitationSummary> {
    const invitation = await this.findOwnInvitationOrThrow(arenaId, invitationId);
    if (invitation.acceptedAt) {
      throw new ConflictException('Este convite já foi aceito e não pode ser reenviado.');
    }
    if (invitation.revokedAt) {
      throw new ConflictException('Este convite foi revogado — crie um novo convite.');
    }

    const { token, tokenHash } = generateToken();
    const expiresAt = expiresAtFromNow();

    const updated = await this.prisma.arenaInvitation.update({
      where: { id: invitationId },
      data: { tokenHash, expiresAt },
      include: { invitedBy: { select: { id: true, name: true, email: true } } },
    });

    const arena = await this.prisma.arena.findUniqueOrThrow({
      where: { id: arenaId },
      select: { name: true },
    });
    await this.sendInvitationEmail(
      { ...updated, id: updated.id },
      arena.name,
      updated.invitedBy?.name ?? updated.invitedBy?.email ?? null,
      token,
    );

    return this.toSummary(updated, updated.invitedBy);
  }

  async getPublicByToken(token: string): Promise<PublicInvitation> {
    const tokenHash = hashToken(token);
    const invitation = await this.prisma.arenaInvitation.findUnique({
      where: { tokenHash },
      include: { arena: { select: { id: true, name: true } } },
    });
    // Resposta genérica pra token inexistente (item 76) — não distingue
    // "nunca existiu" de "revogado", evitando enumeração. Uma vez que o
    // hash BATE com um convite real, o requisitante já provou posse do
    // token exato (alta entropia) — aí sim mostramos o status real (itens
    // 64-66 do frontend dependem disso pra dar a mensagem certa).
    if (!invitation) {
      throw new NotFoundException('Convite inválido ou indisponível.');
    }

    return {
      arenaId: invitation.arena.id,
      arenaName: invitation.arena.name,
      role: invitation.role,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      status: deriveStatus(invitation),
    };
  }

  // Fluxo crítico (itens 31-34): localizar por hash, validar identidade,
  // aceitar e criar o ArenaMember de forma atômica e segura sob concorrência
  // — duas aceitações simultâneas do MESMO token nunca podem resultar em
  // dois ArenaMember. A trava é a condição `acceptedAt: null, revokedAt:
  // null` dentro de um `updateMany`: o Postgres serializa updates
  // concorrentes na mesma linha, então só uma das duas chamadas consegue
  // casar essa condição — a outra recebe count=0 e falha com 409, nunca
  // avança pra criar o membership.
  async acceptInvitation(token: string, requesterClerkId: string): Promise<void> {
    const tokenHash = hashToken(token);
    const invitation = await this.prisma.arenaInvitation.findUnique({ where: { tokenHash } });
    if (!invitation) {
      throw new NotFoundException('Convite inválido ou indisponível.');
    }
    if (invitation.revokedAt) {
      throw new ConflictException('Este convite foi revogado.');
    }
    if (invitation.acceptedAt) {
      throw new ConflictException('Este convite já foi utilizado.');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('Este convite expirou.');
    }

    // Item 26/27: a identidade vem do Clerk (via User já sincronizado),
    // nunca de um campo enviado pelo cliente no corpo da requisição.
    const user = await this.usersService.findByClerkId(requesterClerkId);
    if (normalizeEmail(user.email) !== invitation.email) {
      throw new ForbiddenException('Este convite foi enviado para outro endereço de e-mail.');
    }

    if (await this.arenaMembersService.isMember(user.id, invitation.arenaId)) {
      throw new ConflictException('Você já faz parte da equipe desta arena.');
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.arenaInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), acceptedByUserId: user.id },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Este convite já foi utilizado.');
      }

      try {
        await tx.arenaMember.create({
          data: { arenaId: invitation.arenaId, userId: user.id, role: invitation.role },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Você já faz parte da equipe desta arena.');
        }
        throw error;
      }
    });
  }

  private async findOwnInvitationOrThrow(
    arenaId: string,
    invitationId: string,
  ): Promise<InvitationRow> {
    const invitation = await this.prisma.arenaInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation || invitation.arenaId !== arenaId) {
      // Nunca 403 aqui — quem chega até este service já passou pelo
      // ArenaAccessGuard(OWNER) da ARENA da rota; um invitationId de outra
      // arena simplesmente "não existe" neste contexto (item 106).
      throw new NotFoundException('Convite não encontrado nesta arena.');
    }
    return invitation;
  }

  private async persistInvitation(
    arenaId: string,
    email: string,
    invitedByUserId: string,
  ): Promise<{ arena: { name: string }; invitation: InvitationRow & { token: string } }> {
    const { token, tokenHash } = generateToken();
    try {
      const invitation = await this.prisma.arenaInvitation.create({
        data: {
          arenaId,
          email,
          role: ArenaRole.ADMIN,
          tokenHash,
          expiresAt: expiresAtFromNow(),
          invitedByUserId,
        },
      });
      const arena = await this.prisma.arena.findUniqueOrThrow({
        where: { id: arenaId },
        select: { name: true },
      });
      return { arena, invitation: { ...invitation, token } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'Já existe um convite pendente para este e-mail. Revogue-o ou reenvie em vez de criar outro.',
        );
      }
      throw error;
    }
  }

  private async sendInvitationEmail(
    invitation: InvitationRow,
    arenaName: string,
    invitedByName: string | null,
    tokenOverride?: string,
  ): Promise<void> {
    const token = tokenOverride ?? (invitation as InvitationRow & { token?: string }).token;
    if (!token) return;

    const webAppUrl = process.env.WEB_APP_URL ?? 'http://localhost:3000';
    // Item 71: e-mail é efeito posterior best-effort — nunca faz o convite
    // falhar se o "provedor" (ou a falta de um) tiver problema.
    await this.emailService.sendInvitation({
      to: invitation.email,
      arenaName,
      invitedByName,
      acceptUrl: `${webAppUrl.split(',')[0]}/convites/${token}`,
      expiresAt: invitation.expiresAt,
    });
  }

  private toSummary(
    invitation: InvitationRow,
    invitedBy: { id: string; name: string | null; email: string } | null,
  ): InvitationSummary {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: deriveStatus(invitation),
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
      invitedBy,
    };
  }
}
