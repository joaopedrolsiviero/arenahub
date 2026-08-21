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
      <AvailabilityGrid slots={slots} timezone="America/Sao_Paulo" selectedStartsAt={null} onSelect={() => {}} />,
    );

    const available = screen.getByRole('button', { name: /Selecionar horário/ });
    const unavailable = screen.getByRole('button', { name: /indisponível/ });

    expect(available).toBeEnabled();
    expect(unavailable).toBeDisabled();
  });

  it('chama onSelect apenas para horários disponíveis', () => {
    const onSelect = jest.fn();
    render(
      <AvailabilityGrid slots={slots} timezone="America/Sao_Paulo" selectedStartsAt={null} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Selecionar horário/ }));
    expect(onSelect).toHaveBeenCalledWith(slots[0]);
  });

  it('marca o horário selecionado com aria-pressed', () => {
    render(
      <AvailabilityGrid
        slots={slots}
        timezone="America/Sao_Paulo"
        selectedStartsAt={slots[0]!.startsAt}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /Selecionar horário/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
