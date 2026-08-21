import { Badge } from '@/components/ui/badge';
import type { BookingStatus } from '@/lib/types';

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  if (status === 'CANCELLED') {
    return <Badge variant="destructive">Cancelada</Badge>;
  }
  return <Badge variant="secondary">Confirmada</Badge>;
}
