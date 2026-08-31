import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { ArenasList } from './arenas-list';

// Fase 32 — estática (não depende de nenhum parâmetro/dado dinâmico):
// título e descrição reais do que a página faz, sem inventar conteúdo.
export const metadata: Metadata = {
  title: 'Encontre sua quadra',
  description: 'Arenas com horário disponível pra reservar agora, sem precisar de conta.',
  alternates: { canonical: '/arenas' },
  openGraph: {
    siteName: 'ArenaHub',
    locale: 'pt_BR',
    title: 'Encontre sua quadra — ArenaHub',
    description: 'Arenas com horário disponível pra reservar agora, sem precisar de conta.',
    url: '/arenas',
    type: 'website',
  },
};

// Fase 29 — sem RequireAuth: um visitante sem conta precisa conseguir
// navegar arena → quadra → data → horário → resumo antes de autenticar
// (login só é exigido pra criar a Booking). Backend acompanha essa decisão
// (GET /arenas/discover sem guard, ver arenas.controller.ts).
// Fase 32 — precisou virar Server Component pra exportar `metadata`; a
// interatividade real continua inteira em `ArenasList` (arenas-list.tsx).
export default function ArenasPage() {
  return (
    <>
      <SiteHeader />
      <ArenasList />
    </>
  );
}
