import { BanIcon, WrenchIcon, XCircleIcon } from 'lucide-react';
import type { DashboardSummary } from '@/lib/types';

// Quebra deliberada do padrão "4 cards iguais" (item 53): 1 número em
// destaque (o que o operador quer ver primeiro ao abrir o dia) + métricas
// secundárias como chips inline, nunca competindo em peso visual.
export function DashboardSummaryCards({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border bg-card px-5 py-4">
      <div>
        <p className="text-xs font-semibold text-muted-foreground">Reservas confirmadas hoje</p>
        <p className="tabular text-4xl font-bold tracking-tight text-foreground">
          {summary.confirmedBookings}
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <XCircleIcon className="size-4" />
          <span className="tabular font-semibold text-foreground">{summary.cancelledBookings}</span>
          canceladas
        </span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <BanIcon className="size-4" />
          <span className="tabular font-semibold text-foreground">{summary.blocks}</span>
          bloqueios
        </span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <WrenchIcon className="size-4" />
          <span className="tabular font-semibold text-foreground">{summary.maintenance}</span>
          manutenções
        </span>
      </div>
    </div>
  );
}
