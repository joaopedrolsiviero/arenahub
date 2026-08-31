import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { LoadingState } from '@/components/async-state';
import { resolveArenaBySlugOrLegacyId } from '@/lib/resolve-arena';
import { formatCurrencyBRL } from '@/lib/format';
import { CourtBooking } from './court-booking';

type Params = Promise<{ arenaSlug: string; courtId: string }>;
type Search = Promise<{ [key: string]: string | string[] | undefined }>;

function courtPath(arenaSlug: string, courtId: string): string {
  return `/arenas/${arenaSlug}/courts/${courtId}`;
}

// Fase 32 — metadata dinâmica a partir SOMENTE de dados públicos reais
// (nome da quadra/arena, preço, duração — tudo já existente no modelo).
// Uma quadra que não existe (ou não pertence a esta arena — a busca abaixo
// nunca olha `court.id` fora de `arena.courts`, mesma proteção de IDOR do
// endpoint) usa a metadata padrão de "não encontrada", sem inventar nada.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { arenaSlug, courtId } = await params;
  const resolution = await resolveArenaBySlugOrLegacyId(arenaSlug);

  if (resolution.kind === 'not-found') {
    return { title: 'Quadra não encontrada' };
  }

  const { arena } = resolution;
  const court = arena.courts.find((c) => c.id === courtId);
  if (!court) {
    return { title: 'Quadra não encontrada' };
  }

  const title = `${court.name} — ${arena.name}`;
  const description = `Reserve a ${court.name} na ${arena.name} por ${formatCurrencyBRL(court.pricePerSlot)} a cada ${court.slotDurationMinutes} minutos.`;

  return {
    title,
    description,
    alternates: { canonical: courtPath(arena.slug, courtId) },
    robots: arena.isReady ? undefined : { index: false, follow: true },
    openGraph: {
      siteName: 'ArenaHub',
      locale: 'pt_BR',
      title,
      description,
      url: courtPath(arena.slug, courtId),
      type: 'website',
    },
  };
}

// Fase 29 — sem RequireAuth: um visitante sem conta precisa conseguir
// escolher quadra/data/horário e ver o resumo antes de autenticar; login só
// é exigido no passo de confirmar (ver `signInHref` em CourtBooking).
// Fase 32 — precisou virar Server Component (a lógica de resolver
// slug/redirect/404 só pode rodar no servidor); a interatividade real
// continua inteira em `CourtBooking` (court-booking.tsx).
export default async function CourtBookingPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { arenaSlug, courtId } = await params;
  const resolution = await resolveArenaBySlugOrLegacyId(arenaSlug);

  if (resolution.kind === 'not-found') {
    notFound();
  }
  if (resolution.kind === 'legacy-id') {
    // Link compartilhado antes da Fase 32 (URL por ID) — redirect
    // permanente pro slug, preservando courtId e a query string (data/
    // horário selecionados, ex. depois de um retorno de login).
    const search = await searchParams;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === 'string') query.set(key, value);
    }
    const queryString = query.toString();
    permanentRedirect(
      courtPath(resolution.arena.slug, courtId) + (queryString ? `?${queryString}` : ''),
    );
  }

  return (
    <>
      <SiteHeader />
      <Suspense fallback={<LoadingState label="Carregando quadra…" />}>
        <CourtBooking arenaId={resolution.arena.id} courtId={courtId} />
      </Suspense>
    </>
  );
}
