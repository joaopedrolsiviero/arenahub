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
        // Antes usava variant="ghost" (sem borda/fundo em repouso) — lia como
        // texto solto, não como botão clicável. `outline` reaproveita a MESMA
        // aparência dos botões de navegação ao lado (borda + fundo + hover
        // visíveis), então nunca é ambíguo que isto é uma ação.
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(today)}>
          Voltar para hoje
        </Button>
      ) : null}
    </div>
  );
}
