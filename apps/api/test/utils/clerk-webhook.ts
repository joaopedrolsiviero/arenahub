import { Webhook } from 'standardwebhooks';

// Assina um payload de teste exatamente como o Clerk assinaria de verdade
// (mesmo algoritmo — HMAC-SHA256 sobre `${id}.${timestamp}.${payload}` —
// implementado pelo pacote `standardwebhooks`, o mesmo que @clerk/backend/
// webhooks usa por baixo dos panos). Não depende de nenhuma conta real do
// Clerk: a verificação é uma operação criptográfica simétrica offline — só
// precisa do mesmo secret dos dois lados.
export function signClerkWebhookPayload(
  secret: string,
  payload: unknown,
): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify(payload);
  const svixId = `msg_test_${Math.random().toString(36).slice(2)}`;
  const timestamp = new Date();

  const signature = new Webhook(secret).sign(svixId, timestamp, body);

  return {
    body,
    headers: {
      'svix-id': svixId,
      'svix-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
      'svix-signature': signature,
      'content-type': 'application/json',
    },
  };
}
