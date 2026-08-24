import { CheckCircle2Icon, XCircleIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { BookingStatus } from '@/lib/types';

// Nunca depende só de cor (item 60/28): ícone + label sempre juntos.
export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  if (status === 'CANCELLED') {
    return (
      <Badge variant="destructive">
        <XCircleIcon data-icon="inline-start" />
        Cancelada
      </Badge>
    );
  }
  return (
    <Badge variant="brand">
      <CheckCircle2Icon data-icon="inline-start" />
      Confirmada
    </Badge>
  );
}
