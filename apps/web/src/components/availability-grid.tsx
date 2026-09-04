import { CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimeInZone } from '@/lib/format';
import type { AvailabilitySlot } from '@/lib/types';

// O elemento visualmente mais forte do produto (item 14/62): disponível,
// selecionado e indisponível nunca podem ser confundidos — cada estado tem
// forma, cor E ícone próprios, nunca só uma variação de tom. Alvo de toque
// generoso (h-12) porque é a ação mais repetida do fluxo de reserva mobile.
//
// Fase "múltiplos horários": `selectedStartTimes` é um Set (não mais um
// único valor) — cada clique num slot disponível alterna a própria seleção
// (inclui/remove), permitindo escolher vários horários (consecutivos ou
// não) numa única reserva. Um slot indisponível (`available: false`) já
// cobre tanto "ocupado" quanto "já passou" (autoridade é o backend, ver
// AvailabilityService.buildSlots) — o grid não distingue os dois motivos,
// só exibe "indisponível".
export function AvailabilityGrid({
  slots,
  timezone,
  selectedStartTimes,
  onToggle,
}: {
  slots: AvailabilitySlot[];
  timezone: string;
  selectedStartTimes: ReadonlySet<string>;
  onToggle: (slot: AvailabilitySlot) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Horários disponíveis"
      className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5"
    >
      {slots.map((slot) => {
        const selected = selectedStartTimes.has(slot.startsAt);
        const label = formatTimeInZone(slot.startsAt, timezone);
        return (
          <button
            key={slot.startsAt}
            type="button"
            disabled={!slot.available}
            aria-pressed={selected}
            aria-label={
              slot.available ? `Selecionar horário ${label}` : `Horário ${label} indisponível`
            }
            onClick={() => onToggle(slot)}
            className={cn(
              'tabular flex h-12 items-center justify-center gap-1 rounded-full border-2 text-sm font-semibold transition-all outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:not-disabled:scale-95',
              selected &&
                'border-brand bg-brand text-brand-foreground shadow-[0_2px_10px_-2px_var(--brand)]',
              !selected &&
                slot.available &&
                'border-brand/35 bg-brand/8 text-foreground hover:border-brand hover:bg-brand/15',
              !slot.available &&
                'cursor-not-allowed border-transparent bg-muted text-muted-foreground/60 line-through decoration-muted-foreground/40',
            )}
          >
            {selected ? <CheckIcon className="size-3.5" /> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}
