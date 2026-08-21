import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatCurrencyBRL } from '@/lib/format';
import type { CourtPublic } from '@/lib/types';

const SPORT_LABEL: Record<string, string> = {
  BEACH_VOLLEYBALL: 'Vôlei de praia',
};

export function CourtCard({ arenaId, court }: { arenaId: string; court: CourtPublic }) {
  return (
    <Link href={`/arenas/${arenaId}/courts/${court.id}`} className="block">
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle>{court.name}</CardTitle>
          <CardDescription>{SPORT_LABEL[court.sport] ?? court.sport}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-sm">
          <span>{formatCurrencyBRL(court.pricePerSlot)} / horário</span>
          <span className="text-muted-foreground">{court.slotDurationMinutes} min</span>
        </CardContent>
      </Card>
    </Link>
  );
}
