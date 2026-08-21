import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser } from './clerk-auth.guard';

// Reads the user attached by ClerkAuthGuard. Only valid on routes protected
// by that guard — using it elsewhere is a programming error, not a client
// error, hence the 500 instead of a 401.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

    if (!request.user) {
      throw new InternalServerErrorException(
        '@CurrentUser() usado em uma rota sem ClerkAuthGuard.',
      );
    }

    return request.user;
  },
);
