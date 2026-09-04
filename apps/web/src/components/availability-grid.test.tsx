import { render, screen, fireEvent } from '@testing-library/react';
import { AvailabilityGrid } from './availability-grid';
import type { AvailabilitySlot } from '@/lib/types';

const slots: AvailabilitySlot[] = [
  { startsAt: '2026-09-07T13:00:00.000Z', endsAt: '2026-09-07T14:00:00.000Z', available: true },
  { startsAt: '2026-09-07T14:00:00.000Z', endsAt: '2026-09-07T15:00:00.000Z', available: false },
];

describe('AvailabilityGrid', () => {
  it('renderiza horários disponíveis como clicáveis e indisponíveis como desabilitados', () => {
    render(
      <AvailabilityGrid
        slots={slots}
        timezone="America/Sao_Paulo"
        selectedStartTimes={new Set()}
        onToggle={() => {}}
      />,
    );

    const available = screen.getByRole('button', { name: /Selecionar horário/ });
    const unavailable = screen.getByRole('button', { name: /indisponível/ });

    expect(available).toBeEnabled();
    expect(unavailable).toBeDisabled();
  });

  it('chama onToggle apenas para horários disponíveis', () => {
    const onToggle = jest.fn();
    render(
      <AvailabilityGrid
        slots={slots}
        timezone="America/Sao_Paulo"
        selectedStartTimes={new Set()}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Selecionar horário/ }));
    expect(onToggle).toHaveBeenCalledWith(slots[0]);
  });

  it('marca o horário selecionado com aria-pressed', () => {
    render(
      <AvailabilityGrid
        slots={slots}
        timezone="America/Sao_Paulo"
        selectedStartTimes={new Set([slots[0]!.startsAt])}
        onToggle={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /Selecionar horário/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  // Fase "múltiplos horários": mais de um slot pode estar selecionado ao
  // mesmo tempo — o grid não força seleção única.
  it('permite múltiplos horários marcados como selecionados simultaneamente', () => {
    const multiSlots: AvailabilitySlot[] = [
      ...slots,
      { startsAt: '2026-09-07T15:00:00.000Z', endsAt: '2026-09-07T16:00:00.000Z', available: true },
    ];
    render(
      <AvailabilityGrid
        slots={multiSlots}
        timezone="America/Sao_Paulo"
        selectedStartTimes={new Set([multiSlots[0]!.startsAt, multiSlots[2]!.startsAt])}
        onToggle={() => {}}
      />,
    );

    const pressed = screen.getAllByRole('button', { pressed: true });
    expect(pressed).toHaveLength(2);
  });
});
