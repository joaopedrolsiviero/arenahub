import Link from 'next/link';
import { Show, UserButton } from '@clerk/nextjs';
import { ArrowRightIcon, CalendarCheckIcon, ShieldCheckIcon, ZapIcon } from 'lucide-react';
import { SiteBrand } from '@/components/site-brand';
import { buttonVariants } from '@/components/ui/button';

const HIGHLIGHTS = [
  {
    icon: ZapIcon,
    title: 'Disponibilidade real',
    body: 'Horários sempre atualizados, sem reserva duplicada.',
  },
  {
    icon: CalendarCheckIcon,
    title: 'Reserva em segundos',
    body: 'Escolha a quadra, o horário e confirme. Sem burocracia.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Sua vaga garantida',
    body: 'Confirmação clara e acompanhamento de cada reserva.',
  },
];

export default function Home() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 sm:px-8">
        {/* Fase de Branding — logo completa da Siviero na home pública,
            limpa. O ArenaHub continua claramente identificado como o
            produto pelo título/metadata da página e pelo conteúdo abaixo
            ("Reserve sua quadra em segundos", CTAs de arena/reserva). */}
        <span aria-label="ArenaHub" className="flex items-center">
          <SiteBrand variant="full" className="h-8 w-auto sm:h-9" />
        </span>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-14 px-6 py-12 sm:px-8">
        <div className="flex flex-col items-start gap-6">
          <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold tracking-wide text-foreground">
            Beach tennis · Vôlei de praia · e mais
          </span>
          <h1 className="max-w-2xl text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-6xl">
            Reserve sua quadra em segundos.
          </h1>
          <p className="max-w-lg text-base text-muted-foreground sm:text-lg">
            Encontre arenas perto de você, veja horários disponíveis de verdade e garanta sua vaga
            sem ligar pra ninguém.
          </p>

          {/* Fase 35 — a descoberta pública (Fases 29/32/33) já não exige
              login, mas a home não tinha nenhum caminho clicável até ela pra
              quem está deslogado: só sobrava digitar /arenas na URL manualmente.
              "Explorar arenas" vem primeiro (é a ação que não exige conta),
              "Criar conta"/"Entrar" continuam disponíveis pra quem já quer se
              identificar direto. */}
          <Show when="signed-out">
            <div className="flex flex-wrap gap-3">
              <Link href="/arenas" className={buttonVariants({ variant: 'default', size: 'lg' })}>
                Explorar arenas
                <ArrowRightIcon />
              </Link>
              <Link href="/sign-up" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                Criar conta
              </Link>
              <Link href="/sign-in" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                Entrar
              </Link>
            </div>
          </Show>

          <Show when="signed-in">
            <div className="flex flex-wrap gap-3">
              <Link href="/arenas" className={buttonVariants({ variant: 'default', size: 'lg' })}>
                Explorar arenas
                <ArrowRightIcon />
              </Link>
              <Link href="/minhas-reservas" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                Minhas reservas
              </Link>
            </div>
            {/* Área administrativa (Fase 7) — deliberadamente separada dos
                botões de cliente acima, nunca misturada ao mesmo fluxo (item
                58/65). Visível pra qualquer usuário logado; quem não
                administra nenhuma arena vê um estado vazio ao entrar. */}
            <Link
              href="/dashboard"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Área administrativa
            </Link>
          </Show>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {HIGHLIGHTS.map((item) => (
            <div key={item.title} className="flex flex-col gap-2 rounded-xl border border-border/70 p-5">
              <item.icon className="size-5 text-brand" />
              <p className="font-heading text-sm font-semibold">{item.title}</p>
              <p className="text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
