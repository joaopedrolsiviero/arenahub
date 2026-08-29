import { CheckCircle2Icon, ClockIcon, Undo2Icon, XCircleIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { PaymentStatus } from '@/lib/types';

// Nunca depende só de cor (mesmo princípio de BookingStatusBadge) — ícone +
// label sempre juntos. PENDING/REFUNDING (Fase 27) são os únicos estados
// não-terminais; os demais são definitivos, refletidos aqui sem ambiguidade.
// REFUNDED nunca reaproveita o ícone/cor de PAID — "reembolsado" precisa ser
// inconfundível com "pago" numa leitura rápida da lista.
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  switch (status) {
    case 'PAID':
      return (
        <Badge variant="brand">
          <CheckCircle2Icon data-icon="inline-start" />
          Pago
        </Badge>
      );
    case 'PENDING':
      return (
        <Badge variant="warning">
          <ClockIcon data-icon="inline-start" />
          Aguardando pagamento
        </Badge>
      );
    case 'FAILED':
      return (
        <Badge variant="destructive">
          <XCircleIcon data-icon="inline-start" />
          Pagamento recusado
        </Badge>
      );
    case 'EXPIRED':
      return (
        <Badge variant="destructive">
          <XCircleIcon data-icon="inline-start" />
          Expirado
        </Badge>
      );
    case 'CANCELLED':
      return (
        <Badge variant="secondary">
          <XCircleIcon data-icon="inline-start" />
          Cancelado
        </Badge>
      );
    case 'REFUNDING':
      return (
        <Badge variant="warning">
          <ClockIcon data-icon="inline-start" />
          Reembolso em processamento
        </Badge>
      );
    case 'REFUNDED':
      return (
        <Badge variant="secondary">
          <Undo2Icon data-icon="inline-start" />
          Reembolsado
        </Badge>
      );
  }
}
