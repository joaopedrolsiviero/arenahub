# ArenaHub

Plataforma inteligente de gestão para arenas esportivas (beach tennis, vôlei de praia, tênis,
futebol society, futevôlei, basquete e outras modalidades) — reservas sem double booking, painel
para administradores e, no futuro, descoberta de arenas e reservas via IA/WhatsApp.

A arquitetura completa do produto (personas, MVP, modelo de dados, API, regra de reserva,
segurança e roadmap) está documentada em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — leia
esse documento antes de contribuir com qualquer funcionalidade de negócio. Para colocar o sistema
em produção, veja [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

> **Status:** Fase 9 — Deploy e Infraestrutura, **preparada e parcialmente destravada**. O
> repositório agora está no GitHub (`github.com/fraagelo/arenahub`) com CI (GitHub Actions) rodando
> de verdade num runner real pela primeira vez — e a primeira execução **falhou**, revelando mais um
> bug real: o placeholder `CLERK_WEBHOOK_SIGNING_SECRET` do workflow não era um base64 válido para a
> lib `standardwebhooks` (só funcionava por acidente localmente, porque o `.env` real não versionado
> usa outro valor). Corrigido e revalidado — CI verde na segunda execução. Ao tentar o deploy real no
> Railway, esbarramos num bloqueio diferente dos anteriores: **custo**, não falta de acesso — o
> Railway hoje exige o Hobby plan (US$5/mês) para qualquer deploy, e a decisão consciente (do
> usuário) foi **pausar antes de gastar**. Vercel e Clerk produção continuam bloqueados por falta de
> conta/ambiente criado. `apps/api/Dockerfile` (build de produção) foi **construído e rodado** contra
> o Postgres local — não só escrito — o que revelou 5 bugs reais de build/runtime (inclusive que
> `pnpm start:prod` nunca funcionou desde que foi criado, silenciosamente). `GET /v1/health`
> (liveness) e `GET /v1/health/ready` (readiness, checagem real do Postgres) substituem o health
> check único de antes; `app.enableShutdownHooks()` agora faz `SIGTERM` encerrar a API de forma
> limpa. Headers de segurança novos no frontend, testados contra `next start` local real. Ver
> [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) para o detalhamento completo de cada item — o que é
> IMPLEMENTADO/TESTADO vs. BLOQUEADO POR CUSTO vs. BLOQUEADO POR INFRAESTRUTURA, sem inventar deploy
> que não aconteceu.
>
> OWNER/ADMIN continuam com o painel próprio em `/dashboard` (Fase 7), separado da experiência do
> cliente: escolher a arena administrada → resumo do dia → próximas reservas → ocupação por quadra
> → editar horário de funcionamento, quadras, configurações e, desde a **Fase 10 (concluída)**,
> **equipe** (`/dashboard/[arenaId]/equipe`) — o OWNER lista, adiciona, promove e remove ADMIN da
> arena; "no máximo um OWNER por arena" agora é garantido pelo próprio Postgres (índice único
> parcial), não só pela aplicação. Desde a **Fase 11 (concluída)**, a mesma tela ganhou uma aba
> **Convites**: o OWNER convida alguém por e-mail (mesmo sem conta ainda) para virar ADMIN — a
> pessoa recebe um link com token de 256 bits (só o hash é salvo no banco), autentica via Clerk em
> `/convites/[token]` e aceita; o OWNER também pode **transferir a propriedade** da arena para um
> ADMIN existente via um endpoint explícito e atômico (nunca implícito via `PATCH /members`) — o
> antigo OWNER vira ADMIN, nunca é removido. Desde a **Fase 12 (concluída)**, o painel ganhou uma
> aba **IA** (`/dashboard/[arenaId]/ia`): OWNER/ADMIN perguntam em português ("qual quadra está mais
> ocupada?", "compare esta semana com a anterior") e recebem uma resposta baseada só em métricas
> reais calculadas pelo backend (Postgres) — a IA nunca vê o banco direto, nunca inventa número e
> nunca executa nenhuma ação (é só leitura/análise nesta fase). A experiência do cliente (Fase 6,
> consolidada e testada a fundo na **Fase 13**) segue: login (Clerk) → descobrir arenas → escolher
> quadra → escolher data → ver disponibilidade real → escolher horário → confirmar →
> "minhas reservas" (`/minhas-reservas`, abas Próximas/Histórico/Canceladas) → cancelar com
> confirmação (cancelamento protegido contra corrida concorrente desde a Fase 13; sem prazo mínimo
> de antecedência — decisão explícita, não uma lacuna). Desde a **Fase 14 (concluída)**, o painel
> ganhou uma aba **Clientes** (`/dashboard/[arenaId]/clientes`): OWNER/ADMIN listam, buscam e
> consultam quem já reservou na arena — resumo (total/confirmadas/canceladas/receita estimada) e
> histórico de reservas, sempre isolado por arena (o mesmo cliente em duas arenas tem números
> completamente separados em cada uma). Não é um CRM — sem campanhas, cupons ou métricas
> especulativas. Desde a **Fase 15 (concluída)**, o painel ganhou uma aba **Relatórios**
> (`/dashboard/[arenaId]/relatorios`): receita, ocupação, reservas confirmadas/canceladas,
> desempenho por quadra e demanda por horário, com comparação ao período anterior — construída
> inteiramente sobre a mesma `OperationalMetricsService` que já alimenta a IA (Fase 12), nunca uma
> segunda fórmula. Desde a **Fase 16 (concluída)**, o cliente pode conversar pelo **WhatsApp** com a
> arena: consultar disponibilidade/quadras/preços, ver e criar reservas, cancelar — tudo em
> linguagem natural, com confirmação explícita antes de qualquer ação. A IA só classifica a
> intenção da mensagem (nunca responde ao cliente diretamente nem decide arena/usuário/preço); quem
> executa é o mesmo `BookingsService`/`AvailabilityService` do resto do produto, com o mesmo
> lock/EXCLUDE constraint/Idempotency-Key da Fase 4. Sem credenciais reais da Meta neste ambiente —
> testado com um provider fake (ver `docs/DEPLOYMENT.md`). Desde a **Fase 17 (concluída)**, uma
> reserva CUSTOMER pode ser paga via **PIX** (Mercado Pago): a seção financeira em
> `/minhas-reservas/[bookingId]` mostra valor, status e o código PIX, com confirmação só via
> webhook assinado do gateway — nunca o frontend decidindo que um pagamento foi concluído. O ciclo
> financeiro (`Payment`) é deliberadamente separado do ciclo operacional (`Booking.status`, que
> continua só `CONFIRMED`/`CANCELLED`); nenhum refund foi implementado. Sem credenciais reais do
> Mercado Pago neste ambiente — testado com um provider fake (ver `docs/DEPLOYMENT.md`). Backend
> continua a única autoridade em tudo — disponibilidade, preço, dono da reserva, acesso
> administrativo. Double booking continua prevenido em camadas reais no Postgres
> (`pg_advisory_xact_lock` + `EXCLUDE USING GIST`) com `Idempotency-Key` persistida — inteiramente
> PostgreSQL, sem depender de Redis. A **Fase 18 (concluída)** foi uma auditoria e hardening de
> produção, sem nenhuma funcionalidade de produto nova: rate limiting pela primeira vez no produto
> (em memória, por instância — limitação documentada, não escondida), headers de segurança HTTP no
> backend (`helmet`), correlation ID (`X-Request-Id`) propagado via `AsyncLocalStorage` nativo do
> Node, um filtro global de exceções que garante que nenhum erro não previsto vaza detalhe interno,
> `WEB_APP_URL` agora obrigatória em produção, e `HEALTHCHECK` nativo do Docker — validado de
> verdade contra uma imagem construída e executada nesta fase, não só escrito. A **Fase 19** colocou
> o ArenaHub em infraestrutura real: frontend público na Vercel
> (`arenahub-xi.vercel.app`), backend público na Railway
> (`api-production-34e0.up.railway.app`, saudável, conectado a um Postgres gerenciado real), com
> login e navegação autenticada validados de ponta a ponta contra essa infraestrutura ao vivo. O
> Clerk roda em ambiente de **Development**, deliberadamente — o ambiente de Production existe mas
> está bloqueado até haver um domínio próprio (Clerk produção exige DNS verificável, que um
> subdomínio `*.vercel.app`/`*.up.railway.app` não oferece; ver `docs/DEPLOYMENT.md`, Seção 8, para
> o achado completo e o passo a passo de migração quando houver domínio). Detalhes completos,
> histórico de investigação e checklist de smoke test em `docs/DEPLOYMENT.md`. A **Fase 20**
> auditou esse deploy real sem adicionar nada novo: saúde, migrations, CORS, segredos e headers de
> segurança reconfirmados contra a infraestrutura ao vivo (nenhum problema crítico encontrado, um
> bug cosmético de log corrigido); nenhuma credencial real de OpenAI/Mercado Pago/WhatsApp está
> configurada em produção ainda; o fluxo completo de reserva em produção continua sem validar,
> porque criar a primeira arena de teste esbarra numa decisão de produto em aberto (deve ser
> autocadastro aberto, como é hoje, ou exigir aprovação?). Classificação: **GO com ressalvas** — ver
> o relatório da Fase 20 para a lista completa de pendências antes de abrir pro público.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js (App Router) · React · TypeScript · Tailwind CSS · shadcn/ui |
| Backend | NestJS · TypeScript · REST · Prisma |
| Autenticação | Clerk (frontend: `@clerk/nextjs`; backend: `@clerk/backend`) |
| Banco | PostgreSQL · Redis |
| Timezone | Luxon (conversão local↔UTC com IANA/DST — nunca aritmética manual de offset; usado na API e no frontend) |
| Dados no frontend | TanStack Query (cache/invalidação — não um state manager global) |
| Jobs | BullMQ (a partir da Fase 12) |
| Monorepo | pnpm workspaces · Turborepo |
| Qualidade | ESLint · Prettier · TypeScript strict mode · Jest · React Testing Library |
| Infra local | Docker Compose |
| CI | GitHub Actions |

## Pré-requisitos

- [Node.js](https://nodejs.org/) 20 ou superior (desenvolvido e testado em Node 24)
- [pnpm](https://pnpm.io/) — se não tiver, ative via Corepack (já incluso no Node):
  ```bash
  corepack enable
  corepack prepare pnpm@11.22.0 --activate
  ```
- [Docker](https://www.docker.com/) e Docker Compose (Postgres + Redis locais)

## Instalação

```bash
git clone <url-do-repositorio>
cd arenahub
pnpm install
```

O `pnpm install` já gera o Prisma Client automaticamente (hook `postinstall` em `apps/api`).

## Execução local

1. Suba Postgres e Redis:
   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```
2. Copie os arquivos de ambiente:
   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env.local
   ```
   Os valores de `DATABASE_URL`/`REDIS_URL` já combinam com o `docker-compose.yml`. As chaves do
   Clerk (`CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`)
   precisam ser substituídas pelas suas — crie uma aplicação gratuita em
   [dashboard.clerk.com](https://dashboard.clerk.com):
   - **API keys**: copie a *Publishable key* para `apps/web/.env.local` e a *Secret key* para
     `apps/api/.env`.
   - **Webhooks**: crie um endpoint apontando para `<sua-url-pública>/v1/webhooks/clerk` (em
     desenvolvimento local, use algo como [ngrok](https://ngrok.com/) para expor
     `localhost:3001`), inscreva os eventos `user.created`, `user.updated` e `user.deleted`, e
     copie o *Signing Secret* para `CLERK_WEBHOOK_SIGNING_SECRET` em `apps/api/.env`.
3. Aplique as migrations do Prisma:
   ```bash
   pnpm --filter @arenahub/api exec prisma migrate deploy
   ```
   Opcional — popule uma arena de teste (com quadra ativa e horário de funcionamento) para ter algo
   navegável na experiência de cliente (Fase 6) sem precisar de um painel administrativo, que ainda
   não existe:
   ```bash
   pnpm --filter @arenahub/api run db:seed
   ```
4. Suba frontend e backend em paralelo:
   ```bash
   pnpm dev
   ```
   - Frontend: http://localhost:3000 (cadastro/login em `/sign-up` e `/sign-in`)
   - Backend: http://localhost:3001/v1/health

Para parar a infraestrutura local: `docker compose -f docker/docker-compose.yml down` (adicione
`-v` para também apagar os volumes de dados).

### Configurar o assistente de IA (opcional, Fase 12)

Sem isso, o resto da aplicação funciona normalmente — só a aba **IA** do painel administrativo
(`/dashboard/[arenaId]/ia`) responde 503 ("assistente indisponível").

1. Crie uma chave em [platform.openai.com](https://platform.openai.com/api-keys).
2. Em `apps/api/.env`, defina `AI_PROVIDER_API_KEY="sk-..."` (a chave real, nunca a de exemplo do
   `.env.example`).
3. Opcional: `AI_PROVIDER_MODEL` (default `gpt-4o-mini`) e `AI_PROVIDER_TIMEOUT_MS` (default
   `15000`).
4. Reinicie a API (`pnpm dev` já recarrega ao salvar o `.env`, mas confirme se não recarregar
   sozinho).

Exemplos de perguntas que o assistente responde (sempre em relação à arena selecionada, com base
só em dados reais — nunca inventa número):

- "Quantas reservas tivemos hoje?"
- "Qual quadra está mais ocupada?"
- "Qual foi o horário de maior demanda nos últimos 7 dias?"
- "Compare esta semana com a semana passada."
- "Qual foi a receita estimada dos últimos 30 dias?"

A chave nunca é enviada ao frontend nem aparece em log — ver `docs/DEPLOYMENT.md`, Fase 12, para os
detalhes de segurança e custo.

## Comandos principais

Executados a partir da raiz do repositório (orquestrados via Turborepo — cada comando roda em
todos os workspaces que definem o script correspondente):

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe `apps/web` e `apps/api` em modo desenvolvimento |
| `pnpm build` | Build de produção de todos os apps |
| `pnpm lint` | ESLint em todos os workspaces |
| `pnpm typecheck` | `tsc --noEmit` em todos os workspaces |
| `pnpm test` | Testes automatizados (unitários) de todos os workspaces |
| `pnpm format` | Formata todo o repositório com Prettier |

Comandos específicos de um workspace usam `--filter`, por exemplo:

```bash
pnpm --filter @arenahub/api test:e2e             # e2e da API (Nest + Supertest + Postgres real)
pnpm --filter @arenahub/api db:generate          # regenerar o Prisma Client manualmente
pnpm --filter @arenahub/api exec prisma migrate dev --name <nome>    # nova migration
pnpm --filter @arenahub/api exec prisma migrate deploy               # aplicar migrations pendentes
pnpm --filter @arenahub/web dev                  # só o frontend
```

## Estrutura do projeto

```
arenahub/
├── apps/
│   ├── web/                     # Next.js — frontend (App Router, Tailwind, shadcn/ui)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── arenas/                          # descoberta pública (Fase 6)
│   │       │   │   └── [arenaId]/courts/[courtId]/   # data picker + disponibilidade + confirmação
│   │       │   ├── minhas-reservas/                  # lista (abas) + detalhe/cancelamento (Fase 6)
│   │       │   ├── dashboard/                        # área administrativa (Fase 7), separada do cliente
│   │       │   │   └── [arenaId]/
│   │       │   │       ├── quadras[/[courtId]]/      # CRUD de quadra
│   │       │   │       ├── horarios/                 # editor de horário de funcionamento
│   │       │   │       └── configuracoes/            # dados básicos + timezone da arena
│   │       │   ├── sign-in/[[...sign-in]]/           # UI de login (Clerk)
│   │       │   └── sign-up/[[...sign-up]]/           # UI de cadastro (Clerk)
│   │       ├── components/       # ui/ (shadcn) + componentes de domínio (arena-card, booking-card,
│   │       │                     # dashboard-header, booking-timeline, arena-selector...)
│   │       ├── hooks/            # use-api.ts — hooks TanStack Query por caso de uso
│   │       ├── lib/              # api.ts (client tipado), format.ts (BRL/Luxon), types.ts
│   │       └── proxy.ts          # clerkMiddleware (convenção "proxy" do Next 16)
│   └── api/                      # NestJS — backend REST
│       ├── prisma/               # schema.prisma (User, Arena, ArenaMember, Court, Booking,
│       │                         # IdempotencyKey, ArenaOperatingHours) + migrations (inclui
│       │                         # EXCLUDE USING GIST manual)
│       └── src/
│           ├── common/             # transversal (Fase 18): rate limiting, request-id,
│           │                       # logging interceptor, filtro global de exceções
│           ├── modules/
│           │   ├── health/         # GET /v1/health (liveness) e /v1/health/ready (readiness — Fase 9)
│           │   ├── auth/           # ClerkAuthGuard, ClerkService, @CurrentUser()
│           │   ├── users/          # GET /v1/users/me
│           │   ├── webhooks/       # POST /v1/webhooks/clerk (sync de User)
│           │   ├── arena-members/  # autorização por arena: ArenaAccessGuard, @RequireArenaRole()
│           │   ├── arenas/         # POST/GET/PATCH /v1/arenas... + GET /v1/arenas/discover... (Fase 6)
│           │   ├── courts/         # CRUD de quadras aninhado em /v1/arenas/:arenaId/courts
│           │   ├── idempotency/    # IdempotencyService — Idempotency-Key persistida (claim-first)
│           │   ├── operating-hours/ # GET/PUT /v1/arenas/:arenaId/operating-hours (semana, Luxon)
│           │   ├── bookings/       # criação/listagem/cancelamento + GET /v1/users/me/bookings... (Fase 6)
│           │   ├── availability/   # cálculo de slots respeitando horário de funcionamento real
│           │   └── dashboard/      # GET /v1/arenas/:arenaId/dashboard — visão agregada (Fase 7)
│           └── prisma/             # PrismaService/PrismaModule (global)
│       └── Dockerfile              # build de produção (Fase 9) — contexto = raiz do monorepo
├── packages/
│   ├── shared/              # tipos TS e schemas Zod compartilhados entre web/api — sem regra de negócio
│   └── config/              # tsconfig e prettier base compartilhados
├── docker/
│   └── docker-compose.yml   # Postgres para desenvolvimento local (Redis provisionado mas não usado)
├── .dockerignore             # raiz, não apps/api/ — contexto de build do Docker é a raiz do monorepo
├── .nvmrc                    # versão do Node fixada, igual ao CI (Fase 9)
├── .github/workflows/       # CI (lint, typecheck, test, migrations, e2e, build)
└── docs/
    ├── ARCHITECTURE.md      # documento de arquitetura — fonte de verdade do produto
    └── DEPLOYMENT.md        # runbook de deploy/infraestrutura (Fase 9)
```

## Decisões da Fase 1

- **Portas fixas**: `web` em `3000`, `api` em `3001` (evita conflito ao rodar `pnpm dev`).
- **Prefixo de API**: todas as rotas do backend vivem sob `/v1` (`app.setGlobalPrefix('v1')`),
  conforme a Parte 9 de `docs/ARCHITECTURE.md`.
- **`PrismaModule` existe mas não é importado em `AppModule` ainda.** O Postgres e o Prisma Client
  já estão configurados e testados manualmente (`prisma db execute` contra o Postgres do Docker
  Compose), mas nenhum módulo de domínio consome `PrismaService` ainda — importar o módulo agora
  faria o bootstrap da aplicação (e os testes que o instanciam) exigir um Postgres vivo sem
  necessidade real. Isso muda a partir da Fase 2, quando o primeiro módulo de domínio precisar
  do banco.
- **`schema.prisma` só tem `datasource`/`generator`, sem models.** O schema de negócio (`User`,
  `Arena`, `Court`, `Booking`...) é modelado a partir da Fase 2, seguindo o modelo de dados já
  definido em `docs/ARCHITECTURE.md` (Parte 7).
- **Jest 29 em todos os workspaces** (não 30): o Nest CLI atual escalona `jest@^30` por padrão,
  mas a versão mais recente de `ts-jest` (`29.4.12`) ainda não é compatível com o runtime do Jest
  30 (`jest-mock` mudou de API). `jest@29` mantém `apps/api` e `apps/web` na mesma versão de test
  runner e evita a incompatibilidade.
- **Testes fazem parte da própria Fase 1** (não só a partir da Fase 8): `apps/web` e `apps/api` já
  têm smoke tests automatizados, e o CI já roda `test` desde já — ver `docs/ARCHITECTURE.md`,
  seção "Processo de desenvolvimento: testes fazem parte de cada fase".
- **`packages/shared` está vazio de propósito.** Segue a regra de escopo definida em
  `docs/ARCHITECTURE.md` (Parte 6): só tipos/schemas compartilhados, nunca regra de negócio.
- **`sharp` e `unrs-resolver` (deps nativas opcionais do Next.js) têm build scripts desabilitados**
  no `pnpm-workspace.yaml` (`allowBuilds`) até haver necessidade concreta (ex: otimização de imagem
  em produção). Os build scripts do Prisma estão explicitamente habilitados — são necessários para
  baixar o binário da query engine.

## Decisões da Fase 2

- **Clerk, conforme `docs/ARCHITECTURE.md`** (não autenticação própria por senha): cadastro,
  login e logout acontecem inteiramente no Clerk (SDK do frontend); o backend nunca vê nem
  armazena senha. Isso foi confirmado explicitamente antes de implementar, porque a arquitetura já
  registrava essa decisão e havia risco de ambiguidade com pedidos genéricos de "implementar
  auth". Ver a íntegra da decisão em `docs/ARCHITECTURE.md`, Parte 7.
- **Sem endpoints `register`/`login`/`logout` na nossa API.** Com o Clerk, essas ações acontecem
  direto entre o frontend e a infraestrutura do Clerk. O backend expõe só o necessário:
  `GET /v1/users/me` (protegido) e `POST /v1/webhooks/clerk` (sincronização).
  "Logout" é `<UserButton />`/`signOut()` do Clerk no frontend — não existe um endpoint
  correspondente no NestJS.
- **`User.id` usa `cuid()`** (padrão do Prisma para IDs distribuídos, sem depender de nenhuma
  extensão do Postgres) — tipo de identificador não especificado na arquitetura, decisão
  registrada aqui.
- **`ClerkAuthGuard` só responde "este request está autenticado?"** — anexa apenas
  `{ clerkId: string }` ao request (claim `sub` do JWT do Clerk). Não injeta papel/permissão nem
  consulta o Postgres — isso é responsabilidade da Fase 3 (RBAC/`ArenaMember`).
- **`GET /v1/users/me` pode retornar 404** se o usuário acabou de se cadastrar e o webhook do
  Clerk ainda não processou o evento `user.created` (race condition conhecida e documentada nos
  testes — `test/auth-flow.e2e-spec.ts`). Não implementamos fallback de buscar o perfil direto na
  API do Clerk para manter o escopo simples; o frontend trata esse caso mostrando uma mensagem e
  sugerindo recarregar.
- **Verificação de sessão nunca é mockada, exceto na fronteira com o Clerk.** Os testes automatizados
  não têm nenhuma conta Clerk real disponível (não é possível criar uma programaticamente), então
  só a chamada de rede para verificar o JWT do Clerk é substituída (`ClerkService` sobrescrito via
  `overrideProvider` nos testes e2e) — tudo o resto (Postgres, verificação de assinatura HMAC do
  webhook via `standardwebhooks`, guard, upsert do `User`) roda de verdade. Ver
  `apps/api/test/auth-flow.e2e-spec.ts`.
- **CI agora sobe um serviço PostgreSQL** (`.github/workflows/ci.yml`) e roda
  `prisma migrate deploy` antes do e2e — esta é exatamente a transição que a auditoria da Fase 1
  já havia previsto: "a partir do momento em que os testes de integração dependem do banco, o CI
  deve fornecer PostgreSQL".
- **`@clerk/nextjs` 7.x usa a API "Core 3"**: `<SignedIn>`/`<SignedOut>`/`<Protect>` foram
  removidos e substituídos por `<Show when="signed-in">`/`<Show when="signed-out">` — usado em
  `apps/web/src/app/page.tsx`.
- **`middleware.ts` → `proxy.ts`**: o Next.js 16 renomeou a convenção de arquivo (mesma
  funcionalidade); `apps/web/src/proxy.ts` já usa o nome novo para não construir em cima de algo
  já sinalizado como deprecated.
- **Campos de data do `User` usam `@db.Timestamptz(6)`** explicitamente no `schema.prisma`,
  conforme a decisão já registrada na auditoria da Fase 1 (o Prisma mapeia `DateTime` para
  `timestamp` sem timezone por padrão no Postgres).

## Decisões da Fase 3

- **Campos mínimos em `Arena`/`ArenaMember`/`Court`**, deliberadamente menores que a visão completa
  da Parte 7 de `docs/ARCHITECTURE.md` (que já previa endereço/timezone/imagens em `Arena`, papel
  `STAFF` e fluxo de convite em `ArenaMember`, preço/duração/buffer em `Court`) — o próprio pedido
  da fase pediu explicitamente para não antecipar campos. Tudo documentado em
  `docs/ARCHITECTURE.md` v0.3, "Decisões revisadas na v0.3".
- **`Sport` é um enum (`BEACH_VOLLEYBALL`)**, não a tabela-catálogo da Parte 7 — decisão explícita
  da fase; virar tabela de verdade só quando o catálogo precisar de mais que um nome (ícone,
  configuração por modalidade).
- **Sem `Arena.ownerId`.** O proprietário nunca é um campo direto em `Arena` — é sempre resolvido
  via `ArenaMember` com `role = OWNER`. Uma única fonte de verdade, sem risco de os dois
  divergirem.
- **Autorização centralizada em `ArenaAccessGuard` + `@RequireArenaRole(...roles)`** (módulo
  `arena-members/`), no mesmo padrão de guard+decorator já usado para o Clerk — nenhum controller
  reimplementa a checagem de acesso. O guard distingue **404** (arena não existe) de **403** (existe,
  mas sem permissão) — nunca confunde os dois, conforme pedido.
- **Rotas de quadra totalmente aninhadas** (`/v1/arenas/:arenaId/courts/:courtId`, não
  `/v1/courts/:courtId` solto) — divergência deliberada do esboço original da Parte 9. É o que
  permite o `ArenaAccessGuard` funcionar sem código extra, e o que faz uma quadra de outra arena
  nunca "vazar" só por trocar o `courtId` na URL (coberto por teste e2e).
- **`GET /v1/arenas/:arenaId/courts/:courtId` usa `findFirst({ id, arenaId })`**, não
  `findUnique({ id })` seguido de checar `arenaId` depois — a checagem de posse já é a própria
  query, não uma validação a mais que alguém poderia esquecer de adicionar depois.
- **Sem endpoint de convite de membro nesta fase.** `POST /v1/arenas/:arenaId/members` (Parte 9)
  continua no papel — a única forma de promover alguém a `ADMIN` hoje é acesso direto ao banco. O
  teste e2e que cobre "ADMIN consegue atualizar" promove um usuário assim, deliberadamente, para
  provar que o `ArenaAccessGuard` já respeita o papel `ADMIN` mesmo sem esse endpoint existir ainda.
- **`@nestjs/mapped-types` adicionado** para `UpdateDto = PartialType(CreateDto)` — pacote oficial
  do time do NestJS, evita duplicar validadores entre os DTOs de criação e atualização.
- **`class-validator`/`class-transformer` + `ValidationPipe` global habilitados pela primeira vez**
  (`whitelist`, `forbidNonWhitelisted`, `transform`) — a Fase 2 não tinha nenhum endpoint com corpo
  de request que precisasse disso.
- **Um bug real de wiring de módulos só apareceu no teste e2e, não nos testes unitários**: o
  `CourtsModule` não tinha `UsersModule` nos seus imports, então o `ArenaAccessGuard` (que depende
  de `UsersService` transitivamente) falhava ao ser construído pelo container de DI real do Nest —
  os testes unitários (que instanciam classes manualmente, sem o container de DI) não pegam esse
  tipo de erro. Corrigido reexportando `UsersModule` a partir de `ArenaMembersModule`, para que
  qualquer módulo que use `ArenaAccessGuard` ganhe a dependência automaticamente.

## Decisões da Fase 4

- **`Booking`/`BookingType`/`BookingStatus`/`IdempotencyKey` implementados com campos mínimos** —
  sem `arenaId` denormalizado, sem `PENDING`/`EXPIRED`/`COMPLETED` em `BookingStatus` (dependem de
  pagamento, fora de escopo), `total` (não `totalPrice`). Ver `docs/ARCHITECTURE.md` v0.4,
  "Decisões revisadas na v0.4" e Parte 7.
- **`Court.pricePerSlot`/`slotDurationMinutes`/`bufferMinutes` implementados** — os campos que a
  Fase 3 deixou de fora "por não fazerem sentido isolados" chegaram junto com o sistema que os
  consome.
- **Prevenção de double booking em três camadas reais, não simuladas**: `pg_advisory_xact_lock
  (hashtext(courtId))` por quadra (não lock global), pré-checagem via SQL reaproveitando a mesma
  função `booking_occupied_range(...)` da constraint (nunca duas implementações da mesma regra), e
  `EXCLUDE USING GIST` como autoridade final. A constraint exigiu envolver a expressão de buffer
  numa função SQL marcada `IMMUTABLE` — `timestamptz + interval` é `STABLE` no catálogo do Postgres,
  e um índice GiST exige `IMMUTABLE` (migration falhava com `P3006` até essa correção).
- **Violação da EXCLUDE constraint chega como `PrismaClientUnknownRequestError` (SQLSTATE `23P01`
  na mensagem), não como `PrismaClientKnownRequestError` com um P-code** — diferente de unique
  constraints (`P2002`). Prisma não tem código dedicado para exclusion constraints; confirmado
  empiricamente contra o Postgres real antes de escrever o mapeamento de erro.
- **`Idempotency-Key` com estratégia "claim-first", não "claim-last"** — a linha de idempotência é
  reservada (placeholder) **antes** do handler de criação rodar, não depois. Corrigido depois que o
  teste de concorrência real (duas requisições simultâneas com a mesma chave) revelou que
  "claim-last" fazia a segunda requisição, ao ser liberada pelo advisory lock, encontrar a reserva
  que a primeira acabara de commitar e recebê-la como conflito de horário (409) em vez de replicar a
  resposta da vencedora (201). Ver `docs/ARCHITECTURE.md` v0.4, Parte 8.
- **Criar reserva `CUSTOMER` exige só autenticação (`ClerkAuthGuard`), não `ArenaAccessGuard`** —
  decisão confirmada explicitamente antes de implementar (havia ambiguidade real no domínio: o
  papel de "cliente" não existe em `ArenaMember`, só `OWNER`/`ADMIN`; exigir associação
  inviabilizaria a própria funcionalidade). `BLOCK`, `MAINTENANCE` e a listagem administrativa
  continuam exigindo `ArenaAccessGuard` + `@RequireArenaRole(OWNER, ADMIN)`.
- **Disponibilidade em grade fixa de `slotDurationMinutes`, a partir do início da janela
  consultada** — decisão provisória documentada: não existe ainda `CourtOperatingHours`/horário de
  funcionamento por arena para ancorar a grade em um "horário de abertura". Cada slot é avaliado
  contra as reservas existentes com a mesma semântica de conflito (buffer incluso) da criação — o
  buffer de uma reserva bloqueia os slots vizinhos na grade nos dois sentidos (antes e depois), não
  só o seguinte, exatamente como o backend recusaria essas mesmas combinações se alguém tentasse
  criá-las.
- **Listagem de `Booking` com dois `select` do Prisma diferentes** (não o mesmo dado filtrado depois
  em código): a visão pública (`GET .../bookings`) nunca inclui `userId`/`reason`/`total` na própria
  query; a administrativa (`GET .../bookings/admin`, só `OWNER`/`ADMIN`) inclui.
- **Cancelamento é autorização por recurso** (dono da reserva OU `OWNER`/`ADMIN` da arena), não por
  papel estático de rota — não expressável por `@RequireArenaRole`. Resolvido dentro de
  `BookingsService.cancel`, reaproveitando `ArenaMembersService.getRole` (retorna `null` sem lançar
  quando o requisitante não é membro, em vez de `assertAccess`, que lançaria 403). Cancelar uma
  reserva já cancelada é idempotente (retorna 200 sem erro, sem novo UPDATE).
- **Teste de concorrência real obrigatório** (`test/bookings-concurrency.e2e-spec.ts`), via
  `Promise.all` contra o servidor Nest real e o Postgres real do Docker Compose — nunca mockado.
  Confirma: mesma quadra + mesmo horário → exatamente 1 sucesso e 1 conflito (repetido 8x); quadras
  diferentes + mesmo horário → as duas sucedem (lock não é global); mesma `Idempotency-Key`
  disparada 2x → nunca cria dois `Booking`s. Foi esse teste que revelou o bug do "claim-last"
  descrito acima — só apareceu sob concorrência real, não nos testes unitários (que mockam o Prisma)
  nem nos e2e sequenciais.

## Decisões da Fase 5

- **`Arena.timezone` obrigatório na criação, com default no banco só para backfill** — arenas
  existentes (Fases 1-4) ganharam `'America/Sao_Paulo'` automaticamente na migration (sem
  intervenção manual); toda arena nova precisa declarar o timezone explicitamente
  (`CreateArenaDto.timezone`, validado contra `Intl.supportedValuesOf('timeZone')` — nunca offset
  solto tipo `"-03:00"` ou sigla tipo `"GMT-3"`). Alterar o timezone depois é permitido via `PATCH`
  normal — análise de impacto mostrou que não corrompe nada: `Booking.startsAt`/`endsAt` são
  instantes absolutos, nunca reinterpretados; só a leitura de `ArenaOperatingHours` (armazenado em
  minutos locais) passa a usar o novo timezone dali em diante.
- **`ArenaOperatingHours` pertence à Arena, não à Court** — todas as quadras de uma arena
  compartilham o mesmo horário de funcionamento (decisão análoga à do timezone); modelar por quadra
  duplicaria configuração sem necessidade real hoje. `opensAt`/`closesAt` são `Int` (minutos desde
  a meia-noite local), não `@db.Time` do Postgres nem timestamp — mesmo padrão de
  `bufferMinutes`/`slotDurationMinutes` em `Court`.
- **Overnight (intervalo atravessando a meia-noite, ex: `22:00→02:00`) não é suportado nesta fase**
  — decisão explícita pela alternativa mais simples entre as cogitadas; todo intervalo precisa
  caber no mesmo dia civil local (`closesAt > opensAt`, sempre). Sem representação de "24 horas"
  (não necessária ainda).
- **Sem `EXCLUDE USING GIST` para `ArenaOperatingHours`** (diferente de `Booking`) — o risco de
  concorrência aqui é baixo (só `OWNER`/`ADMIN` escreve, baixa frequência, sem disputa
  cliente-a-cliente), então `btree_gist`/`tsrange` seria desproporcional. Validação de
  sobreposição/intervalo inválido em código; atualização atômica via transação (substituição
  completa: apaga tudo e recria), não via constraint.
- **Arena nova nasce sem nenhum horário configurado — fechada todo dia por padrão.** Decisão
  deliberada para nunca inventar disponibilidade comercial arbitrária; o admin precisa configurar
  explicitamente via `PUT .../operating-hours` antes de qualquer slot aparecer como disponível.
- **Luxon adicionado como dependência real** (não `date-fns-tz`/`moment-timezone`) — toda conversão
  local↔instante passa por `DateTime.fromObject({...}, {zone}).toUTC()`/
  `DateTime.fromJSDate(instant, {zone})`, nunca aritmética manual de offset. Testado explicitamente
  com `America/New_York` (tem DST) para provar que não há offset fixo escondido em lugar nenhum,
  mesmo o produto hoje só usando `America/Sao_Paulo` (sem DST).
- **Disponibilidade deixou de ser uma grade matemática ancorada em `from`** (decisão provisória da
  Fase 4) — os slots agora são gerados a partir do horário de ABERTURA de cada intervalo configurado
  (nunca do `from` da query), no timezone da arena, e nunca fora do horário de funcionamento. O
  buffer também precisa caber antes do fechamento (não só antes do próximo slot nominal) — a mesma
  função (`intervalContains`) usada pela disponibilidade também é usada por `BookingsService` para
  validar a criação, nunca duas implementações da mesma regra.
- **Criação de `CUSTOMER` valida horário de funcionamento; `BLOCK`/`MAINTENANCE` não são
  restringidos por ele** — decisão documentada: bloqueio/manutenção são operações administrativas
  (podem representar evento fora do expediente normal, ou manutenção de madrugada), mesmo padrão já
  usado para buffer=0 administrativo na Fase 4.
- **Alterar horário de funcionamento (ou timezone) nunca apaga/recalcula `Booking`s existentes** —
  só a disponibilidade futura e novas criações passam a refletir a configuração atual. Testado
  explicitamente em e2e (cria reserva → estreita o horário → reserva antiga continua `CONFIRMED`,
  nova tentativa no mesmo horário é rejeitada).
- **Resposta de `GET .../availability` virou um objeto** (`{ courtId, timezone, from, to, slots }`),
  não mais um array solto — mudança de contrato justificada e sem custo real (nenhum cliente
  frontend consome esse endpoint ainda).
- **`GET .../operating-hours` não exige `ArenaMember`** (só autenticação) — mesmo padrão já usado
  para disponibilidade/`CUSTOMER` na Fase 4: saber quando a arena abre é informação pública por
  natureza. `PUT` continua exigindo `OWNER`/`ADMIN`.
- **Teste de concorrência real entre `PUT operating-hours` e criação de `Booking`** (item 45 do
  prompt da fase) — as duas transações não compartilham lock (rodam de fato em paralelo);
  confirmado via `Promise.all` contra o servidor real que nunca existe estado parcial (a config
  final é sempre a última substituição completa, nunca uma mistura) e a criação de `Booking`
  sempre responde `201` ou `409`, nunca um erro cru.

## Decisões da Fase 6

- **CORS habilitado na API** (`app.enableCors`, origem = `WEB_APP_URL`) — gap real: nenhuma chamada
  `fetch` do browser teria funcionado antes disso. Sem `credentials` (a API só usa Bearer token do
  Clerk, nunca cookie).
- **Descoberta pública de arenas em endpoints novos** (`GET /v1/arenas/discover...`), separados de
  `GET /v1/arenas` — que **continua** significando "minhas arenas administradas" (Fase 3), não foi
  ressemantizado. Descoberta exige só autenticação (`ClerkAuthGuard`), nunca `ArenaMember`; nunca
  retorna `members`/`role`; só lista quadras ativas. Registrados antes de `GET /v1/arenas/:arenaId`
  na ordem de rotas (senão o Nest capturaria `discover` como se fosse um `:arenaId`).
- **"Minhas reservas" em endpoint novo** (`GET /v1/users/me/bookings...`), não uma listagem
  administrativa reaproveitada — filtra `userId = chamador` **e** `type = CUSTOMER` no próprio
  `WHERE` do Prisma (nunca busca tudo e filtra depois). O filtro por `type` é essencial: `BLOCK`/
  `MAINTENANCE` também têm `userId` preenchido (o admin que criou), e sem esse filtro apareceriam
  nas "reservas" do próprio admin — testado explicitamente em e2e. Detalhe de reserva de outro
  usuário retorna `404` (nunca `403`), mesmo padrão de privacidade já usado desde a Fase 3.
- **Nenhum endpoint novo de cancelamento** — "minhas reservas" reaproveita a rota já existente desde
  a Fase 4, usando `arenaId`/`courtId` vindos da própria resposta.
- **Índice `Booking(userId)` adicionado** — a Fase 4 já havia previsto esse índice como "eventual";
  "minhas reservas" é o primeiro caso de uso real que filtra por ele. Migration isolada, não altera
  nenhuma migration anterior.
- **`luxon` e `@tanstack/react-query` adicionados a `apps/web`** — Luxon por reaproveitar a mesma
  biblioteca de timezone já usada no backend desde a Fase 5 (nunca `toLocaleString()` cru, nunca
  assumir que o timezone do navegador é o da arena); TanStack Query porque o requisito real é
  invalidação de cache após reserva/cancelamento, não uma segunda biblioteca de estado global.
  Seleção de data usa `<input type="date">` nativo (sem novo componente de calendário).
- **`Idempotency-Key` gerada no cliente e reaproveitada em retries da mesma tentativa lógica** (mesmo
  horário selecionado) — nunca uma chave nova por clique; regenerada só quando a seleção muda.
  Reaproveita a infraestrutura "claim-first" da Fase 4/5 sem alterá-la. Um `409` limpa a seleção,
  mostra mensagem amigável e força novo `GET .../availability`.
- **Sem testes de browser E2E (Playwright) nesta fase** — mesma decisão da Fase 2 (não há conta
  Clerk real disponível neste ambiente para autenticar uma sessão de browser ponta a ponta).
  Cobertura via Jest + React Testing Library no frontend (mockando os hooks de dados) e e2e contra
  Postgres real no backend, como nas fases anteriores.

## Decisões da Fase 7

- **`GET /v1/arenas/:arenaId/dashboard?date=YYYY-MM-DD` — uma única consulta de `Booking` cruzando
  todas as quadras da arena** (`court: { arenaId }`), nunca uma consulta por quadra. `date` é
  opcional: quando omitida, o backend resolve "hoje no timezone da arena" (nunca o frontend, nunca
  o timezone do servidor).
- **Não é um segundo domínio** — o Dashboard só reorganiza Arena/Court/ArenaOperatingHours/Booking
  já existentes. Disponibilidade continua exclusiva do `AvailabilityService` (Fase 5); criação de
  `Booking` continua exclusiva do `BookingsService` (Fase 4). "Ocupação por quadra" no Dashboard é
  a lista real de reservas `CONFIRMED` do dia (uma timeline), não um grid sintético de slots — evita
  duplicar o algoritmo de geração de slots.
- **`GET /v1/arenas` (Fase 3) reaproveitado como fonte de "minhas arenas administradas"** para o
  seletor de arena — nenhum endpoint novo para isso, contrato existente inalterado.
- **Nenhum endpoint novo de escrita** — quadras, horário de funcionamento e configurações da arena
  no Dashboard consomem exclusivamente `PATCH`/`PUT` já existentes desde as Fases 3 e 5.
- **Segurança 100% reaproveitada**: `ArenaAccessGuard` + `@RequireArenaRole()` sem nenhuma
  modificação. Como `ArenaRole` só tem `OWNER`/`ADMIN` e `CUSTOMER` nunca é `ArenaMember`,
  `@RequireArenaRole()` vazio já basta para excluir `CUSTOMER` automaticamente.
- **Escopo deliberadamente menor que a visão original do roadmap** — sem gestão de funcionários,
  sem faturamento/relatório financeiro, sem papel `STAFF`, sem criação de `BLOCK`/`MAINTENANCE`
  pela UI (só visualização) — nada disso existe no domínio ainda nem foi pedido nesta fase.
- **Timezone da arena no formulário de configurações via `Intl.supportedValuesOf('timeZone')`**
  (nativo do runtime) — mesma fonte de verdade que o validador `IsIanaTimezone` do backend (Fase
  5), nunca um catálogo próprio.
- **Primeiro editor de horário de funcionamento do produto** — a Fase 5 só expunha a API; o
  formulário reflete 1:1 o mesmo modelo (múltiplos intervalos por dia, `HH:mm`, overnight não
  suportado), sem inventar uma segunda representação.

## Decisões da Fase 8

- **Zero funcionalidade de negócio nova** — a fase inteira foi auditoria, testes adversariais e
  correção de bugs reais, conforme pedido ("menos código novo é melhor").
- **Cache do TanStack Query limpo no logout/troca de conta** (`ClearQueryCacheOnUserChange` em
  `apps/web/src/lib/query-client.tsx`) — bug real: o `<UserButton/>` do Clerk desloga sem recarregar
  a página, então sem essa limpeza o `QueryClient` (uma instância por sessão do app) mantinha dados
  do usuário anterior em memória até o próximo refetch.
- **`AvailabilityService.buildSlots` corrigido para usar `.set({hour, minute})` em vez de
  `.plus({minutes})`** ao construir o instante de cada slot — `.plus()` soma duração absoluta, que
  cruza a transição de DST deslocando o horário de parede em 1h no dia da troca (provado com
  `America/New_York`, 8/mar/2026). Não afeta `America/Sao_Paulo` hoje, mas era um bug real.
- **Nova suíte `hardening.e2e-spec.ts` (21 testes)**: mass assignment em todo endpoint de escrita,
  IDOR sistemático entre duas arenas em 7 rotas administrativas, semântica de `@RequireArenaRole()`
  vazio, isolamento de `Idempotency-Key` (entre usuários, entre endpoints, após falha genuína) —
  todos passaram de primeira, confirmando que as proteções das Fases 3-5 já estavam corretas.
- **Webhook do Clerk confirmado idempotente** para reentrega (retry) e para `user.updated` sobre
  usuário já existente — dois testes novos em `auth-flow.e2e-spec.ts`; nenhuma mudança de código
  (`syncFromClerkEvent` já usava `upsert`/`deleteMany`).
- **Playwright avaliado e descartado de novo, com a limitação documentada** — sem conta Clerk real
  neste ambiente, uma suíte Playwright não autenticaria uma sessão de browser de verdade; criar uma
  mesmo assim seria falsa cobertura. Mesma decisão da Fase 2.
- **Nenhuma migration nova** — cascades, constraints e índices críticos foram reauditados e
  conferidos corretos, sem necessidade de alteração de schema.
- **Nenhuma dependência nova, nenhuma atualizada** — inclusive um aviso de atualização major do
  Prisma (6.19.3 → 7.9.1) apareceu durante a validação de migration em banco limpo e foi
  deliberadamente ignorado (não é uma vulnerabilidade, só uma versão nova disponível).

## Decisões da Fase 9

- **`apps/api/Dockerfile` construído e rodado de verdade** (não só escrito) contra o Postgres
  local — ver `docs/DEPLOYMENT.md`, seção "Docker", para os 5 bugs reais de build/runtime
  encontrados e corrigidos só ao efetivamente rodar a imagem (nenhum visível por inspeção).
  Destaque: **`pnpm start:prod` nunca funcionou desde que foi criado** (`dist/main.js` não existe;
  o caminho real é `dist/src/main.js`) — corrigido junto.
- **`GET /v1/health` (liveness) e `GET /v1/health/ready` (readiness, checa o Postgres de
  verdade)** substituem o health check único de antes. Liveness nunca depende do banco.
- **`app.enableShutdownHooks()` adicionado** — sem ele, `SIGTERM` nunca acionava
  `PrismaService.onModuleDestroy()`. Bookings em andamento não dependiam disso pra estarem seguros
  (advisory lock é do Postgres), mas o shutdown agora é limpo de verdade.
- **Validação de env obrigatória no boot** (`assertRequiredEnv()`) — falha rápido com mensagem
  clara, nunca vaza valor de variável.
- **Redis confirmado não usado por nenhum código** — `Booking`/idempotência continuam 100%
  PostgreSQL; não provisionado para este deploy, mesmo estando no `docker-compose.yml` desde a
  Fase 1 (reservado só para quando BullMQ chegar, Fase 12).
- **Headers de segurança no frontend** (`X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, `Strict-Transport-Security`) — testados contra `next start` local real. CSP
  deliberadamente não adicionado (sem como testar contra domínio real com Clerk ativo).
- **Railway escolhido como plataforma do backend** (entre Railway/Render/Fly.io) — na tentativa
  real de criar o projeto, o Railway exigiu o **Hobby plan (US$5/mês)**, sem free tier real hoje
  (a informação anterior neste documento, de que não exigia plano pago, estava desatualizada —
  corrigida em `docs/DEPLOYMENT.md`). Decisão consciente de **pausar o deploy antes de gastar**;
  Render é a alternativa mais próxima (free tier, troca mecânica) se o custo do Railway não for
  viável no futuro.
- **Repositório publicado no GitHub e CI validado contra um runner real** — primeiro commit e
  primeiro `git push` da história do projeto (`github.com/fraagelo/arenahub`). A primeira execução
  do CI **falhou de verdade**: o placeholder `CLERK_WEBHOOK_SIGNING_SECRET` do workflow
  (`whsec_ci_test_...`) não é base64 válido para a lib `standardwebhooks` (que decodifica tudo após
  `whsec_` como base64 puro) — só "funcionava" localmente porque o `.env` real não versionado usa
  outro valor. Corrigido para `whsec_` + base64 puro; revalidado localmente contra um Postgres
  novo (mesmos passos do CI: migrate deploy + test:e2e + build, 133/133 testes) antes do push da
  correção. CI verde na segunda execução — ver `.github/workflows/ci.yml`.
- **Deploy real ainda não foi executado**: Railway **BLOQUEADO POR CUSTO** (acesso existe, gasto
  recorrente não autorizado); Vercel e Clerk produção **BLOQUEADO POR INFRAESTRUTURA** (sem
  conta/ambiente criado neste ambiente). `docs/DEPLOYMENT.md` documenta exatamente o que é
  IMPLEMENTADO/TESTADO vs. cada tipo de bloqueio, sem inventar deploy que não aconteceu.

## Decisões da Fase 10

- **Gestão de membros implementada sobre o `ArenaMembersModule` já existente** — nenhum módulo
  novo. `GET/POST/PATCH/DELETE /v1/arenas/:arenaId/members`, reaproveitando
  `ArenaAccessGuard`/`RequireArenaRole` sem modificação.
- **"No máximo um OWNER por arena" passou a ser garantido pelo Postgres**, via índice único parcial
  (`ArenaMember_arenaId_single_owner`, `WHERE role = 'OWNER'` — Prisma não expressa índice parcial
  no schema, migration SQL manual). Achado real: a migration falhou na primeira tentativa contra o
  banco de dev, que já tinha dois OWNER na mesma arena — corrigido nos dados antes de reaplicar.
- **Adicionar membro identifica por e-mail, não `userId`** — evita criar qualquer endpoint de
  busca/enumeração de usuários; é um lookup exato dentro do próprio `POST`, gated pela autorização
  de OWNER já existente.
- **Interpretação registrada**: o prompt pedia "DELETE só OWNER" e "ADMIN remove a si mesmo"
  simultaneamente — logicamente incompatíveis como guard único. Resolvido com guard permissivo
  (qualquer membro) + regra fina no service (OWNER remove qualquer ADMIN; ADMIN só remove a si
  mesmo; OWNER nunca é removível). Detalhado em `docs/ARCHITECTURE.md`, Fase 10.
- **Nova página `/dashboard/[arenaId]/equipe`** — OWNER em destaque, ADMIN em lista com badge,
  adicionar via dialog (e-mail), remover via `AlertDialog` de confirmação. Backend continua a
  única autoridade: um ADMIN nunca vê os botões de gerenciar equipe, mas o backend bloquearia a
  ação de qualquer forma.
- **STAFF, convite por e-mail e transferência de ownership deliberadamente não implementados** —
  fora de escopo desta fase, documentado explicitamente (não silenciado).
- **Roadmap renumerado**: "Fase 10 — IA" do roadmap original virou Fase 11; WhatsApp e Pagamentos
  deslocados para Fases 12 e 13. Ver `docs/ARCHITECTURE.md`.

## Decisões da Fase 11

- **Convites (`ArenaInvitation`) são um módulo novo** (`InvitationsModule`); **transferência de
  ownership** foi adicionada ao `ArenaMembersModule` já existente (opera direto sobre `ArenaMember`,
  não é uma entidade própria). `GET/POST /v1/arenas/:arenaId/invitations`,
  `DELETE .../:invitationId`, `POST .../:invitationId/resend` (todos `OWNER`-only); rota pública
  `GET /v1/invitations/:token` (sem guard — precisa ser vista antes do login) e
  `POST /v1/invitations/:token/accept` (só `ClerkAuthGuard`); `POST
  /v1/arenas/:arenaId/ownership/transfer` (`OWNER`-only, nunca implícito via `PATCH /members`).
- **Token de convite: só o hash é persistido.** `crypto.randomBytes(32)` (256 bits, base64url) é o
  token enviado por "e-mail"; o banco só guarda `sha256(token)`. Nenhuma resposta de API devolve o
  token puro — a única forma de obtê-lo é o e-mail em si (em dev, o log do
  `ConsoleInvitationEmailService`). Expira em 7 dias por padrão (`INVITATION_EXPIRES_DAYS`,
  opcional).
- **Status do convite é sempre derivado** (`PENDING`/`ACCEPTED`/`REVOKED`/`EXPIRED`, calculado de
  `acceptedAt`/`revokedAt`/`expiresAt` em tempo de leitura) — nunca uma coluna de enum própria que
  pudesse dessincronizar.
- **Identidade de quem aceita vem do `User.email` local já sincronizado do Clerk**, nunca de um
  campo enviado pelo cliente — fecha a porta para aceitar um convite alegando ser outro e-mail.
- **Aceite e transferência são atômicos via `updateMany` condicional + checagem de `count`** (não
  lock pessimista) — validado com testes reais de concorrência (`Promise.all` de duas requisições
  HTTP simultâneas contra Postgres real): aceite duplicado do mesmo convite dá `[204, 409]` com
  exatamente 1 `ArenaMember` criado; transferência concorrente dá `[201, 403]` com exatamente 1
  `OWNER` no estado final.
- **Envio de e-mail é uma abstração** (`InvitationEmailService`) com um único adapter de
  desenvolvimento (`ConsoleInvitationEmailService`, loga o link) — **nenhum provedor real** (SendGrid/
  Postmark/SES) foi integrado nesta fase; ver `docs/DEPLOYMENT.md`.
- **Rate limiting em criação/reenvio de convite não foi implementado** — um contador em memória seria
  descartado a cada redeploy (falso senso de proteção); registrado como limitação real, não fingido.
- **STAFF, permissões granulares, Payment, WhatsApp, IA, reservas recorrentes e notificações gerais
  continuam fora de escopo** — não implementados nesta fase.
- **Roadmap renumerado de novo**: "Fase 11 — IA" do roadmap anterior virou Fase 12; WhatsApp e
  Pagamentos deslocados para Fases 13 e 14. Ver `docs/ARCHITECTURE.md`.

## Decisões da Fase 12

- **Escopo redefinido em relação ao roadmap anterior**: a v0.11 previa um agente com tools de
  escrita (criar/cancelar reserva). O prompt desta fase pediu, em vez disso, um assistente
  deliberadamente **só leitura/análise** — a capacidade de agir continua só prevista (Parte 3 do
  `ARCHITECTURE.md`), sem fase numerada até ser retomada.
- **Novo módulo `AiModule`** — `POST /v1/arenas/:arenaId/ai/ask` (`OWNER`/`ADMIN`-only, explícito
  via `@RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)`), reaproveitando `ClerkAuthGuard`/
  `ArenaAccessGuard` sem modificação.
- **`OperationalMetricsService` calcula tudo no Postgres** — reservas confirmadas/canceladas,
  BLOCK, MAINTENANCE, receita estimada (só `CUSTOMER`+`CONFIRMED`), ocupação por quadra/arena
  (minutos ocupados ÷ minutos operacionais, `null` quando não há horário configurado), demanda por
  hora/dia, comparação com o período anterior (deltas prontos, `null` nunca `0` forjado). A IA
  nunca calcula essas contas sozinha a partir de texto.
- **A IA nunca acessa o banco direto nem gera SQL** — só um contexto estruturado (JSON) sem PII
  (nome/e-mail/telefone/ClerkId) e sem IDs internos (`cuid`) é enviado ao modelo.
- **Provider: OpenAI (`gpt-4o-mini`)**, decidido em conjunto com o usuário durante a fase (nenhuma
  decisão firme preexistia). `AiProvider` é uma abstração — trocar de provider é só trocar o
  `useClass` registrado em `AiModule`. `fetch` nativo do Node 24, sem SDK novo.
- **`AI_PROVIDER_API_KEY` nunca chega ao frontend nem é logada** — sem ela, o endpoint responde 503
  (nunca derruba o resto da API: não está em `REQUIRED_ENV_VARS`).
- **Prompt injection: provado estruturalmente, não semanticamente.** Testes confirmam que o
  contexto nunca vaza dado de outra arena e que o system prompt sempre carrega as regras de defesa
  — mas nenhuma chamada real à OpenAI foi feita neste ambiente (sem credencial), então a resistência
  *semântica* de um modelo real não foi validada. Testes e2e usam um `AiProvider` fake (só teste,
  nunca produção).
- **Sem rate limiting persistente e sem histórico de conversa persistido** — mesma decisão e mesmo
  motivo da Fase 11 (convites): implementação frágil em memória seria pior que documentar a
  limitação. Mitigado parcialmente por limite de tamanho de pergunta (500 caracteres) e de período
  (máximo 92 dias).
- **Nenhuma migration nova** — todas as métricas vêm de tabelas já existentes (`Booking`, `Court`,
  `ArenaOperatingHours`, `Arena`).
- **STAFF, WhatsApp, agente autônomo, tools de escrita, RAG/embeddings, voz/imagem, Payment
  continuam fora de escopo** — não implementados nesta fase.

## Decisões da Fase 13

- **Auditoria como entrega principal**: quase todo o ciclo de vida da reserva do CUSTOMER pedido
  nesta fase (listar "minhas reservas", ver detalhe, cancelar quando permitido, nunca precisar ser
  `ArenaMember`, identidade sempre do Clerk, `404` em vez de `403` pra não vazar existência) já
  existia, correto, desde a Fase 6 — nada foi reescrito.
- **Única correção de código**: `BookingsService.cancel` ganhou proteção real contra corrida
  concorrente — `update` incondicional virou `updateMany` condicionado a `status: CONFIRMED` (CAS,
  mesmo padrão da Fase 11), validado com duas requisições de cancelamento simultâneas reais.
- **Cancelamento não usa `Idempotency-Key`** (decisão explícita) — diferente da criação, cancelar
  já converge pro mesmo estado terminal por natureza da máquina de estados; exigir o header aqui
  seria uma restrição nova sem proteger contra nada que o CAS já não resolvesse.
- **Sem prazo/janela de cancelamento** — decisão já registrada na Fase 6, reafirmada aqui, não
  inventada agora.
- **Novo teste prova a integração real** entre o ciclo de vida da reserva e as métricas da Fase 12:
  cancelar de verdade (pelos endpoints reais) remove a reserva da receita/ocupação vistas pela IA.
- **Nenhuma migration nova, nenhuma alteração de frontend** — `/minhas-reservas` já cumpria 100%
  dos requisitos desde a Fase 6.
- **Roadmap renumerado**: "Fase 13 — WhatsApp" do roadmap anterior virou Fase 14; Pagamentos
  deslocado para Fase 15.

## Decisões da Fase 14

- **"Cliente da arena" é uma visão derivada, nunca uma entidade nova** — usuário com pelo menos uma
  `Booking` `type=CUSTOMER` numa quadra da arena. Sem migration; calculado em tempo de leitura, a
  mesma técnica já usada para `ArenaInvitation` (Fase 11) e para as métricas da IA (Fase 12).
- **Três endpoints novos, todos só leitura**, módulo `CustomersModule`: `GET
  /v1/arenas/:arenaId/customers` (lista, busca por nome/e-mail, paginação `page`/`limit` com teto
  de 50), `GET .../customers/:userId` (resumo agregado), `GET .../customers/:userId/bookings`
  (histórico). Todos `OWNER`/`ADMIN`-only, reaproveitando os guards existentes sem modificação.
- **Isolamento por arena absoluto**: um mesmo cliente com reservas em duas arenas tem métricas
  calculadas de forma totalmente independente em cada uma — validado com um cliente real em duas
  arenas diferentes.
- **Receita segue exatamente a regra da Fase 12** — só `CUSTOMER`+`CONFIRMED`; `CANCELLED` entra no
  total de reservas, nunca na receita.
- **Sem N+1**: listagem via `groupBy` (agregação no Postgres) em no máximo duas chamadas, sempre
  delimitadas pela página atual — nunca uma query por cliente.
- **PII minimizada**: só nome/e-mail são retornados — nunca `clerkId`, nunca telefone.
- **Primeira paginação da API** (`page`/`limit`) — decisão nova, documentada por não haver padrão
  anterior no projeto.
- **Nenhuma migration nova** — índices existentes de `Booking` (`courtId`, `userId`) já atendem.
- **IA da Fase 12 permanece inalterada** — nenhuma pergunta específica de cliente foi adicionada.
- **Marketing, campanhas, cupons, WhatsApp, notificações, pagamentos e CRM avançado continuam fora
  de escopo** — não implementados nesta fase.

## Decisões da Fase 15

- **Fonte única de verdade, literal**: `ReportsModule` importa `AiModule` e reaproveita a MESMA
  instância de `OperationalMetricsService` (exportada de lá especificamente para isso) — não uma
  segunda implementação de receita/ocupação/demanda/comparação. `ReportsService` só resolve o
  período, chama `getMetrics()`/`buildComparison()` e reformata o resultado.
- **Uma capacidade nova em `OperationalMetricsService`, não duplicada**: série diária
  (`dailySeries`) — os mesmos números do resumo, quebrados por dia civil da arena.
  `operationalMinutes()` da Fase 12 foi refatorado pra reaproveitar um novo
  `operationalMinutesByDay()`, nunca um segundo cálculo coexistindo com o original.
- **Dois presets de período novos**: `thisMonth`/`lastMonth`, no mesmo `resolvePeriod` central da
  Fase 12 — os presets existentes mantêm o mesmo comportamento.
- **Novo delta de comparação**: `cancelledBookingsDeltaPct`, mesma função `percentDelta` dos
  outros três (`null`, nunca `0` ou `Infinity`, quando o período anterior teve zero cancelamentos).
- **Disciplina null vs. zero estendida à série diária** — um dia sem horário de funcionamento
  configurado tem `occupancyRate: null` só naquele ponto, nunca `0%` forjado.
- **Um endpoint novo, só leitura**: `GET /v1/arenas/:arenaId/reports`, `OWNER`/`ADMIN`-only,
  reaproveitando os guards existentes sem modificação.
- **Nenhuma migration nova** — a fase não introduz nenhuma query nova, reaproveita literalmente a
  mesma `getMetrics()` já auditada nas Fases 12-14.
- **Sem lib de gráficos nova**: visualizações em SVG/CSS simples e decorativas (`aria-hidden`),
  sempre com uma tabela textual equivalente ao lado — justificado pelo baixo volume de dados (no
  máximo 92 pontos por série) e por evitar uma dependência nova só para poucas barras.
- **Exportação, agendamento de envio, dashboards customizáveis, BI avançado, forecasting e
  comparação entre arenas continuam fora de escopo** — não implementados nesta fase.
- **Roadmap renumerado**: "Fase 15 — WhatsApp" do roadmap anterior virou Fase 16; Pagamentos
  deslocado para Fase 17.

## Decisões da Fase 16

- **WhatsApp é só mais um canal de entrada, nunca uma segunda implementação do domínio** —
  `WhatsAppModule` reaproveita literalmente `BookingsService` (mesmo lock/EXCLUDE constraint/CAS da
  Fase 4/13), `AvailabilityService`, `ArenasService.discoverOne` e `AiProvider` (exportado de
  `AiModule`, Fase 12).
- **A IA só classifica intenção, nunca responde ao cliente** — a única saída do modelo é um JSON
  fechado, validado contra um schema fixo. Todo texto que o cliente recebe vem de templates
  centralizados. Mesmo um modelo manipulado por prompt injection só produz `UNKNOWN`; `arenaId`/
  `userId`/preço nunca são enviados ao nem lidos do modelo.
- **Datas/horários nunca calculados pelo modelo** — o LLM extrai só a frase bruta; a aritmética é
  determinística (`nlp.util.ts`). A maior parte da conversa (seleção numérica, confirmação) nunca
  chama o modelo.
- **Identidade do cliente reaproveita `User.phone`** (já sincronizado do Clerk desde a Fase 2, agora
  `@unique`) — nenhuma identidade paralela. Identidade da arena via `Arena.whatsappPhoneNumberId`
  (novo campo, `phone_number_id` estável da Meta, nunca comparação de telefone).
- **Estado da conversa é autoridade do backend** (`WhatsAppConversation`, nova model) — confirmação
  explícita e exata (nunca match parcial), com TTL de 15 minutos.
- **Idempotência em duas camadas**: dedup de evento do webhook (`WhatsAppEvent`, nova model) +
  `Idempotency-Key` já existente na criação de reserva.
- **Concorrência real validada**: dois clientes confirmando o mesmo horário simultaneamente —
  exatamente uma reserva é criada, protegida pela mesma EXCLUDE constraint da Fase 4.
- **Duas migrations novas**: `WhatsAppConversation`/`WhatsAppEvent` + `Arena.whatsappPhoneNumberId` +
  `User.phone` (`@unique`).
- **Nenhuma integração real validada** — sem credenciais de produção da Meta neste ambiente,
  testado com providers fake. Ver `docs/DEPLOYMENT.md`.
- **Pagamentos, PIX, cartão, marketplace, campanhas, CRM, voz, imagem e comandos administrativos
  pelo WhatsApp continuam fora de escopo** — não implementados nesta fase.

## Decisões da Fase 17

- **Booking e Payment são conceitos diferentes** — `Booking.status` continua só `CONFIRMED`/
  `CANCELLED` (ocupação da quadra, Fase 4, intocado); `Payment.status` é um ciclo financeiro à
  parte (`PENDING`/`PAID`/`FAILED`/`EXPIRED`/`CANCELLED`). Desvio deliberado do placeholder
  original desta fase (que previa hold via `BookingStatus`), registrado explicitamente.
- **Valor sempre do backend** — `Payment.amount` é copiado de `Booking.total` (já congelado desde a
  Fase 4); o endpoint de criação nem aceita `amount`/`status`/`currency` do cliente.
- **Cardinalidade 1—N tentativas, no máximo 1 `PAID`** — garantido por um índice único parcial
  (`Payment_bookingId_single_paid`), mesma técnica do único-OWNER de arena (Fase 10). Evolui a
  sugestão original de 1—1.
- **Máquina de estados com um único estado não-terminal** (`PENDING`) — CAS condicionado a
  `status: PENDING` (mesmo padrão do CAS de cancelamento, Fase 13) impede que qualquer evento
  posterior reverta um estado já definitivo.
- **Idempotência sem mecanismo novo** — mesma técnica "claim-first" de `IdempotencyKey`/
  `WhatsAppEvent`, aplicada à própria tabela `Payment`. A chamada ao gateway acontece FORA de
  qualquer transação Prisma (nunca finge que Postgres torna uma chamada HTTP externa atômica).
- **Webhook nunca confia no próprio corpo** — sempre busca o status real de volta no provider antes
  de aplicar qualquer transição.
- **Integração com cancelamento**: Booking cancelada com Payment `PENDING` faz uma confirmação
  `PAID` posterior virar `CANCELLED`, nunca `PAID`. Nenhum refund foi implementado.
- **Gateway escolhido: Mercado Pago (PIX)** — sandbox sem CNPJ, webhook HMAC compatível com o
  padrão já usado por Clerk/WhatsApp. Nenhuma integração real validada nesta fase — testado com
  `FakePaymentProvider`.
- **WhatsApp/IA nunca escrevem em `Payment`** — nenhuma intenção de pagamento foi adicionada ao
  classificador do WhatsApp.
- **Marketplace/split, assinatura recorrente, cartão armazenado, refund e pagamento completo pelo
  WhatsApp continuam fora de escopo** — não implementados nesta fase.

## Decisões da Fase 18

- **Rate limiting pela primeira vez no produto** (`@nestjs/throttler`, em memória, por instância) —
  limite padrão global (300/min por IP+rota, configurável) + limites dedicados fixos no código nos
  endpoints mais sensíveis a abuso (IA, pagamentos, convites, reservas, disponibilidade, clientes,
  relatórios). Webhooks e health check nunca são limitados por IP — assinatura + deduplicação já
  garantem autenticidade. Decisão explícita de não introduzir Redis só para isto — limitação "em
  memória, não distribuído" documentada, não escondida.
- **Correlation ID sem dependência nova** — `X-Request-Id` gerado ou ecoado (só se já seguro para
  log), propagado a qualquer service via `AsyncLocalStorage` nativo do Node. Nunca usado para
  autenticação.
- **Filtro global de exceções** — rede de segurança (nunca a primeira linha de defesa) que garante
  que nenhum erro não previsto vaza stack trace/mensagem interna do Prisma; `HttpException`s já
  intencionais passam inalteradas.
- **`WEB_APP_URL` obrigatória em produção** — a API se recusa a subir em produção sem ela, em vez de
  herdar silenciosamente o default de desenvolvimento.
- **Security headers no backend via `helmet`** — registrado duas vezes deliberadamente (módulo +
  `main.ts`) porque o CORS finaliza sozinho requisições de preflight antes de qualquer middleware de
  módulo alcançá-las (achado real desta fase).
- **Docker HEALTHCHECK nativo**, validado de verdade: imagem construída, container rodando contra
  Postgres real, `docker inspect` confirmando `"healthy"`.
- **Nenhuma funcionalidade de produto nova, nenhum deploy real, nenhuma credencial real criada** —
  auditoria e hardening, não expansão de escopo.

## Git

- Branch principal: `main`.
- Trabalho novo em branches `feat/<escopo>`, `fix/<escopo>`, `chore/<escopo>`.
- Commits seguem [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `chore:`, `test:`, `docs:`...).
- Pull requests para `main` disparam o workflow de CI (`.github/workflows/ci.yml`): install, lint,
  typecheck, test (unit), migrations do Prisma contra um Postgres real do CI, test (e2e da API),
  build. PRs só devem ser mergeados com CI verde.
