import Link from 'next/link';
import { Show } from '@clerk/nextjs';
import { buttonVariants } from '@/components/ui/button';

// Fase 6 (item 43-44): reaproveita só o Clerk, nunca checa ArenaMember/role
// para as telas do cliente — aqui é só "está logado ou não".
export function RequireAuth({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-out">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
          <p className="text-muted-foreground">Você precisa entrar para continuar.</p>
          <Link href="/sign-in" className={buttonVariants({ variant: 'default' })}>
            Entrar
          </Link>
        </div>
      </Show>
      <Show when="signed-in">{children}</Show>
    </>
  );
}
