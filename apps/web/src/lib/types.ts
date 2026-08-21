// Espelham exatamente as respostas do backend (apps/api) — nunca duplicar
// regra de negócio aqui, só o formato do dado que atravessa a borda (mesma
// distinção já usada para packages/shared: "forma", não "regra").

export type Sport = 'BEACH_VOLLEYBALL';

export type Weekday =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

export interface ArenaDiscoverySummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sports: Sport[];
}

export interface CourtPublic {
  id: string;
  name: string;
  sport: Sport;
  description: string | null;
  // Decimal do Prisma serializa como string em JSON — nunca tratar como
  // number de ponto flutuante (item 74 da Fase 6).
  pricePerSlot: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
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

export type BookingStatus = 'CONFIRMED' | 'CANCELLED';
export type BookingType = 'CUSTOMER' | 'BLOCK' | 'MAINTENANCE';

export interface Booking {
  id: string;
  courtId: string;
  userId: string | null;
  type: BookingType;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  bufferMinutesSnapshot: number;
  total: string;
  reason: string | null;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyBooking {
  id: string;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  total: string;
  court: {
    id: string;
    name: string;
    sport: Sport;
    arena: { id: string; name: string; slug: string; timezone: string };
  };
}

// Fase 7 — Dashboard operacional. "Admin" aqui só distingue a origem do
// dado (endpoints exclusivos de ArenaMember), nunca uma segunda cópia da
// regra de autorização — o backend continua sendo a única autoridade.

export type ArenaRole = 'OWNER' | 'ADMIN';

// GET /v1/arenas ("minhas arenas administradas", Fase 3 — nunca
// ressemantizado) — usado como fonte do seletor de arena do Dashboard.
export interface AdminArena {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  role: ArenaRole;
}

export interface Court {
  id: string;
  arenaId: string;
  name: string;
  sport: Sport;
  description: string | null;
  isActive: boolean;
  pricePerSlot: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
}

export interface OperatingInterval {
  id: string;
  dayOfWeek: Weekday;
  // HH:mm — nunca minutos crus no contrato da API (mesma decisão do backend).
  opensAt: string;
  closesAt: string;
}

// Corpo de PUT .../operating-hours — sem `id` (substituição completa).
export interface OperatingIntervalInput {
  dayOfWeek: Weekday;
  opensAt: string;
  closesAt: string;
}

export interface DashboardBookingItem {
  id: string;
  courtId: string;
  courtName: string;
  type: BookingType;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  total: string;
  reason: string | null;
  user: { id: string; name: string | null; email: string } | null;
}

export interface DashboardCourt {
  id: string;
  name: string;
  sport: Sport;
  isActive: boolean;
  occupancy: DashboardBookingItem[];
}

export interface DashboardSummary {
  confirmedBookings: number;
  cancelledBookings: number;
  blocks: number;
  maintenance: number;
}

export interface DashboardResponse {
  arena: { id: string; name: string; timezone: string };
  date: string;
  operatingHours: OperatingInterval[];
  summary: DashboardSummary;
  courts: DashboardCourt[];
  upcomingBookings: DashboardBookingItem[];
}
