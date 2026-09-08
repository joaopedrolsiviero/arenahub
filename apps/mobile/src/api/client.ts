import { env } from '@/lib/env';

// Mesmo contrato de erro de apps/web/src/lib/api.ts — o backend é sempre a
// autoridade (M0, Seção 13): este client nunca decide disponibilidade,
// preço ou dono de reserva, só transporta o que a API já validou. `status`
// permite ao chamador diferenciar 400/401/403/404/409/422/500 (M0, Seção
// "Mapear erros") assim que os endpoints de domínio existirem — nenhum
// deles é tratado nesta fase, só a estrutura para tratá-los depois.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Erro de rede/timeout — nunca chegou a ter uma resposta HTTP (dispositivo
// offline, backend fora do ar). Distinto de ApiError porque não existe
// `status` nenhum pra reportar.
export class ApiNetworkError extends Error {
  constructor(message = 'Não foi possível conectar ao ArenaHub. Verifique sua conexão.') {
    super(message);
    this.name = 'ApiNetworkError';
  }
}

interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Token de sessão do Clerk (getToken()) — null quando ainda não disponível/deslogado. */
  token?: string | null;
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) {
      return body.message.join(', ');
    }
    if (typeof body.message === 'string') {
      return body.message;
    }
  } catch {
    // Resposta não era JSON (ex: erro de infra) — segue com mensagem genérica.
  }
  return `Erro ${response.status}`;
}

// Pequeno e genérico de propósito (item 13 do prompt desta fase) — nenhum
// endpoint de domínio (arenas/courts/availability/bookings/payments) é
// implementado aqui ainda; isso entra fase a fase, conforme o mapa de
// endpoints já auditado na M0.
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${env.apiUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiNetworkError();
  }

  if (!response.ok) {
    throw new ApiError(response.status, await extractErrorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  // Mesmo achado da Fase 23 do Web: um corpo vazio (Content-Length: 0) faz
  // `response.json()` lançar `SyntaxError` — lendo como texto primeiro e
  // tratando vazio como `null` evita isso sem depender do backend mudar.
  const text = await response.text();
  if (!text) {
    return null as T;
  }
  return JSON.parse(text) as T;
}
