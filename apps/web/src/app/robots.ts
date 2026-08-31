import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

// Fase 32 — só a área pública real é permitida (`/` e `/arenas`); tudo que
// já exige login (dashboard administrativo, minhas reservas, sign-in/
// sign-up) fica de fora — nunca "melhorar SEO" enfraquecendo o que já é
// privado, item explícito da fase.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/minhas-reservas', '/sign-in', '/sign-up'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
