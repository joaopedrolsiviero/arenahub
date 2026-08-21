import { Button } from '@/components/ui/button';
import { formatTimeInZone } from '@/lib/format';
import type { AvailabilitySlot } from '@/lib/types';

export function AvailabilityGrid({
  slots,
  timezone,
  selectedStartsAt,
  onSelect,
}: {
  slots: AvailabilitySlot[];
  timezone: string;
  selectedStartsAt: string | null;
  onSelect: (slot: AvailabilitySlot) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Horários disponíveis"
      className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6"
    >
      {slots.map((slot) => {
        const selected = slot.startsAt === selectedStartsAt;
        return (
          <Button
            key={slot.startsAt}
            type="button"
            variant={selected ? 'default' : slot.available ? 'outline' : 'ghost'}
            disabled={!slot.available}
            aria-pressed={selected}
            aria-label={
              slot.available
                ? `Selecionar horário ${formatTimeInZone(slot.startsAt, timezone)}`
                : `Horário ${formatTimeInZone(slot.startsAt, timezone)} indisponível`
            }
            onClick={() => onSelect(slot)}
          >
            {formatTimeInZone(slot.startsAt, timezone)}
          </Button>
        );
      })}
    </div>
  );
}
