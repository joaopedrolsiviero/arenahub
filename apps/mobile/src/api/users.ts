import { apiRequest } from './client';
import type { PublicUser } from '@/types/user';

// GET /v1/users/me — confirmado em users.controller.ts (M6): exige
// ClerkAuthGuard, devolve PublicUser (id/email/name/phone/avatarUrl/
// createdAt/updatedAt). 404 quando o webhook do Clerk ainda não sincronizou
// o usuário (condição de corrida documentada em UsersService.findByClerkId,
// nunca um "usuário não existe" definitivo).
//
// NÃO existe `updateMyProfile`/PATCH aqui — auditoria confirmou que
// `PATCH /v1/users/me` está documentado em docs/ARCHITECTURE.md (Parte 9)
// mas nunca foi implementado (users.controller.ts só tem `@Get('me')`,
// sem nenhum `@Patch`, DTO ou método de update em UsersService). Os únicos
// campos de domínio do usuário (name/phone/avatarUrl/email) são escritos
// exclusivamente pelo webhook do Clerk (UsersService.syncFromClerkEvent) —
// ou seja, o Clerk é a fonte de escrita real, nunca um PATCH do ArenaHub.
// Ver relatório final da M6, seção 3, para os detalhes completos desta
// divergência e a decisão tomada (edição via Clerk, nunca uma chamada a um
// endpoint inexistente).
export function getMyProfile(token: string | null): Promise<PublicUser> {
  return apiRequest('/users/me', { token });
}
