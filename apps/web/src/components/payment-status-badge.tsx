import { CheckCircle2Icon, ClockIcon, XCircleIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { PaymentStatus } from '@/lib/types';

// Nunca depende só de cor (mesmo princípio de BookingStatusBadge) — ícone +
// label sempre juntos. PENDING é o único estado não-terminal (Fase 17); os
// outros quatro são definitivos, refletidos aqui sem ambiguidade.
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
  }
}
