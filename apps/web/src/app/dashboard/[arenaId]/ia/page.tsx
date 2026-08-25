'use client';

import { Suspense, use, useState, type FormEvent } from 'react';
import { useAskAi, useDashboard, useMyAdminArenas } from '@/hooks/use-api';
import { DashboardHeader } from '@/components/dashboard-header';
import { LoadingState, ErrorState } from '@/components/async-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RequireAuth } from '@/components/require-auth';
import { ApiError } from '@/lib/api';
import { formatDateLabel } from '@/lib/format';
import type { AiPeriodPreset, AskAiResponse } from '@/lib/types';

const PERIOD_OPTIONS: { value: AiPeriodPreset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last7days', label: 'Últimos 7 dias' },
  { value: 'last30days', label: 'Últimos 30 dias' },
  { value: 'thisWeek', label: 'Esta semana' },
  { value: 'lastWeek', label: 'Semana passada' },
];

// Item 20 do prompt da fase — perguntas rápidas pra reduzir o atrito de
// escrever a pergunta do zero.
const QUICK_QUESTIONS = [
  'Como foi o movimento hoje?',
  'Qual quadra está mais ocupada?',
  'Qual foi o horário de maior demanda?',
  'Compare esta semana com a anterior.',
  'Qual foi a receita estimada nos últimos 7 dias?',
];

const QUESTION_MAX_LENGTH = 500;

export function AiAssistant({ arenaId }: { arenaId: string }) {
  const { data: adminArenas } = useMyAdminArenas();
  const { data: dashboard } = useDashboard(arenaId, undefined);
  const askAi = useAskAi(arenaId);

  const [question, setQuestion] = useState('');
  const [periodSelection, setPeriodSelection] = useState<AiPeriodPreset | 'custom'>('last7days');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [result, setResult] = useState<AskAiResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isCustomPeriod = periodSelection === 'custom';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setResult(null);

    const period = isCustomPeriod
      ? { from: customFrom, to: customTo }
      : { preset: periodSelection };

    try {
      const response = await askAi.mutateAsync({ question, period });
      setResult(response);
    } catch (error) {
      // Erro TÉCNICO (não conseguiu consultar) é sempre diferente de uma
      // resposta válida dizendo "não há dados suficientes" — essa segunda
      // vem como `result.answer` normal, nunca cai aqui (item 21 do prompt).
      setErrorMessage(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível consultar o assistente agora. Tente novamente.',
      );
    }
  }

  return (
    <>
      <DashboardHeader
        arenaId={arenaId}
        arenaName={dashboard?.arena.name ?? ''}
        adminArenas={adminArenas ?? []}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div>
          <h2 className="font-heading text-xl font-bold">Assistente de IA</h2>
          <p className="text-sm text-muted-foreground">
            Pergunte sobre a operação da sua arena — reservas, ocupação, horários de pico e mais.
            As respostas são baseadas só nos dados reais desta arena; a IA nunca executa ações.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ai-question">Sua pergunta</Label>
                <Textarea
                  id="ai-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ex: qual quadra está mais ocupada essa semana?"
                  maxLength={QUESTION_MAX_LENGTH}
                  required
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {QUICK_QUESTIONS.map((quickQuestion) => (
                  <Button
                    key={quickQuestion}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQuestion(quickQuestion)}
                  >
                    {quickQuestion}
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ai-period">Período</Label>
                  <select
                    id="ai-period"
                    value={periodSelection}
                    onChange={(event) => setPeriodSelection(event.target.value as AiPeriodPreset | 'custom')}
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  >
                    {PERIOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    <option value="custom">Período personalizado</option>
                  </select>
                </div>

                {isCustomPeriod ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="ai-from">De</Label>
                      <Input
                        id="ai-from"
                        type="date"
                        value={customFrom}
                        onChange={(event) => setCustomFrom(event.target.value)}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="ai-to">Até</Label>
                      <Input
                        id="ai-to"
                        type="date"
                        value={customTo}
                        onChange={(event) => setCustomTo(event.target.value)}
                        required
                      />
                    </div>
                  </>
                ) : null}
              </div>

              <Button
                type="submit"
                className="w-fit"
                disabled={askAi.isPending || !question.trim()}
              >
                {askAi.isPending ? 'Consultando…' : 'Perguntar'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {askAi.isPending ? <LoadingState label="Consultando o assistente…" /> : null}

        {errorMessage ? <ErrorState message={errorMessage} /> : null}

        {result ? (
          <Card>
            <CardHeader>
              <CardTitle>Resposta</CardTitle>
              <CardDescription>
                Período analisado: {formatDateLabel(result.period.from)} até{' '}
                {formatDateLabel(result.period.to)} ({result.timezone})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{result.answer}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

export default function AiPage({ params }: { params: Promise<{ arenaId: string }> }) {
  const { arenaId } = use(params);
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState label="Carregando…" />}>
        <AiAssistant arenaId={arenaId} />
      </Suspense>
    </RequireAuth>
  );
}
