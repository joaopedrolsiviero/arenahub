import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ClerkService } from './clerk.service';

// Minimal identity attached to the request once authenticated. Deliberately
// just the Clerk subject id — this guard answers "is this request
// authenticated?", never "what can this user do?" (that's RBAC, Fase 3+).
export interface AuthenticatedUser {
  clerkId: string;
}

type RequestWithUser = Request & { user?: AuthenticatedUser };

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(private readonly clerkService: ClerkService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Credenciais ausentes.');
    }

    try {
      const claims = await this.clerkService.verifySessionToken(token);
      request.user = { clerkId: claims.sub };
      return true;
    } catch {
      // Nunca vaza o motivo exato (assinatura inválida, expirado, JWKS
      // inacessível, etc.) — para quem chama a API, tudo isso é "não
      // autenticado".
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
  }

  private extractBearerToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }
    const token = header.slice('Bearer '.length).trim();
    return token.length > 0 ? token : undefined;
  }
}
