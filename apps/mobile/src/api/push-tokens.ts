import { apiRequest } from './client';

// POST/DELETE /v1/users/me/push-tokens — confirmado em
// push-tokens.controller.ts (M7): exige ClerkAuthGuard, identidade sempre
// resolvida no backend a partir da sessão (nunca um userId enviado por
// aqui). Idempotente por natureza (upsert por token no register; deleteMany
// no remove) — nenhuma chave de idempotência necessária, mesmo raciocínio
// já usado no cancelamento de Booking.
export function registerPushToken(
  token: string | null,
  pushToken: string,
  platform: 'ios' | 'android',
): Promise<{ ok: true }> {
  return apiRequest('/users/me/push-tokens', {
    token,
    method: 'POST',
    body: { token: pushToken, platform },
  });
}

export function removePushToken(token: string | null, pushToken: string): Promise<{ ok: true }> {
  return apiRequest('/users/me/push-tokens', {
    token,
    method: 'DELETE',
    body: { token: pushToken },
  });
}
