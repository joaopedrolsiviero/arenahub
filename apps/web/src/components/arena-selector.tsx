'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AdminArena } from '@/lib/types';

export function ArenaSelector({
  arenas,
  currentArenaId,
  onChange,
}: {
  arenas: AdminArena[];
  currentArenaId: string;
  onChange: (arenaId: string) => void;
}) {
  if (arenas.length <= 1) {
    return null;
  }

  return (
    <Select value={currentArenaId} onValueChange={(value) => onChange(value as string)}>
      <SelectTrigger aria-label="Selecionar arena">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {arenas.map((arena) => (
          <SelectItem key={arena.id} value={arena.id}>
            {arena.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
