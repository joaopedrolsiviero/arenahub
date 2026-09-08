// Espelham exatamente as respostas do backend (apps/api/src/modules/arenas,
// availability) — confirmado lendo arenas.service.ts e availability.service.ts
// diretamente antes de escrever este arquivo (M2, item 5), mesmo princípio
// já usado em apps/web/src/lib/types.ts: nunca duplicar regra de negócio
// aqui, só o formato do dado que atravessa a borda.

export type Sport = 'BEACH_VOLLEYBALL';

// Configuração de pagamento da arena — só usada nesta fase pra decidir o
// que exibir (M3 decide o fluxo de pagamento em si); nunca usada pelo
// mobile pra pular disponibilidade ou qualquer outra regra.
export type PaymentMode = 'ONLINE' | 'IN_PERSON';

export interface ArenaDiscoverySummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sports: Sport[];
  isReady: boolean;
}

export interface CourtPublic {
  id: string;
  name: string;
  sport: Sport;
  description: string | null;
  // Decimal do Prisma serializa como string em JSON — nunca tratar como
  // number direto (mesma regra do Web, apps/web/src/lib/types.ts).
  pricePerSlot: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  imageUrl: string | null;
}

export interface ArenaDiscoveryDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  courts: CourtPublic[];
  isReady: boolean;
  paymentMode: PaymentMode;
}

export interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
  available: boolean;
}

export interface AvailabilityResult {
  courtId: string;
  timezone: string;
  from: string;
  to: string;
  slots: AvailabilitySlot[];
}
