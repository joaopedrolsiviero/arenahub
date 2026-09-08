// Espelha apps/web/src/app/globals.css (docs/DESIGN.md) — mesmos valores de
// marca, convertidos de OKLCH para hex porque React Native não interpreta
// oklch() em estilos. Nenhuma cor foi reinventada: cada valor abaixo é a
// conversão direta do token OKLCH equivalente do Web (calculada via canvas
// 2D, que resolve OKLCH -> sRGB do mesmo jeito que o browser faz).
//
// "Court Lime" (brand) continua sendo a única cor de marca — accent visual E
// sinal semântico de disponível/confirmado, mesma dupla função do Web.
export const colors = {
  background: '#fbfaf7',
  foreground: '#11141a',
  card: '#ffffff',
  cardForeground: '#11141a',
  muted: '#f1f0ec',
  mutedForeground: '#5f636c',
  border: '#e0ded8',
  destructive: '#d40924',
  destructiveForeground: '#fbfaf7',
  brand: '#a6e146',
  brandForeground: '#0d1800',
  // Sem token "success" próprio no Web — a mesma cor de marca já cumpre esse
  // papel lá (ver comentário em globals.css: "accent visual E confirmado").
  // Alias explícito aqui só para o vocabulário pedido nesta fase, mesma cor.
  success: '#a6e146',
  successForeground: '#0d1800',
  warning: '#f5ae39',
  warningForeground: '#441c00',
} as const;

// --radius: 0.7rem no Web (base 16px/rem) -> 11.2px, arredondado pra 12.
// Mesma escala relativa de globals.css (sm/md/lg/xl), sem os multiplicadores
// 2xl-4xl que o Web usa só em elementos que não existem nesta fase.
export const radius = {
  sm: 7,
  md: 10,
  lg: 12,
  xl: 16,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

// Sem fonte customizada carregada nesta fase (expo-font não foi instalado —
// nenhuma tela precisa disso ainda) — pesos do sistema, mesma hierarquia de
// tamanho que o Web usa para heading/body/label.
export const typography = {
  heading: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  title: { fontSize: 20, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
};
