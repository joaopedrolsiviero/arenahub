import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { registerPushToken, removePushToken } from '@/api/push-tokens';
import { getExpoPushToken, getPushPermissionStatus, requestPushPermission } from '@/lib/push-notifications';
import { useApiToken } from './useApiToken';

// M7 — query key estável, compartilhada entre app/_layout.tsx (setup
// automático) e app/(tabs)/perfil.tsx (UI de permissão/logout): as duas
// leem o MESMO estado via TanStack Query, nunca duas fontes de verdade.
export function usePushPermissionStatus() {
  return useQuery({
    queryKey: ['push-permission-status'],
    queryFn: getPushPermissionStatus,
  });
}

export function useRequestPushPermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: requestPushPermission,
    onSuccess: (result) => {
      queryClient.setQueryData(['push-permission-status'], result);
    },
  });
}

// `enabled` (chamado só quando logado + permissão concedida) evita tentar
// obter um token sem sentido (deslogado, ou sem permissão — a chamada
// nativa pode nem funcionar sem permissão concedida em algumas plataformas).
export function useExpoPushToken(enabled: boolean) {
  return useQuery({
    queryKey: ['expo-push-token'],
    queryFn: getExpoPushToken,
    enabled,
    // MissingEasProjectIdError é uma configuração ausente, nunca uma falha
    // transitória — repetir a chamada nunca resolve sozinho.
    retry: false,
  });
}

export function useRegisterPushToken() {
  const getToken = useApiToken();
  return useMutation<{ ok: true }, unknown, { token: string; platform: 'ios' | 'android' }>({
    mutationFn: async ({ token, platform }) => registerPushToken(await getToken(), token, platform),
  });
}

export function useRemovePushToken() {
  const getToken = useApiToken();
  return useMutation<{ ok: true }, unknown, { token: string }>({
    mutationFn: async ({ token }) => removePushToken(await getToken(), token),
  });
}
