import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrencyBRL, formatDateTimeInZone, formatTimeInZone } from '@/lib/format';
import type { AvailabilitySlot, CourtPublic } from '@/lib/types';

export function BookingSummaryCard({
  court,
  slot,
  timezone,
  isSubmitting,
  onConfirm,
}: {
  court: CourtPublic;
  slot: AvailabilitySlot;
  timezone: string;
  isSubmitting: boolean;
  onConfirm: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumo da reserva</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Quadra</span>
          <span>{court.name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Data e horário</span>
          <span>{formatDateTimeInZone(slot.startsAt, timezone)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Término previsto</span>
          <span>{formatTimeInZone(slot.endsAt, timezone)}</span>
        </div>
        <div className="flex justify-between font-medium">
          <span>Total</span>
          <span>{formatCurrencyBRL(court.pricePerSlot)}</span>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          className="w-full"
          disabled={isSubmitting}
          onClick={onConfirm}
        >
          {isSubmitting ? 'Confirmando…' : 'Confirmar reserva'}
        </Button>
      </CardFooter>
    </Card>
  );
}
