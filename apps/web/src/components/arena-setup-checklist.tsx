import Link from 'next/link';
import { CheckCircle2Icon, CircleAlertIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ArenaSetupStatus } from '@/lib/types';

// Fase 28, item 11 — cada item aqui espelha um campo de `ArenaSetupStatus`
// (sempre DERIVADO pelo backend, nunca uma coluna própria) e aponta pra
// tela administrativa que já existe pra resolver aquele item — nenhuma tela
// nova de configuração criada só pra isto, só a orientação de onde ir.
const CHECKLIST_ITEMS: {
  key: keyof Omit<ArenaSetupStatus, 'isReady'>;
  label: string;
  href: (arenaId: string) => string;
}[] = [
  {
    key: 'hasBasicInfo',
    label: 'Dados básicos da arena',
    href: (arenaId) => `/dashboard/${arenaId}/configuracoes`,
  },
  {
    key: 'hasActiveCourtWithPricing',
    label: 'Pelo menos uma quadra ativa com preço definido',
    href: (arenaId) => `/dashboard/${arenaId}/quadras`,
  },
  {
    key: 'hasOperatingHours',
    label: 'Horário de funcionamento configurado',
    href: (arenaId) => `/dashboard/${arenaId}/horarios`,
  },
];

export function ArenaSetupChecklist({
  arenaId,
  setupStatus,
}: {
  arenaId: string;
  setupStatus: ArenaSetupStatus;
}) {
  if (setupStatus.isReady) {
    return (
      <Alert role="status" className="border-brand/30 bg-brand/8">
        <CheckCircle2Icon className="text-brand" />
        <AlertTitle>Sua arena está pronta</AlertTitle>
        <AlertDescription>Já pode receber reservas de clientes.</AlertDescription>
      </Alert>
    );
  }

  const pendingCount = CHECKLIST_ITEMS.filter((item) => !setupStatus[item.key]).length;

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardHeader>
        <CardTitle>Configure sua arena</CardTitle>
        <CardDescription>
          {pendingCount} {pendingCount === 1 ? 'etapa restante' : 'etapas restantes'} pra começar a
          receber reservas.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {CHECKLIST_ITEMS.map((item) => {
          const done = setupStatus[item.key];
          return (
            <Link
              key={item.key}
              href={item.href(arenaId)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              {done ? (
                <CheckCircle2Icon className="size-4 shrink-0 text-brand" aria-hidden="true" />
              ) : (
                <CircleAlertIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
              )}
              <span className={done ? 'text-muted-foreground line-through' : 'font-medium'}>
                {item.label}
              </span>
              <span className="sr-only">{done ? '(concluído)' : '(pendente)'}</span>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
