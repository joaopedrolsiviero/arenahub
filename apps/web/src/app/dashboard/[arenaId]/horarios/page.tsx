'use client';

import { Suspense, use, useState } from 'react';
import { useMyAdminArenas, useOperatingHours, useReplaceOperatingHours, useDashboard } from '@/hooks/use-api';
import { DashboardHeader } from '@/components/dashboard-header';
import { LoadingState, ErrorState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/lib/api';
import type { OperatingInterval, OperatingIntervalInput, Weekday } from '@/lib/types';

const WEEKDAYS: { value: Weekday; label: string }[] = [
  { value: 'MONDAY', label: 'Segunda-feira' },
  { value: 'TUESDAY', label: 'Terça-feira' },
  { value: 'WEDNESDAY', label: 'Quarta-feira' },
  { value: 'THURSDAY', label: 'Quinta-feira' },
  { value: 'FRIDAY', label: 'Sexta-feira' },
  { value: 'SATURDAY', label: 'Sábado' },
  { value: 'SUNDAY', label: 'Domingo' },
];

function DayRow({
  day,
  intervals,
  onChange,
}: {
  day: Weekday;
  intervals: OperatingIntervalInput[];
  onChange: (next: OperatingIntervalInput[]) => void;
}) {
  const dayIntervals = intervals.filter((interval) => interval.dayOfWeek === day);
  const otherIntervals = intervals.filter((interval) => interval.dayOfWeek !== day);

  function updateInterval(index: number, field: 'opensAt' | 'closesAt', value: string) {
    const next = [...dayIntervals];
    next[index] = { ...next[index]!, [field]: value };
    onChange([...otherIntervals, ...next]);
  }

  function addInterval() {
    onChange([...otherIntervals, ...dayIntervals, { dayOfWeek: day, opensAt: '08:00', closesAt: '22:00' }]);
  }

  function removeInterval(index: number) {
    const next = dayIntervals.filter((_, i) => i !== index);
    onChange([...otherIntervals, ...next]);
  }

  return (
    <div className="flex flex-col gap-2 border-b py-3 last:border-b-0">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {WEEKDAYS.find((w) => w.value === day)?.label}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={addInterval}>
          + Intervalo
        </Button>
      </div>
      {dayIntervals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Fechado</p>
      ) : (
        dayIntervals.map((interval, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="time"
              value={interval.opensAt}
              onChange={(event) => updateInterval(index, 'opensAt', event.target.value)}
              aria-label={`Abre às (${WEEKDAYS.find((w) => w.value === day)?.label})`}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            />
            <span className="text-muted-foreground">até</span>
            <input
              type="time"
              value={interval.closesAt}
              onChange={(event) => updateInterval(index, 'closesAt', event.target.value)}
              aria-label={`Fecha às (${WEEKDAYS.find((w) => w.value === day)?.label})`}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remover intervalo"
              onClick={() => removeInterval(index)}
            >
              ×
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

function toIntervalInputs(intervals: OperatingInterval[]): OperatingIntervalInput[] {
  return intervals.map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt }));
}

// Só monta depois que `saved` chega do servidor — o estado local nasce
// diretamente do valor inicial (sem useEffect) e passa a viver
// independente dele: reservas em edição nunca são apagadas por um refetch
// em segundo plano.
function OperatingHoursForm({
  arenaId,
  saved,
}: {
  arenaId: string;
  saved: OperatingInterval[];
}) {
  const replaceOperatingHours = useReplaceOperatingHours(arenaId);
  const [intervals, setIntervals] = useState<OperatingIntervalInput[]>(() => toIntervalInputs(saved));
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);

  function resetToSaved() {
    setIntervals(toIntervalInputs(saved));
    setError(null);
  }

  async function handleSave() {
    setError(null);
    setSavedMessage(false);
    try {
      await replaceOperatingHours.mutateAsync(intervals);
      setSavedMessage(true);
    } catch (submitError) {
      setError(
        submitError instanceof ApiError ? submitError.message : 'Não foi possível salvar o horário.',
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">
          Overnight (intervalo passando da meia-noite) não é suportado — cada intervalo precisa
          começar e terminar no mesmo dia.
        </CardTitle>
      </CardHeader>
      <CardContent>
        {WEEKDAYS.map((weekday) => (
          <DayRow key={weekday.value} day={weekday.value} intervals={intervals} onChange={setIntervals} />
        ))}

        {error ? (
          <Alert variant="destructive" role="alert" className="mt-3">
            <AlertTitle>Erro</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {savedMessage ? (
          <Alert role="status" className="mt-3">
            <AlertTitle>Horário atualizado</AlertTitle>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={resetToSaved}>
          Cancelar edição
        </Button>
        <Button type="button" onClick={handleSave} disabled={replaceOperatingHours.isPending}>
          {replaceOperatingHours.isPending ? 'Salvando…' : 'Salvar horário'}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function OperatingHoursEditor({ arenaId }: { arenaId: string }) {
  const { data: adminArenas } = useMyAdminArenas();
  const { data: dashboard } = useDashboard(arenaId, undefined);
  const { data: saved, isPending, isError } = useOperatingHours(arenaId);

  return (
    <>
      <DashboardHeader
        arenaId={arenaId}
        arenaName={dashboard?.arena.name ?? '…'}
        adminArenas={adminArenas ?? []}
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <h2 className="text-lg font-semibold">Horário de funcionamento</h2>

        {isPending ? <LoadingState label="Carregando horários…" /> : null}
        {isError ? <ErrorState message="Não foi possível carregar o horário de funcionamento." /> : null}

        {saved ? <OperatingHoursForm arenaId={arenaId} saved={saved} /> : null}
      </div>
    </>
  );
}

export default function OperatingHoursPage({ params }: { params: Promise<{ arenaId: string }> }) {
  const { arenaId } = use(params);
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState label="Carregando…" />}>
        <OperatingHoursEditor arenaId={arenaId} />
      </Suspense>
    </RequireAuth>
  );
}
