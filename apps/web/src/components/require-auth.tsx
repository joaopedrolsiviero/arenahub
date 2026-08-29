'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Show } from '@clerk/nextjs';
import { buttonVariants } from '@/components/ui/button';

function RequireAuthInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Fase 29 — preserva pra onde voltar depois do login (`redirect_url` é a
  // convenção nativa do Clerk, lida automaticamente pelo componente
  // <SignIn/>, sem precisar de nenhuma prop extra nele).
  const query = searchParams.toString();
  const redirectUrl = encodeURIComponent(query ? `${pathname}?${query}` : pathname);

  return (
    <>
      <Show when="signed-out">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
          <p className="text-muted-foreground">Você precisa entrar para continuar.</p>
          <Link
            href={`/sign-in?redirect_url=${redirectUrl}`}
            className={buttonVariants({ variant: 'default' })}
          >
            Entrar
          </Link>
        </div>
      </Show>
      <Show when="signed-in">{children}</Show>
    </>
  );
}

// Fase 6 (item 43-44): reaproveita só o Clerk, nunca checa ArenaMember/role
// para as telas do cliente — aqui é só "está logado ou não". `Suspense`
// (Fase 29) é exigido pelo Next por causa do `useSearchParams()` em páginas
// estáticas (ex: /dashboard/nova-arena) — nunca visível na prática, porque
// o Clerk já resolve "logado ou não" de forma praticamente instantânea.
export function RequireAuth({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <RequireAuthInner>{children}</RequireAuthInner>
    </Suspense>
  );
}
