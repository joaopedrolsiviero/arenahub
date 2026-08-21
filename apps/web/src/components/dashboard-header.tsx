'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArenaSelector } from '@/components/arena-selector';
import type { AdminArena } from '@/lib/types';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '', label: 'Dashboard' },
  { href: '/quadras', label: 'Quadras' },
  { href: '/horarios', label: 'Horários' },
  { href: '/configuracoes', label: 'Configurações' },
];

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
    <div className="border-b">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{arenaName}</h1>
          <ArenaSelector
            arenas={adminArenas}
            currentArenaId={arenaId}
            onChange={(newArenaId) => router.push(`/dashboard/${newArenaId}`)}
          />
        </div>
        <nav className="flex gap-1">
          {NAV_ITEMS.map((item) => {
            const href = `${base}${item.href}`;
            const active = item.href === '' ? pathname === base : pathname.startsWith(href);
            return (
              <Link
                key={item.href}
                href={href}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted',
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
