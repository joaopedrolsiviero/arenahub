import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-1.5">
          {arena.sports.map((sport) => (
            <Badge key={sport} variant="outline">
              {SPORT_LABEL[sport] ?? sport}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </Link>
  );
}
