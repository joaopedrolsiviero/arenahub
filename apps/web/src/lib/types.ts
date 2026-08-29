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
  // Fase 16 — phone_number_id da Meta Cloud API, nunca o número de telefone
  // em si. `null` = arena ainda sem WhatsApp configurado.
  whatsappPhoneNumberId: string | null;
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

// Fase 10 — gestão de membros/equipe.
export interface ArenaMember {
  id: string;
  userId: string;
  role: ArenaRole;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
}

// Fase 11 — convites e transferência de ownership.
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface Invitation {
  id: string;
  email: string;
  role: ArenaRole;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedBy: { id: string; name: string | null; email: string } | null;
}

// GET /v1/invitations/:token — nunca inclui token/tokenHash, nunca dados de
// membros (item 73 do prompt).
export interface PublicInvitation {
  arenaId: string;
  arenaName: string;
  role: ArenaRole;
  email: string;
  expiresAt: string;
  status: InvitationStatus;
}

export interface OwnershipTransferResult {
  arenaId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
  completedAt: string;
}

// Fase 12: assistente de IA operacional (só leitura/análise — nunca cria,
// altera ou cancela nada). Mesmos presets mínimos do backend
// (OperationalMetricsService) — nunca inventar um novo aqui sem adicionar
// no backend primeiro.
export type AiPeriodPreset = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisWeek' | 'lastWeek';

export interface AskAiPeriod {
  preset?: AiPeriodPreset;
  from?: string;
  to?: string;
}

export interface AskAiResponse {
  answer: string;
  period: { from: string; to: string };
  timezone: string;
  generatedAt: string;
}

// Fase 14: visão operacional de clientes da arena — só leitura. "Cliente" é
// uma visão derivada (User com pelo menos uma Booking type=CUSTOMER nesta
// arena), nunca uma entidade própria no backend.
export interface CustomerSummary {
  userId: string;
  name: string | null;
  email: string;
  totalBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  totalRevenue: number;
  firstBookingAt: string;
  lastBookingAt: string;
}

export interface CustomerListResult {
  items: CustomerSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface CustomerBookingItem {
  id: string;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  total: string;
  court: { id: string; name: string };
}

// Fase 15: relatórios operacionais — só leitura, camada de apresentação
// sobre a MESMA OperationalMetricsService da IA (Fase 12). Presets incluem
// thisMonth/lastMonth (novos nesta fase) além dos já usados pela IA — nunca
// inventar um preset aqui sem existir no backend primeiro.
export type ReportPeriodPreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth';

export interface ReportQuery {
  preset?: ReportPeriodPreset;
  from?: string;
  to?: string;
}

export interface ReportSummary {
  revenue: number;
  bookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  occupancyRate: number | null;
}

export interface ReportComparison {
  revenueDeltaPct: number | null;
  confirmedBookingsDeltaPct: number | null;
  cancelledBookingsDeltaPct: number | null;
  occupancyRateDeltaPct: number | null;
}

export interface ReportSeriesPoint {
  date: string;
  revenue: number;
  confirmedBookings: number;
  cancelledBookings: number;
  occupancyRate: number | null;
}

export interface ReportCourtPerformance {
  name: string;
  confirmedBookings: number;
  cancelledBookings: number;
  revenue: number;
  occupancyRate: number | null;
}

export interface ReportDemand {
  bookingsByHour: { hour: number; count: number }[];
  peakHour: number | null;
  lowestHour: number | null;
}

export interface ReportResponse {
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  summary: ReportSummary;
  comparison: ReportComparison;
  series: ReportSeriesPoint[];
  courts: ReportCourtPerformance[];
  mostOccupiedCourtName: string | null;
  leastOccupiedCourtName: string | null;
  demand: ReportDemand;
  busiestDays: { date: string; count: number }[];
}

// Fase 17 — ciclo financeiro de uma Booking CUSTOMER, deliberadamente
// separado do ciclo operacional (BookingStatus, acima, nunca alterado por
// pagamento). PENDING é o único estado não-terminal original — todos os
// outros são definitivos (ver docs/ARCHITECTURE.md, Fase 17). REFUNDING
// (Fase 27) é o único outro estado não-terminal: reembolso solicitado, ainda
// não confirmado pelo Mercado Pago (PIX pode reembolsar de forma
// assíncrona) — nunca exibido como "reembolso concluído".
export type PaymentStatus =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUNDING'
  | 'REFUNDED';

// Nunca inclui `providerPaymentId`/`idempotencyKey`/`refundId` (IDs internos
// do gateway/da requisição — o backend já não os expõe, ver
// PaymentsService.PaymentView).
export interface PaymentView {
  id: string;
  bookingId: string;
  status: PaymentStatus;
  // Decimal do Prisma serializa como string em JSON — mesmo padrão de
  // `Booking.total`/`Court.pricePerSlot` (nunca tratar como number direto).
  amount: string;
  currency: string;
  checkoutUrl: string | null;
  pixCopyPaste: string | null;
  qrCodeBase64: string | null;
  failureReason: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  // Fase 27 — só preenchido quando o Mercado Pago já confirmou o reembolso
  // (`status === 'REFUNDED'`); nunca usado sozinho pra decidir o que exibir
  // (sempre checar `status`, nunca só "refundedAt existe").
  refundedAt: string | null;
}
