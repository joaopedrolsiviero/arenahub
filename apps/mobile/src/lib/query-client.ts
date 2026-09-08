import { QueryClient } from '@tanstack/react-query';

// Infraestrutura só — nenhuma query de domínio (arenas/disponibilidade/
// reservas/pagamentos) é criada nesta fase (item 12 do prompt). Defaults
// conservadores para React Native: sem foco de janela (não existe no
// mobile) e um retry único, já que a maioria das queries futuras aqui é
// dado que muda com frequência (mesmo espírito do staleTime:0 que o Web usa
// em disponibilidade) — cada hook de domínio decide seus próprios
// staleTime/refetchInterval quando for criado.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
