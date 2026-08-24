# ArenaHub — Design System

> Companheiro de `docs/ARCHITECTURE.md` — este documento é sobre a camada
> visual (identidade, tokens, componentes, princípios), não sobre a
> arquitetura do sistema. Escrito seguindo a skill `/design-taste-frontend`.

**Status**: fundação visual + experiência do cliente (descoberta → reserva →
minhas reservas) **e** dashboard administrativo redesenhados e verificados
(lint/typecheck/test/build, duas rodadas). Ambos compartilham a mesma
fundação (tokens, botão, badge, card, wordmark) mas nunca a mesma navegação
(item 65) — cliente é mais visual/emocional, admin é mais
funcional/informativo (item 19), como pedido.

---

## 1. Direção visual

**"Sports club meets premium SaaS"** — energia de marca esportiva moderna
combinada com a clareza de um SaaS premium. Evita explicitamente: sistema
governamental, ERP, painel administrativo genérico, template Bootstrap,
dashboard de startup genérico, clichês esportivos (bola, chama, raio,
textura de grama).

**Leitura de design**: produto de reserva esportiva com dois públicos
(cliente + operador), leaning em Tailwind v4 + shadcn/ui (customizado a
fundo, sem trocar de biblioteca) + Geist Sans/Mono (já presentes no
projeto).

**Dials**: `DESIGN_VARIANCE: 6` · `MOTION_INTENSITY: 5` · `VISUAL_DENSITY: 4`
— registro premium-consumer, mas sempre priorizando reservar uma quadra
rápido; nada de experimentalismo que atrapalhe a tarefa.

---

## 2. Princípios

1. **Uma única cor de marca, usada em tudo.** Nunca uma cor pra botão e
   outra pra "disponível". A mesma cor de marca cumpre as duas funções
   deliberadamente (ver Seção 3).
2. **Números críticos sempre em mono tabular.** Horários, preços,
   contagens — a classe utilitária `.tabular` (Geist Mono + tabular-nums)
   garante que dígitos nunca "dancem" de largura.
3. **Nenhum estado depende só de cor.** Badges de status/tipo sempre têm
   ícone + texto (ex: `BookingTypeBadge`, `BookingStatusBadge`).
4. **Reaproveitar antes de criar.** O date-nav do dashboard
   (`DashboardDateNav`) foi reaproveitado no fluxo de reserva do cliente em
   vez de duplicado — cliente e admin compartilham vocabulário visual.
5. **Ações destrutivas sempre confirmam.** Cancelamento de reserva passou a
   exigir confirmação num `AlertDialog` antes de disparar a mutação (não
   existia antes desta rodada).

---

## 3. Paleta — "Court Lime"

Uma cor de marca, com dupla função deliberada: é o accent visual do produto
**e** o sinal semântico de "disponível / confirmado" — a mesma cor que
convida a clicar num horário livre é a cor da marca no header. Escolhida
para evocar linha de quadra/energia sem cair em clichê (não é uma bola, não
é uma chama).

| Token | Uso |
|---|---|
| `--brand` / `--color-brand` | CTA primário, nav ativa, disponível/selecionado na grade, badge de confirmado |
| `--warning` | Badge de manutenção — nunca usado como accent de marca |
| `--destructive` | Cancelamento, erros |
| `--background` / `--foreground` | Off-white quente / tinta escura — nunca branco/preto puro (nenhum dos dois é `oklch(0/1 0 0)`) |

Light mode é o padrão (uso predominante é mobile, ao ar livre, escolhendo
horário). Dark mode existe com os mesmos tokens semânticos recalculados
(`--brand` mantém a mesma luminância — já lê bem sobre fundo escuro sem
ajuste), não é uma inversão automática.

---

## 4. Tipografia

Mantido **Geist Sans** (títulos/UI) + **Geist Mono** (números) — já
integrados via `next/font` desde a Fase 1, zero dependência nova. A escolha
resolve diretamente o requisito de horários "extremamente fáceis de
identificar": mono + `tabular-nums` elimina qualquer variação de largura
entre dígitos.

---

## 5. Componentes — fundação (`src/components/ui`)

- **Button** — variante `default` agora é sempre `bg-brand` (a ação
  principal do produto nunca disputa com outra cor de destaque na mesma
  tela). `active:scale-[0.98]` para feedback tátil.
- **Card** — sombra tinta pro tom do texto (nunca preto puro), nunca
  disputando com `ring-foreground/8`.
- **Badge** — duas variantes novas: `brand` (confirmado/disponível) e
  `warning` (manutenção), somadas às existentes.
- **AlertDialog** (novo) — construído sobre `@base-ui/react/alert-dialog`
  (mesma base já usada por Button/Badge/Input/Separator — nenhuma
  biblioteca nova). Usado hoje só no cancelamento de reserva.

## 6. Componentes — produto

- `SiteHeader` (novo) — navegação do cliente (ArenaHub · Arenas · Minhas
  reservas · UserButton), deliberadamente nunca renderizada nas rotas
  `/dashboard/*` (separação de fluxos preservada da Fase 6).
- `AvailabilityGrid` — reescrita: pill de 48px de altura (alvo de toque
  generoso), disponível com contorno translúcido da marca, selecionado com
  preenchimento sólido + ícone de check, indisponível com `line-through` e
  fundo neutro — os três estados nunca se confundem, nem em escala de
  cinza.
- `BookingSummaryCard`, `BookingCard`, `ArenaCard`, `CourtCard` — hierarquia
  reforçada (título > dado > preço), preço sempre em mono.
- `BookingStatusBadge` / `BookingTypeBadge` — ícone + variante de badge por
  estado (nunca só cor).

---

## 7. Dados reais, sem invenção

Nenhum campo foi inventado. Notavelmente: `ArenaCard` **não** mostra
cidade/distância — o tipo `ArenaDiscoverySummary` não tem esse campo na API
hoje. Um bloco de gradiente com as iniciais da arena substitui a foto (o
modelo de dados não tem imagens ainda — item 45 do prompt).

---

## 8. Dashboard administrativo — decisões específicas

- **Resumo do dia**: quebra deliberada do padrão "4 cards iguais" — 1
  número em destaque (reservas confirmadas hoje) + métricas secundárias
  como chips inline (`DashboardSummaryCards`).
- **Timeline de ocupação**: nova barra visual por quadra
  (`CourtOccupancyBar` em `booking-timeline.tsx`) — posiciona cada reserva
  no tempo real dentro da janela de funcionamento, marca lacunas de
  funcionamento (ex: pausa de almoço) com hachurado, e mantém a lista
  textual abaixo para detalhe/acessibilidade. Cor por tipo
  (CUSTOMER/BLOCK/MAINTENANCE) nunca é o único sinal — a lista abaixo
  sempre tem `BookingTypeBadge` (ícone + texto).
- **Configurações**: formulário único gigante virou 3 cards agrupados
  (Identidade / Contato / Timezone) — continua sendo **um único** submit
  para o mesmo endpoint PATCH, sem inventar múltiplos endpoints (item 43).
- **Horários**: cada dia da semana ganhou um badge "Aberto"/"Fechado" pra
  escaneamento rápido, mantendo a edição de intervalos como já existia.
- **DashboardHeader**: ganhou a wordmark da marca (mesma do `SiteHeader`),
  nav ativa agora usa a cor de marca — identidade compartilhada sem
  compartilhar navegação.

## 9. Pendências reais

- **Dark mode**: os tokens existem e foram pensados desde o início (Seção
  3), mas não foi verificado visualmente em nenhuma das duas rodadas (sem
  screenshot disponível no ambiente — ver relatório final).
- **CSP / headers**: fora de escopo desta tarefa (decisão da Fase 9).
