import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatCurrencyBRL, formatDateInZone, formatTimeInZone } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AvailabilitySlot, CourtPublic } from '@/lib/types';

function Row({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={emphasis ? 'tabular text-lg font-bold' : 'tabular text-sm font-semibold'}>
        {value}
      </span>
    </div>
  );
}

// A síntese precisa deixar confirmar em segundos (item 15) — hierarquia
// clara entre os dados e o valor total, CTA de marca sem disputa visual.
//
// Fase "múltiplos horários": recebe a lista inteira de slots selecionados
// (nunca mais um único) — o total é sempre `pricePerSlot x quantidade`,
// verdadeiro tanto para um trecho contínuo (um Booking) quanto para
// horários espaçados (vários Bookings), já que o preço por slot nunca muda
// dentro da mesma quadra. `slots` chega sempre ordenado por horário.
export function BookingSummaryCard({
  court,
  slots,
  timezone,
  isSubmitting,
  onConfirm,
  signInHref,
}: {
  court: CourtPublic;
  slots: AvailabilitySlot[];
  timezone: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  // Fase 29 — visitante sem conta chega até aqui (arena/quadra/data/horário
  // são públicos), mas criar a reserva continua exigindo login. Quando
  // presente, troca o botão de confirmar por um link de entrar que preserva
  // a seleção via query string (arenaId/courtId/data/horário já estão na
  // própria URL desta página — ver CourtBooking) e volta exatamente pra cá
  // depois do login, através do parâmetro `redirect_url` do Clerk.
  signInHref?: string;
}) {
  const total = Number(court.pricePerSlot) * slots.length;
  const horariosLabel = slots
    .map((slot) => `${formatTimeInZone(slot.startsAt, timezone)}–${formatTimeInZone(slot.endsAt, timezone)}`)
    .join(', ');

  return (
    <Card className="border-2 border-brand/25">
      <CardHeader>
        <CardTitle>Resumo da reserva</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        <Row label="Quadra" value={court.name} />
        <Row label="Data" value={formatDateInZone(slots[0]!.startsAt, timezone)} />
        <Row label={slots.length > 1 ? 'Horários' : 'Horário'} value={horariosLabel} />
        <div className="my-1 h-px bg-border" />
        <Row label="Total" value={formatCurrencyBRL(total)} emphasis />
      </CardContent>
      <CardFooter>
        {signInHref ? (
          <Link href={signInHref} className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
            Entrar para confirmar reserva
          </Link>
        ) : (
          <Button type="button" size="lg" className="w-full" disabled={isSubmitting} onClick={onConfirm}>
            {isSubmitting ? 'Confirmando…' : 'Confirmar reserva'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
