import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DashboardSummary } from '@/lib/types';

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <span className="text-2xl font-semibold">{value}</span>
      </CardContent>
    </Card>
  );
}

export function DashboardSummaryCards({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <SummaryCard label="Reservas confirmadas" value={summary.confirmedBookings} />
      <SummaryCard label="Reservas canceladas" value={summary.cancelledBookings} />
      <SummaryCard label="Bloqueios" value={summary.blocks} />
      <SummaryCard label="Manutenções" value={summary.maintenance} />
    </div>
  );
}
