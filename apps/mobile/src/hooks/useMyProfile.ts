import { useQuery } from '@tanstack/react-query';
import { getMyProfile } from '@/api/users';
import { useApiToken } from './useApiToken';

// Perfil (M6) — query key estável ['my-profile'], reaproveitável por
// qualquer outra tela que venha a precisar de dados do usuário (auditoria
// desta fase não encontrou nenhuma outra tela consumindo hoje). `enabled`
// (default true) segue o mesmo motivo de useMyBookings — esperar a sessão
// Clerk confirmar login antes de disparar a consulta, nunca deixar o 401
// acontecer por chamar sem sessão.
export function useMyProfile(enabled = true) {
  const getToken = useApiToken();
  return useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => getMyProfile(await getToken()),
    enabled,
  });
}
