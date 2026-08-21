'use client';

import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

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

export function useMyBooking(bookingId: string | undefined) {
  const getToken = useToken();
  return useQuery({
    queryKey: ['my-bookings', bookingId],
    queryFn: async () => api.myBooking(await getToken(), bookingId!),
    enabled: !!bookingId,
  });
}

// --- Fase 7: Dashboard operacional (área administrativa) ---

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
    },
  });
}
