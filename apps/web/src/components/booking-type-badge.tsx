import { Badge } from '@/components/ui/badge';
import type { BookingType } from '@/lib/types';

const LABEL: Record<BookingType, string> = {
  CUSTOMER: 'Cliente',
  BLOCK: 'Bloqueio',
  MAINTENANCE: 'Manutenção',
};

export function BookingTypeBadge({ type }: { type: BookingType }) {
  if (type === 'CUSTOMER') {
    return <Badge variant="secondary">{LABEL.CUSTOMER}</Badge>;
  }
  return <Badge variant="outline">{LABEL[type]}</Badge>;
}
