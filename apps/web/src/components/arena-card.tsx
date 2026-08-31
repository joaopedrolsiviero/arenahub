import Link from 'next/link';
import { ChevronRightIcon } from 'lucide-react';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ArenaDiscoverySummary } from '@/lib/types';

const SPORT_LABEL: Record<string, string> = {
  BEACH_VOLLEYBALL: 'Vôlei de praia',
};

export function ArenaCard({ arena }: { arena: ArenaDiscoverySummary }) {
  return (
    <Link href={`/arenas/${arena.slug}`} className="group block">
      <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-[0_4px_20px_-6px_oklch(0.19_0.014_265_/_14%)]">
        <div className="flex aspect-[16/9] items-center justify-center overflow-hidden bg-gradient-to-br from-brand/25 via-brand/10 to-transparent">
          <span className="font-heading text-3xl font-bold tracking-tight text-foreground/15">
            {arena.name.slice(0, 2).toUpperCase()}
          </span>
        </div>
        <CardHeader>
          <CardTitle className="text-base">{arena.name}</CardTitle>
          {arena.description ? <CardDescription>{arena.description}</CardDescription> : null}
          {/* Fase 33, item 2 — antes só dava pra descobrir que uma arena
              ainda está em configuração DEPOIS de clicar nela; item 6 da
              fase pede exatamente isso: "saber se está pronta pra receber
              reservas" já na listagem. Só aparece quando falta — uma arena
              pronta não precisa de nenhum selo extra. */}
          {!arena.isReady ? (
            <CardAction>
              <Badge variant="secondary">Em breve</Badge>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-1.5">
          {arena.sports.map((sport) => (
            <Badge key={sport} variant="outline">
              {SPORT_LABEL[sport] ?? sport}
            </Badge>
          ))}
        </CardContent>
        {/* Mesma pista de clicabilidade já usada em BookingCard (Fase 29) —
            hover só existe em desktop, e num celular o card inteiro sendo
            um link não era óbvio por si só. */}
        <CardFooter className="justify-end gap-0.5 text-xs font-medium text-muted-foreground">
          Ver quadras
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        </CardFooter>
      </Card>
    </Link>
  );
}
