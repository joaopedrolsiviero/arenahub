import Link from 'next/link';
import { ClockIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatCurrencyBRL } from '@/lib/format';
import type { CourtPublic } from '@/lib/types';

const SPORT_LABEL: Record<string, string> = {
  BEACH_VOLLEYBALL: 'Vôlei de praia',
};

export function CourtCard({ arenaSlug, court }: { arenaSlug: string; court: CourtPublic }) {
  return (
    <Link href={`/arenas/${arenaSlug}/courts/${court.id}`} className="group block">
      <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-[0_4px_20px_-6px_oklch(0.19_0.014_265_/_14%)]">
        <CardHeader>
          <CardTitle>{court.name}</CardTitle>
          <CardDescription>{SPORT_LABEL[court.sport] ?? court.sport}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="tabular text-base font-bold text-foreground">
            {formatCurrencyBRL(court.pricePerSlot)}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ClockIcon className="size-3.5" />
            {court.slotDurationMinutes} min
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
