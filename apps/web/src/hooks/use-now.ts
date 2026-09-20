import { useSyncExternalStore } from 'react';

// Relógio de UI (atualiza a cada 30s) lido via `useSyncExternalStore` — o
// jeito oficial do React de ler `Date.now()` (impuro) durante o render.
// Mesmo padrão de `minhas-reservas/[bookingId]/page.tsx`. Servidor sempre
// "agora = 0": nada é considerado "já começou" até a hidratação resolver o
// valor real. Só atalho de UX: a autoridade é sempre o backend.
let cachedNow = Date.now();

function subscribeToClock(callback: () => void): () => void {
  const interval = setInterval(() => {
    cachedNow = Date.now();
    callback();
  }, 30_000);
  return () => clearInterval(interval);
}

function getClockSnapshot(): number {
  return cachedNow;
}

function getServerClockSnapshot(): number {
  return 0;
}

export function useNow(): number {
  return useSyncExternalStore(subscribeToClock, getClockSnapshot, getServerClockSnapshot);
}
