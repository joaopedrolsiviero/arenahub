import { useAuth } from '@clerk/clerk-expo';

// Mesmo padrão do Web (apps/web/src/hooks/use-api.ts, `useToken`) — todo
// hook que precisa de autenticação busca um token FRESCO do Clerk antes de
// cada chamada, nunca cacheado em estado (o Clerk gerencia a renovação
// sozinho). Um único ponto reaproveitado por todo hook autenticado atual e
// futuro (useCreateBooking agora; cancelamento/minhas-reservas na fase que
// os implementar).
export function useApiToken() {
  const { getToken } = useAuth();
  return getToken;
}
