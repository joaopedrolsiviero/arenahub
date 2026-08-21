import { render } from '@testing-library/react';
import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AppQueryProvider } from './query-client';

// Fase 8, item 56: "User A loga, vê dados, desloga, User B loga — User B
// não pode ver dados de User A por causa de cache antigo." O Clerk desloga
// sem recarregar a página, então sem limpeza explícita o QueryClient
// (criado uma vez por sessão do app) manteria os dados em memória.
let mockUserId: string | null = 'user-a';
let mockIsLoaded = true;

jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ userId: mockUserId, isLoaded: mockIsLoaded }),
}));

function CaptureClient({ onClient }: { onClient: (queryClient: QueryClient) => void }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    onClient(queryClient);
  }, [queryClient, onClient]);
  return null;
}

describe('AppQueryProvider — limpeza de cache ao trocar de usuário', () => {
  beforeEach(() => {
    mockUserId = 'user-a';
    mockIsLoaded = true;
  });

  it('mantém o cache enquanto o mesmo usuário continua logado', () => {
    let client: QueryClient | undefined;
    const { rerender } = render(
      <AppQueryProvider>
        <CaptureClient onClient={(qc) => (client = qc)} />
      </AppQueryProvider>,
    );
    client!.setQueryData(['probe'], 'dado-do-user-a');

    // Re-render sem mudar o userId (ex: navegação normal dentro do app).
    rerender(
      <AppQueryProvider>
        <CaptureClient onClient={(qc) => (client = qc)} />
      </AppQueryProvider>,
    );

    expect(client!.getQueryData(['probe'])).toBe('dado-do-user-a');
  });

  it('limpa o cache no logout (userId vira null)', () => {
    let client: QueryClient | undefined;
    const { rerender } = render(
      <AppQueryProvider>
        <CaptureClient onClient={(qc) => (client = qc)} />
      </AppQueryProvider>,
    );
    client!.setQueryData(['my-bookings'], ['reserva-privada-do-user-a']);
    expect(client!.getQueryData(['my-bookings'])).toBeDefined();

    mockUserId = null; // logout
    rerender(
      <AppQueryProvider>
        <CaptureClient onClient={(qc) => (client = qc)} />
      </AppQueryProvider>,
    );

    expect(client!.getQueryData(['my-bookings'])).toBeUndefined();
  });

  it('limpa o cache ao trocar de conta (userId muda de um valor para outro)', () => {
    let client: QueryClient | undefined;
    const { rerender } = render(
      <AppQueryProvider>
        <CaptureClient onClient={(qc) => (client = qc)} />
      </AppQueryProvider>,
    );
    client!.setQueryData(['admin-arenas'], ['arena-do-user-a']);

    mockUserId = 'user-b';
    rerender(
      <AppQueryProvider>
        <CaptureClient onClient={(qc) => (client = qc)} />
      </AppQueryProvider>,
    );

    expect(client!.getQueryData(['admin-arenas'])).toBeUndefined();
  });

  it('não limpa o cache antes do Clerk terminar de carregar (isLoaded=false)', () => {
    mockIsLoaded = false;
    let client: QueryClient | undefined;
    const { rerender } = render(
      <AppQueryProvider>
        <CaptureClient onClient={(qc) => (client = qc)} />
      </AppQueryProvider>,
    );
    client!.setQueryData(['probe'], 'dado-inicial');

    // userId "muda" enquanto ainda carregando — não deve disparar limpeza.
    mockUserId = 'user-a-ainda-carregando';
    rerender(
      <AppQueryProvider>
        <CaptureClient onClient={(qc) => (client = qc)} />
      </AppQueryProvider>,
    );

    expect(client!.getQueryData(['probe'])).toBe('dado-inicial');
  });
});
