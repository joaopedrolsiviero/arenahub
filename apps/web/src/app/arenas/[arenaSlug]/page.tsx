import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { resolveArenaBySlugOrLegacyId } from '@/lib/resolve-arena';
import { ArenaDetail } from './arena-detail';

type Params = Promise<{ arenaSlug: string }>;

// Fase 32 — metadata dinâmica a partir SOMENTE de dados públicos reais da
// arena (nome/descrição já existentes no modelo — nada inventado). Arena
// ainda não pronta (`isReady: false`) recebe `noindex`: a página existe e
// funciona, mas não há nada reservável nela ainda — não vale a pena
// indexar um conteúdo que muda assim que a arena for configurada
// (mesma regra usada no sitemap, ver app/sitemap.ts).
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { arenaSlug } = await params;
  const resolution = await resolveArenaBySlugOrLegacyId(arenaSlug);

  if (resolution.kind === 'not-found') {
    return { title: 'Arena não encontrada' };
  }

  const { arena } = resolution;
  const description =
    arena.description ?? `Reserve uma quadra na ${arena.name} pelo ArenaHub.`;

  return {
    title: arena.name,
    description,
    alternates: { canonical: `/arenas/${arena.slug}` },
    robots: arena.isReady ? undefined : { index: false, follow: true },
    openGraph: {
      siteName: 'ArenaHub',
      locale: 'pt_BR',
      title: arena.name,
      description,
      url: `/arenas/${arena.slug}`,
      type: 'website',
    },
  };
}

// Fase 29 — sem RequireAuth: um visitante sem conta precisa conseguir ver a
// arena antes de autenticar (login só é exigido pra criar a Booking).
// Fase 32 — precisou virar Server Component (a lógica de resolver
// slug/redirect/404 só pode rodar no servidor); a interatividade real
// continua inteira em `ArenaDetail` (arena-detail.tsx).
export default async function ArenaDetailPage({ params }: { params: Params }) {
  const { arenaSlug } = await params;
  const resolution = await resolveArenaBySlugOrLegacyId(arenaSlug);

  if (resolution.kind === 'not-found') {
    notFound();
  }
  if (resolution.kind === 'legacy-id') {
    // Link compartilhado antes da Fase 32 (URL por ID) — redirect
    // permanente pro slug, nunca uma jornada quebrada.
    permanentRedirect(`/arenas/${resolution.arena.slug}`);
  }

  return (
    <>
      <SiteHeader />
      <ArenaDetail arenaId={resolution.arena.id} />
    </>
  );
}
