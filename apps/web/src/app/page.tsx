import Link from 'next/link';
import { Show, UserButton } from '@clerk/nextjs';
import { buttonVariants } from '@/components/ui/button';
import { CurrentUserCard } from '@/components/current-user-card';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">ArenaHub</h1>
      <p className="text-muted-foreground">Reserve quadras esportivas perto de você.</p>

      <Show when="signed-out">
        <div className="flex gap-3">
          <Link href="/sign-in" className={buttonVariants({ variant: 'default' })}>
            Entrar
          </Link>
          <Link href="/sign-up" className={buttonVariants({ variant: 'outline' })}>
            Criar conta
          </Link>
        </div>
      </Show>

      <Show when="signed-in">
        <div className="flex flex-col items-center gap-4">
          <UserButton />
          <div className="flex gap-3">
            <Link href="/arenas" className={buttonVariants({ variant: 'default' })}>
              Explorar arenas
            </Link>
            <Link href="/minhas-reservas" className={buttonVariants({ variant: 'outline' })}>
              Minhas reservas
            </Link>
          </div>
          {/* Área administrativa (Fase 7) — deliberadamente separada dos
              botões de cliente acima, nunca misturada ao mesmo fluxo (item
              58). Visível para qualquer usuário logado; quem não administra
              nenhuma arena vê um estado vazio ao entrar. */}
          <Link href="/dashboard" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Área administrativa
          </Link>
          <CurrentUserCard />
        </div>
      </Show>
    </div>
  );
}
