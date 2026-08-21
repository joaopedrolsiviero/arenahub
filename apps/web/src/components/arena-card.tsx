import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ArenaDiscoverySummary } from '@/lib/types';

const SPORT_LABEL: Record<string, string> = {
  BEACH_VOLLEYBALL: 'Vôlei de praia',
};

export function ArenaCard({ arena }: { arena: ArenaDiscoverySummary }) {
  return (
    <Link href={`/arenas/${arena.id}`} className="block">
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle>{arena.name}</CardTitle>
          {arena.description ? <CardDescription>{arena.description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
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
