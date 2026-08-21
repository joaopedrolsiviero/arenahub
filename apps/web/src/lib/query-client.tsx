'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';

// Fase 8 (item 56): sem isso, o cache do TanStack Query sobrevive ao
// logout — o QueryClient é criado uma vez por sessão do app (useState em
// AppQueryProvider) e o <UserButton/> do Clerk desloga sem recarregar a
// página, então dados de User A (minhas reservas, dashboard) ficariam
// visíveis em memória até o próximo refetch se User B logasse na mesma aba
// em seguida. Limpa o cache inteiro sempre que o `userId` do Clerk muda —
// tanto no logout (userId vira null) quanto na troca de conta.
function ClearQueryCacheOnUserChange({ children }: { children: React.ReactNode }) {
  const { userId, isLoaded } = useAuth();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    if (previousUserId.current !== undefined && previousUserId.current !== userId) {
      queryClient.clear();
    }
    previousUserId.current = userId;
  }, [userId, isLoaded, queryClient]);

  return <>{children}</>;
}

export function AppQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ClearQueryCacheOnUserChange>{children}</ClearQueryCacheOnUserChange>
    </QueryClientProvider>
  );
}
