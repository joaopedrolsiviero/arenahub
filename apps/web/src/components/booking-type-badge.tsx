import { BanIcon, UserIcon, WrenchIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { BookingType } from '@/lib/types';

const LABEL: Record<BookingType, string> = {
  CUSTOMER: 'Cliente',
  BLOCK: 'Bloqueio',
  MAINTENANCE: 'Manutenção',
};

// CUSTOMER / BLOCK / MAINTENANCE precisam ser diferenciáveis sem depender só
// de cor (item 21) — cada tipo tem ícone e variante de badge próprios.
const CONFIG: Record<BookingType, { icon: typeof UserIcon; variant: 'brand' | 'outline' | 'warning' }> = {
  CUSTOMER: { icon: UserIcon, variant: 'brand' },
  BLOCK: { icon: BanIcon, variant: 'outline' },
  MAINTENANCE: { icon: WrenchIcon, variant: 'warning' },
};

export function BookingTypeBadge({ type }: { type: BookingType }) {
  const { icon: Icon, variant } = CONFIG[type];
  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" />
      {LABEL[type]}
    </Badge>
  );
}
