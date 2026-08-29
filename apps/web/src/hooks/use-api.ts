'use client';

import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AskAiPeriod, ReportQuery } from '@/lib/types';

/**
 * Todo hook aqui busca um token fresco do Clerk antes de cada chamada (nunca
 * cacheia o token em estado — ele expira e o Clerk gerencia a renovação).
 */
function useToken() {
  const { getToken } = useAuth();
  return getToken;
}

export function useDiscoverArenas() {
  const getToken = useToken();
  return useQuery({
    queryKey: ['discover-arenas'],
    queryFn: async () => api.discoverArenas(await getToken()),
  });
}

export function useDiscoverArena(arenaId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['discover-arena', arenaId],
    queryFn: async () => api.discoverArena(await getToken(), arenaId!),
    enabled: !!arenaId,
  });
}

export function useAvailability(
  arenaId: string | undefined,
  courtId: string | undefined,
  from: string | undefined,
  to: string | undefined,
) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['availability', arenaId, courtId, from, to],
    queryFn: async () => api.getAvailability(await getToken(), arenaId!, courtId!, from!, to!),
    enabled: !!arenaId && !!courtId && !!from && !!to,
    // Disponibilidade muda rápido (outra pessoa pode reservar a qualquer
    // momento) — nunca reaproveitar cache antigo como se ainda fosse válido.
    staleTime: 0,
  });
}

export function useCreateBooking(arenaId: string, courtId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      startsAt,
      idempotencyKey,
    }: {
      startsAt: string;
      idempotencyKey: string;
    }) => api.createBooking(await getToken(), arenaId, courtId, startsAt, idempotencyKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['availability', arenaId, courtId] });
      await queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
    },
  });
}

export function useMyBookings() {
  const getToken = useToken();
  return useQuery({
    queryKey: ['my-bookings'],
    queryFn: async () => api.myBookings(await getToken()),
  });
}

// Fase 26, item 14: consultado em paralelo com `useMyBookings` na tela
// "Minhas reservas" pra mostrar status do pagamento junto do status da
// reserva, sem N+1 (uma chamada só pra todas as reservas do usuário).
export function useMyPaymentStatuses() {
  const getToken = useToken();
  return useQuery({
    queryKey: ['my-payment-statuses'],
    queryFn: async () => api.getMyPaymentStatuses(await getToken()),
  });
}

export function useMyBooking(bookingId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['my-bookings', bookingId],
    queryFn: async () => api.myBooking(await getToken(), bookingId!),
    enabled: !!bookingId,
  });
}

// --- Fase 7: Dashboard operacional (área administrativa) ---

// Fase 28 — cria a arena e já invalida "minhas arenas administradas" (a
// própria criação, no backend, torna o usuário OWNER na mesma transação —
// ver ArenasService.create), então a lista já reflete a arena nova sem
// precisar de um reload.
export function useCreateArena() {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Parameters<typeof api.createArena>[1]) =>
      api.createArena(await getToken(), dto),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-arenas'] });
    },
  });
}

export function useMyAdminArenas() {
  const getToken = useToken();
  return useQuery({
    queryKey: ['admin-arenas'],
    queryFn: async () => api.myAdminArenas(await getToken()),
  });
}

export function useArena(arenaId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['admin-arena', arenaId],
    queryFn: async () => api.getArena(await getToken(), arenaId!),
    enabled: !!arenaId,
  });
}

export function useUpdateArena(arenaId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Parameters<typeof api.updateArena>[2]) =>
      api.updateArena(await getToken(), arenaId, dto),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-arena', arenaId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-arenas'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', arenaId] });
    },
  });
}

export function useCourts(arenaId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['admin-courts', arenaId],
    queryFn: async () => api.getCourts(await getToken(), arenaId!),
    enabled: !!arenaId,
  });
}

export function useCourt(arenaId: string | undefined, courtId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['admin-court', arenaId, courtId],
    queryFn: async () => api.getCourt(await getToken(), arenaId!, courtId!),
    enabled: !!arenaId && !!courtId,
  });
}

export function useCreateCourt(arenaId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Parameters<typeof api.createCourt>[2]) =>
      api.createCourt(await getToken(), arenaId, dto),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-courts', arenaId] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', arenaId] });
    },
  });
}

export function useUpdateCourt(arenaId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      courtId,
      dto,
    }: {
      courtId: string;
      dto: Parameters<typeof api.updateCourt>[3];
    }) => api.updateCourt(await getToken(), arenaId, courtId, dto),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-courts', arenaId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-court', arenaId, variables.courtId] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', arenaId] });
    },
  });
}

export function useOperatingHours(arenaId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['operating-hours', arenaId],
    queryFn: async () => api.getOperatingHours(await getToken(), arenaId!),
    enabled: !!arenaId,
  });
}

export function useReplaceOperatingHours(arenaId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (intervals: Parameters<typeof api.replaceOperatingHours>[2]) =>
      api.replaceOperatingHours(await getToken(), arenaId, intervals),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['operating-hours', arenaId] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', arenaId] });
      // Horário mudou -> disponibilidade do cliente também pode ter mudado.
      await queryClient.invalidateQueries({ queryKey: ['availability', arenaId] });
    },
  });
}

export function useDashboard(arenaId: string | undefined, date: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['dashboard', arenaId, date],
    queryFn: async () => api.getDashboard(await getToken(), arenaId!, date),
    enabled: !!arenaId,
  });
}

// --- Fase 10: gestão de membros/equipe ---

export function useArenaMembers(arenaId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['arena-members', arenaId],
    queryFn: async () => api.getMembers(await getToken(), arenaId!),
    enabled: !!arenaId,
  });
}

export function useAddMember(arenaId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => api.addMember(await getToken(), arenaId, email),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['arena-members', arenaId] });
    },
  });
}

export function useUpdateMemberRole(arenaId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => api.updateMemberRole(await getToken(), arenaId, userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['arena-members', arenaId] });
    },
  });
}

export function useRemoveMember(arenaId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => api.removeMember(await getToken(), arenaId, userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['arena-members', arenaId] });
    },
  });
}

// --- Fase 11: convites e transferência de ownership ---

export function useArenaInvitations(arenaId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['arena-invitations', arenaId],
    queryFn: async () => api.getInvitations(await getToken(), arenaId!),
    enabled: !!arenaId,
  });
}

export function useCreateInvitation(arenaId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => api.createInvitation(await getToken(), arenaId, email),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['arena-invitations', arenaId] });
    },
  });
}

export function useRevokeInvitation(arenaId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) =>
      api.revokeInvitation(await getToken(), arenaId, invitationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['arena-invitations', arenaId] });
    },
  });
}

export function useResendInvitation(arenaId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) =>
      api.resendInvitation(await getToken(), arenaId, invitationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['arena-invitations', arenaId] });
    },
  });
}

// Público — nunca busca token de sessão, funciona antes do login (item 25).
export function useInvitationByToken(inviteToken: string | undefined) {
  return useQuery({
    queryKey: ['invitation-by-token', inviteToken],
    queryFn: () => api.getInvitationByToken(inviteToken!),
    enabled: !!inviteToken,
    retry: false,
  });
}

export function useAcceptInvitation() {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (inviteToken: string) => api.acceptInvitation(await getToken(), inviteToken),
    onSuccess: async () => {
      // Após aceitar, o usuário passa a administrar uma arena nova —
      // invalida a lista de arenas administradas (item 58).
      await queryClient.invalidateQueries({ queryKey: ['admin-arenas'] });
    },
  });
}

export function useTransferOwnership(arenaId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (newOwnerUserId: string) =>
      api.transferOwnership(await getToken(), arenaId, newOwnerUserId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['arena-members', arenaId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-arenas'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-arena', arenaId] });
    },
  });
}

// --- Fase 12: assistente de IA operacional (só leitura/análise) ---

// Mutation, não query — cada pergunta é um efeito novo, nunca uma resposta
// "cacheável" reaproveitada por chave (item 23 do prompt da fase: os dados
// por trás da resposta podem ter mudado entre uma pergunta e a próxima).
export function useAskAi(arenaId: string) {
  const getToken = useToken();
  return useMutation({
    mutationFn: async ({ question, period }: { question: string; period?: AskAiPeriod }) =>
      api.askAi(await getToken(), arenaId, question, period),
  });
}

// --- Fase 14: visão operacional de clientes da arena (só leitura) ---

export function useArenaCustomers(
  arenaId: string,
  params: { search?: string; page?: number; limit?: number } = {},
) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['arena-customers', arenaId, params.search ?? '', params.page ?? 1, params.limit ?? 20],
    queryFn: async () => api.getArenaCustomers(await getToken(), arenaId, params),
    enabled: !!arenaId,
  });
}

export function useArenaCustomer(arenaId: string, userId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['arena-customer', arenaId, userId],
    queryFn: async () => api.getArenaCustomer(await getToken(), arenaId, userId!),
    enabled: !!arenaId && !!userId,
  });
}

export function useArenaCustomerBookings(arenaId: string, userId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['arena-customer-bookings', arenaId, userId],
    queryFn: async () => api.getArenaCustomerBookings(await getToken(), arenaId, userId!),
    enabled: !!arenaId && !!userId,
  });
}

export function useCancelBooking() {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      arenaId,
      courtId,
      bookingId,
    }: {
      arenaId: string;
      courtId: string;
      bookingId: string;
    }) => api.cancelBooking(await getToken(), arenaId, courtId, bookingId),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      await queryClient.invalidateQueries({
        queryKey: ['availability', variables.arenaId, variables.courtId],
      });
      // Fase 27 — cancelar pode ter disparado um reembolso no backend;
      // refaz a consulta do pagamento pra refletir REFUNDING/REFUNDED sem
      // esperar o próximo poll (que só existe enquanto PENDING/REFUNDING).
      await queryClient.invalidateQueries({ queryKey: ['booking-payment', variables.bookingId] });
    },
  });
}

// --- Fase 15: relatórios operacionais (só leitura) ---

export function useArenaReport(arenaId: string | undefined, params: ReportQuery) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['arena-report', arenaId, params.preset ?? '', params.from ?? '', params.to ?? ''],
    queryFn: async () => api.getArenaReport(await getToken(), arenaId!, params),
    enabled: !!arenaId,
  });
}

// --- Fase 17: pagamentos (ciclo financeiro de "minhas reservas") ---

export function useBookingPayment(bookingId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['booking-payment', bookingId],
    queryFn: async () => api.getBookingPayment(await getToken(), bookingId!),
    enabled: !!bookingId,
    // Um PIX pendente pode mudar de status a qualquer momento (webhook do
    // provider) sem nenhuma ação do próprio usuário nesta aba — refaz a
    // consulta periodicamente enquanto a tela estiver aberta, mesma
    // necessidade de "nunca reaproveitar cache antigo como se ainda fosse
    // válido" já registrada para `useAvailability` (Fase 4). REFUNDING
    // (Fase 27) é o mesmo caso — reembolso de PIX pode ficar assíncrono, sem
    // webhook documentado; só uma nova leitura resolve pra REFUNDED.
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING' || query.state.data?.status === 'REFUNDING' ? 5_000 : false,
  });
}

export function useCreateBookingPayment(bookingId: string) {
  const getToken = useToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (idempotencyKey: string) =>
      api.createBookingPayment(await getToken(), bookingId, idempotencyKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['booking-payment', bookingId] });
    },
  });
}
