import type { ReactNode } from 'react';
import { AlertCircleIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

export function ErrorState({
  message = 'Não foi possível carregar as informações. Tente novamente.',
}: {
  message?: string;
}) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircleIcon />
      <AlertTitle>Algo deu errado</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

// `action` (Fase 28): slot opcional pra um botão/link logo abaixo da
// mensagem — reaproveitado em todo estado vazio que tem uma próxima ação
// óbvia (ex: "nenhuma quadra ainda" → botão de criar), em vez de cada tela
// inventar seu próprio empty-state com CTA.
export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      <p>{message}</p>
      {action}
    </div>
  );
}
