import { DateTime } from 'luxon';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { todayInZone } from '@/lib/format';

function shiftDate(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toFormat('yyyy-MM-dd');
}

export function DashboardDateNav({
  date,
  timezone,
  onChange,
}: {
  date: string;
  timezone: string;
  onChange: (date: string) => void;
}) {
  const today = todayInZone(timezone);

  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Dia anterior"
        onClick={() => onChange(shiftDate(date, -1))}
      >
        <ChevronLeftIcon />
      </Button>
      <span className="min-w-28 text-center text-sm font-medium tabular-nums">
        {DateTime.fromISO(date, { zone: 'utc' }).setLocale('pt-BR').toFormat('dd/MM/yyyy')}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Próximo dia"
        onClick={() => onChange(shiftDate(date, 1))}
      >
        <ChevronRightIcon />
      </Button>
      {date !== today ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(today)}>
          Hoje
        </Button>
      ) : null}
    </div>
  );
}
