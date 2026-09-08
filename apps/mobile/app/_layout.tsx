import { ClerkProvider, ClerkLoaded } from '@clerk/clerk-expo';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { clerkTokenCache } from '@/lib/clerk-token-cache';
import { env } from '@/lib/env';
import { queryClient } from '@/lib/query-client';
import { usePushNotificationsSetup } from '@/hooks/usePushNotifications';

// M7 — precisa estar DENTRO de ClerkLoaded/QueryClientProvider (usa
// useAuth()/useQueryClient()), nunca no corpo de RootLayout em si (esse
// corpo roda ANTES dos Providers que ele mesmo declara existirem pros seus
// filhos). Componente puramente de efeito colateral — nunca renderiza nada.
function PushNotificationsBootstrap() {
  usePushNotificationsSetup();
  return null;
}

// Infraestrutura global da árvore inteira (item 7 do prompt desta fase):
// Clerk (sessão) por fora, TanStack Query por dentro, navegação por último.
//
// (tabs) nunca fica atrás de um gate de autenticação aqui — descoberta
// pública (Explorar) não exige login (mesma regra já confirmada na M0 para
// o Web, Fase 29); (auth) é uma rota que qualquer tela pode navegar até
// quando precisar de uma ação autenticada, nunca uma tela inicial forçada.
export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={clerkTokenCache}>
      <ClerkLoaded>
        <QueryClientProvider client={queryClient}>
          <PushNotificationsBootstrap />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)" options={{ presentation: 'modal' }} />
            {/* M2 — descoberta empurra rotas pra cima da pilha (fora das
                abas, mesmo padrão do Web: /arenas/:slug não é uma aba).
                headerShown:true aqui (só pra este grupo) dá um back button
                nativo de graça; o título dinâmico (nome da arena) é
                definido de dentro de cada tela via <Stack.Screen
                options={{title}}/>, nunca fixo aqui. */}
            <Stack.Screen name="arena" options={{ headerShown: true, title: '' }} />
            {/* M3 — tela de sucesso da reserva, fora das abas e do grupo
                "arena" (não é mais sobre descoberta). headerBackVisible é
                definido na própria tela (nunca aqui): voltar pra seleção
                depois de uma reserva já criada não faz sentido. */}
            <Stack.Screen name="reserva-confirmada" options={{ headerShown: true, title: '' }} />
            {/* M4 — fluxo de pagamento PIX (só alcançado quando
                arena.paymentMode === 'ONLINE'). Back button nativo continua
                útil aqui: enquanto PENDING, é seguro voltar (a Booking já
                existe e o Payment, se algum foi criado, continua consultável
                normalmente ao reabrir a tela — nunca cria outro). */}
            <Stack.Screen name="pagamento" options={{ headerShown: true, title: '' }} />
            {/* M5 — detalhe de "minha reserva" (fora das abas, mesmo padrão
                de "arena": a aba Reservas só lista; o detalhe/cancelamento
                empurra uma rota pra cima da pilha, com back nativo). */}
            <Stack.Screen name="reservas" options={{ headerShown: true, title: '' }} />
          </Stack>
          <StatusBar style="auto" />
        </QueryClientProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
