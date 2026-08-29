import { useMemo } from 'react';

// IANA nativo do runtime — nunca um catálogo próprio de timezones (item 34
// da Fase 7), mesma fonte de verdade que o backend usa para validar
// (Intl.supportedValuesOf('timeZone')). Compartilhado (Fase 28) entre o
// formulário de configurações da arena e o de criação — nenhuma segunda
// lista mantida à mão.
export function useTimezoneOptions(): string[] {
  return useMemo(() => Intl.supportedValuesOf('timeZone'), []);
}

// Sugestão inicial (Fase 28, item 5: "timezone detectado como sugestão") —
// nunca a decisão final: o OWNER sempre vê e pode trocar no seletor
// explícito acima. `Intl.DateTimeFormat().resolvedOptions().timeZone` é a
// mesma API nativa, então a sugestão sempre bate com um valor IANA válido
// (nunca um offset tipo "UTC-3").
export function detectBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
