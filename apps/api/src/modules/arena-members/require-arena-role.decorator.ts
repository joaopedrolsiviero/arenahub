import { SetMetadata } from '@nestjs/common';
import { ArenaRole } from '@prisma/client';

export const REQUIRE_ARENA_ROLE_KEY = 'requireArenaRole';

/**
 * Aplica-se a um handler protegido por ArenaAccessGuard, na mesma rota que
 * tem `:arenaId` como route param.
 *
 * `@RequireArenaRole()` (sem argumentos) — qualquer membro da arena serve
 * (rotas de leitura).
 * `@RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)` — exige um desses
 * papéis (rotas de escrita).
 */
export const RequireArenaRole = (...roles: ArenaRole[]) =>
  SetMetadata(REQUIRE_ARENA_ROLE_KEY, roles);
