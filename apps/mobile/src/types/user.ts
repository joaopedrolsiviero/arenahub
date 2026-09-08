// Espelha exatamente PublicUser do backend (apps/api/src/modules/users/users.service.ts,
// UsersService.toPublicUser) — confirmado lendo users.controller.ts/users.service.ts
// antes de escrever este arquivo (M6). Datas chegam como string (Date
// serializado em JSON), nunca Date direto. Nunca inclui `clerkId` (o backend
// já não expõe) nem nenhum campo administrativo (role/membership/permissões
// não existem neste model — User é só identidade, nunca autorização).
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
