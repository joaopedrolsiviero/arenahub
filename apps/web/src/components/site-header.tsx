'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Show, UserButton } from '@clerk/nextjs';
import { CalendarCheckIcon, LayoutGridIcon } from 'lucide-react';
import { SiteBrand } from '@/components/site-brand';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/arenas', label: 'Arenas', icon: LayoutGridIcon },
  { href: '/minhas-reservas', label: 'Minhas reservas', icon: CalendarCheckIcon },
];

// Navegação do cliente (item 25) — nunca mistura com a navegação
// administrativa do dashboard (item 65: fluxos separados desde a Fase 6).
export function SiteHeader() {
  const pathname = usePathname();
  // Só o pathname (nunca a query string) — `usePathname()` sozinho não
  // exige Suspense (diferente de `useSearchParams()`, que forçaria bailout
  // de páginas estáticas como /dashboard/nova-arena). O header é um link
  // genérico de "Entrar"; preservar a seleção exata (data/horário) já
  // acontece no lugar que importa de verdade — `signInHref` em
  // BookingSummaryCard e em RequireAuth, ambos com query completa.
  const redirectUrl = encodeURIComponent(pathname);

  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Fase de Branding — logo completa da Siviero (empresa por trás do
            ArenaHub) no header público, limpa (sem texto adicional
            empilhado). O produto continua identificado pelo título da
            página/metadata ("ArenaHub") e pela navegação abaixo. */}
        <Link href="/" aria-label="ArenaHub — página inicial" className="flex items-center">
          <SiteBrand variant="full" className="h-8 w-auto sm:h-9" />
        </Link>

        <Show when="signed-in">
          <nav aria-label="Navegação principal" className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    buttonVariants({ variant: active ? 'secondary' : 'ghost', size: 'sm' }),
                    'gap-1.5',
                  )}
                >
                  <item.icon className="size-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
            <div className="ml-1 pl-1">
              <UserButton />
            </div>
          </nav>
        </Show>

        {/* Fase 29 — arena/quadra/disponibilidade agora são navegáveis sem
            conta; o header precisa oferecer "Entrar" pra quem ainda não
            autenticou, preservando a página atual via redirect_url. */}
        <Show when="signed-out">
          <Link
            href={`/sign-in?redirect_url=${redirectUrl}`}
            className={buttonVariants({ variant: 'default', size: 'sm' })}
          >
            Entrar
          </Link>
        </Show>
      </div>
    </header>
  );
}
