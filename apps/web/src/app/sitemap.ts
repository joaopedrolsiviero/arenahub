import type { MetadataRoute } from 'next';
import { api } from '@/lib/api';
import { SITE_URL } from '@/lib/site-url';

// Busca a lista de arenas reais no backend — não pode ser pré-renderizado
// no build (não há backend rodando durante `next build`; a API só existe
// em produção/dev real). Gerado sob demanda quando um crawler pede
// /sitemap.xml, contra o backend já no ar nesse momento.
export const dynamic = 'force-dynamic';

// Fase 32 — só URLs públicas realmente válidas. Arenas que existem mas
// ainda não estão prontas (`isReady: false`, mesmo booleano do checklist da
// Fase 28) ficam de fora: a página funciona, mas não tem nada reservável
// ainda — indexar um conteúdo que muda assim que a arena for configurada
// não ajuda ninguém (mesma regra aplicada ao `robots: noindex` da própria
// página, ver generateMetadata em arenas/[arenaSlug]/page.tsx). Sem
// paginação/cache dedicado: mesma decisão de `discoverAll` no backend —
// não há infraestrutura de paginação no projeto ainda, e o número de
// arenas hoje não justifica criar uma só para isto.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/arenas`, changeFrequency: 'daily', priority: 0.9 },
  ];

  const arenas = await api.discoverArenas(null);

  for (const summary of arenas) {
    let detail;
    try {
      detail = await api.discoverArenaBySlug(summary.slug);
    } catch {
      // Não deveria acontecer (o slug acabou de vir de discoverAll), mas
      // uma falha pontual aqui não pode derrubar o sitemap inteiro — só
      // pula essa arena.
      continue;
    }
    if (!detail.isReady) {
      continue;
    }

    entries.push({
      url: `${SITE_URL}/arenas/${detail.slug}`,
      lastModified: detail.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.8,
    });

    for (const court of detail.courts) {
      entries.push({
        url: `${SITE_URL}/arenas/${detail.slug}/courts/${court.id}`,
        lastModified: detail.updatedAt,
        changeFrequency: 'daily',
        priority: 0.7,
      });
    }
  }

  return entries;
}
