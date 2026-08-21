import { Injectable } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';

export type ClerkJwtPayload = Awaited<ReturnType<typeof verifyToken>>;

// Thin wrapper around @clerk/backend's verifyToken — exists so ClerkAuthGuard
// depends on an injectable NestJS provider instead of the SDK function
// directly, which makes the guard trivially testable without hitting Clerk's
// network/JWKS endpoint (see clerk-auth.guard.spec.ts).
@Injectable()
export class ClerkService {
  verifySessionToken(token: string): Promise<ClerkJwtPayload> {
    return verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
  }
}
