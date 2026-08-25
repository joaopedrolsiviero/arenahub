import type {
  AdminArena,
  ArenaDiscoveryDetail,
  ArenaDiscoverySummary,
  ArenaMember,
  AskAiPeriod,
  AskAiResponse,
  AvailabilityResult,
  Booking,
  Court,
  CustomerBookingItem,
  CustomerListResult,
  CustomerSummary,
  DashboardResponse,
  Invitation,
  MyBooking,
  OperatingInterval,
  OperatingIntervalInput,
  OwnershipTransferResult,
  PublicInvitation,
  ReportQuery,
  ReportResponse,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

// O backend é sempre a autoridade (regra de ouro da Fase 6) — este client
// nunca decide disponibilidade, preço ou dono de reserva; só transporta o
// que a API já validou.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Token de sessão do Clerk (getToken()) — null quando ainda não disponível. */
  token: string | null;
}

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await extractErrorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
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

function availabilityQuery(from: string, to: string): string {
  return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

export const api = {
  discoverArenas: (token: string | null): Promise<ArenaDiscoverySummary[]> =>
    request('/arenas/discover', { token }),

  discoverArena: (token: string | null, arenaId: string): Promise<ArenaDiscoveryDetail> =>
    request(`/arenas/discover/${arenaId}`, { token }),

  getAvailability: (
    token: string | null,
    arenaId: string,
    courtId: string,
    from: string,
    to: string,
  ): Promise<AvailabilityResult> =>
    request(
      `/arenas/${arenaId}/courts/${courtId}/availability${availabilityQuery(from, to)}`,
      { token },
    ),

  // Idempotency-Key é obrigatória (Fase 4) — nunca opcional aqui.
  createBooking: (
    token: string | null,
    arenaId: string,
    courtId: string,
    startsAt: string,
    idempotencyKey: string,
  ): Promise<Booking> =>
    request(`/arenas/${arenaId}/courts/${courtId}/bookings`, {
      token,
      method: 'POST',
      body: { startsAt },
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  cancelBooking: (
    token: string | null,
    arenaId: string,
    courtId: string,
    bookingId: string,
  ): Promise<Booking> =>
    request(`/arenas/${arenaId}/courts/${courtId}/bookings/${bookingId}/cancel`, {
      token,
      method: 'POST',
    }),

  myBookings: (token: string | null): Promise<MyBooking[]> => request('/users/me/bookings', { token }),

  myBooking: (token: string | null, bookingId: string): Promise<MyBooking> =>
    request(`/users/me/bookings/${bookingId}`, { token }),

  // --- Fase 7: Dashboard operacional (área administrativa) ---

  // "Minhas arenas administradas" — GET /v1/arenas já significa isso desde
  // a Fase 3, nunca ressemantizado (item 10 da Fase 7).
  myAdminArenas: (token: string | null): Promise<AdminArena[]> => request('/arenas', { token }),

  getArena: (token: string | null, arenaId: string): Promise<AdminArena> =>
    request(`/arenas/${arenaId}`, { token }),

  updateArena: (
    token: string | null,
    arenaId: string,
    dto: Partial<
      Pick<
        AdminArena,
        'name' | 'description' | 'phone' | 'email' | 'timezone' | 'whatsappPhoneNumberId'
      >
    >,
  ): Promise<AdminArena> =>
    request(`/arenas/${arenaId}`, { token, method: 'PATCH', body: dto }),

  getCourts: (token: string | null, arenaId: string): Promise<Court[]> =>
    request(`/arenas/${arenaId}/courts?includeInactive=true`, { token }),

  getCourt: (token: string | null, arenaId: string, courtId: string): Promise<Court> =>
    request(`/arenas/${arenaId}/courts/${courtId}`, { token }),

  createCourt: (
    token: string | null,
    arenaId: string,
    dto: {
      name: string;
      sport: string;
      description?: string;
      pricePerSlot?: number;
      slotDurationMinutes?: number;
      bufferMinutes?: number;
    },
  ): Promise<Court> => request(`/arenas/${arenaId}/courts`, { token, method: 'POST', body: dto }),

  updateCourt: (
    token: string | null,
    arenaId: string,
    courtId: string,
    dto: Partial<{
      name: string;
      description: string;
      pricePerSlot: number;
      slotDurationMinutes: number;
      bufferMinutes: number;
      isActive: boolean;
    }>,
  ): Promise<Court> =>
    request(`/arenas/${arenaId}/courts/${courtId}`, { token, method: 'PATCH', body: dto }),

  getOperatingHours: (token: string | null, arenaId: string): Promise<OperatingInterval[]> =>
    request(`/arenas/${arenaId}/operating-hours`, { token }),

  replaceOperatingHours: (
    token: string | null,
    arenaId: string,
    intervals: OperatingIntervalInput[],
  ): Promise<OperatingInterval[]> =>
    request(`/arenas/${arenaId}/operating-hours`, {
      token,
      method: 'PUT',
      body: { intervals },
    }),

  getDashboard: (
    token: string | null,
    arenaId: string,
    date: string | undefined,
  ): Promise<DashboardResponse> =>
    request(`/arenas/${arenaId}/dashboard${date ? `?date=${encodeURIComponent(date)}` : ''}`, {
      token,
    }),

  // --- Fase 10: gestão de membros/equipe ---

  getMembers: (token: string | null, arenaId: string): Promise<ArenaMember[]> =>
    request(`/arenas/${arenaId}/members`, { token }),

  // Identifica por e-mail (não userId — o OWNER nunca teria como conhecer o
  // id interno de outra pessoa; mesma decisão do backend, ver
  // docs/ARCHITECTURE.md Fase 10).
  addMember: (token: string | null, arenaId: string, email: string): Promise<ArenaMember> =>
    request(`/arenas/${arenaId}/members`, {
      token,
      method: 'POST',
      body: { email, role: 'ADMIN' },
    }),

  updateMemberRole: (
    token: string | null,
    arenaId: string,
    userId: string,
  ): Promise<ArenaMember> =>
    request(`/arenas/${arenaId}/members/${userId}`, {
      token,
      method: 'PATCH',
      body: { role: 'ADMIN' },
    }),

  removeMember: (token: string | null, arenaId: string, userId: string): Promise<void> =>
    request(`/arenas/${arenaId}/members/${userId}`, { token, method: 'DELETE' }),

  // --- Fase 11: convites e transferência de ownership ---

  getInvitations: (token: string | null, arenaId: string): Promise<Invitation[]> =>
    request(`/arenas/${arenaId}/invitations`, { token }),

  createInvitation: (token: string | null, arenaId: string, email: string): Promise<Invitation> =>
    request(`/arenas/${arenaId}/invitations`, {
      token,
      method: 'POST',
      body: { email, role: 'ADMIN' },
    }),

  revokeInvitation: (token: string | null, arenaId: string, invitationId: string): Promise<void> =>
    request(`/arenas/${arenaId}/invitations/${invitationId}`, { token, method: 'DELETE' }),

  resendInvitation: (
    token: string | null,
    arenaId: string,
    invitationId: string,
  ): Promise<Invitation> =>
    request(`/arenas/${arenaId}/invitations/${invitationId}/resend`, { token, method: 'POST' }),

  // Único endpoint desta fase que nunca leva token de sessão (Bearer) — o
  // convite precisa ser visível ANTES do login (item 25).
  getInvitationByToken: (inviteToken: string): Promise<PublicInvitation> =>
    request(`/invitations/${inviteToken}`, { token: null }),

  acceptInvitation: (token: string | null, inviteToken: string): Promise<void> =>
    request(`/invitations/${inviteToken}/accept`, { token, method: 'POST' }),

  transferOwnership: (
    token: string | null,
    arenaId: string,
    newOwnerUserId: string,
  ): Promise<OwnershipTransferResult> =>
    request(`/arenas/${arenaId}/ownership/transfer`, {
      token,
      method: 'POST',
      body: { newOwnerUserId },
    }),

  // --- Fase 12: assistente de IA operacional (só leitura/análise) ---

  askAi: (
    token: string | null,
    arenaId: string,
    question: string,
    period?: AskAiPeriod,
  ): Promise<AskAiResponse> =>
    request(`/arenas/${arenaId}/ai/ask`, {
      token,
      method: 'POST',
      body: period ? { question, period } : { question },
    }),

  // --- Fase 14: visão operacional de clientes da arena (só leitura) ---

  getArenaCustomers: (
    token: string | null,
    arenaId: string,
    params: { search?: string; page?: number; limit?: number } = {},
  ): Promise<CustomerListResult> => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/arenas/${arenaId}/customers${suffix}`, { token });
  },

  getArenaCustomer: (token: string | null, arenaId: string, userId: string): Promise<CustomerSummary> =>
    request(`/arenas/${arenaId}/customers/${userId}`, { token }),

  getArenaCustomerBookings: (
    token: string | null,
    arenaId: string,
    userId: string,
  ): Promise<CustomerBookingItem[]> => request(`/arenas/${arenaId}/customers/${userId}/bookings`, { token }),

  // --- Fase 15: relatórios operacionais (só leitura) ---

  getArenaReport: (
    token: string | null,
    arenaId: string,
    params: ReportQuery = {},
  ): Promise<ReportResponse> => {
    const query = new URLSearchParams();
    if (params.preset) query.set('preset', params.preset);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/arenas/${arenaId}/reports${suffix}`, { token });
  },
};
