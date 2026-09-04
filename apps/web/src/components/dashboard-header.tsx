'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PlusIcon } from 'lucide-react';
import { ArenaSelector } from '@/components/arena-selector';
import { SiteBrand } from '@/components/site-brand';
import type { AdminArena } from '@/lib/types';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '', label: 'Dashboard' },
  { href: '/quadras', label: 'Quadras' },
  { href: '/horarios', label: 'Horários' },
  { href: '/equipe', label: 'Equipe' },
  { href: '/clientes', label: 'Clientes' },
  { href: '/relatorios', label: 'Relatórios' },
  { href: '/ia', label: 'IA' },
  { href: '/configuracoes', label: 'Configurações' },
];

// Identidade compartilhada com o SiteHeader do cliente (mesma wordmark,
// mesma cor de marca na navegação ativa), mas nunca a mesma navegação —
// fluxos de cliente e admin continuam deliberadamente separados (item 65).
export function DashboardHeader({
  arenaId,
  arenaName,
  adminArenas,
}: {
  arenaId: string;
  arenaName: string;
  adminArenas: AdminArena[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/dashboard/${arenaId}`;

  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {/* Fase de Branding — ícone compacto da Siviero (não a logo
              completa: espaço estreito, ao lado do nome da arena e do
              seletor). ArenaHub continua sendo o nome do produto — o
              dashboard em si já não repetia "ArenaHub" por extenso aqui
              antes desta fase; nenhuma mudança de rótulo foi necessária. */}
          <Link href="/" aria-label="ArenaHub — página inicial" className="flex shrink-0 items-center">
            <SiteBrand variant="icon" className="h-6 w-auto" />
          </Link>
          <div className="h-5 w-px shrink-0 bg-border" />
          {/* min-w-0 + truncate (item 3/62): sem isso, um nome de arena longo
              empurra o seletor e o botão de nova arena pra fora da tela em
              vez de encolher — flex items só truncam se puderem encolher
              abaixo do tamanho do próprio texto. */}
          <h1 className="min-w-0 truncate text-base font-semibold">{arenaName}</h1>
          <div className="shrink-0">
            <ArenaSelector
              arenas={adminArenas}
              currentArenaId={arenaId}
              onChange={(newArenaId) => router.push(`/dashboard/${newArenaId}`)}
            />
          </div>
          {/* Fase 28, item 21 — sempre visível, não só quando há mais de uma
              arena: um OWNER de arena única também pode querer administrar
              uma segunda. */}
          <Link
            href="/dashboard/nova-arena"
            title="Criar nova arena"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PlusIcon className="size-4" />
            <span className="sr-only">Criar nova arena</span>
          </Link>
        </div>
        {/* item 3/62 — 8 abas não cabem lado a lado em telas de celular; sem
            isso a nav estourava a largura da tela (nowrap sem rolagem).
            overflow-x-auto vira uma faixa de abas deslizável, mesmo padrão já
            usado pras tabelas largas de relatorios/page.tsx. */}
        <nav className="flex w-full gap-1 overflow-x-auto sm:w-auto">
          {NAV_ITEMS.map((item) => {
            const href = `${base}${item.href}`;
            const active = item.href === '' ? pathname === base : pathname.startsWith(href);
            return (
              <Link
                key={item.href}
                href={href}
                className={cn(
                  'shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted',
                  active ? 'bg-brand/12 text-foreground' : 'text-muted-foreground',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
