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
> → editar horário de funcionamento, quadras e configurações. A experiência do cliente (Fase 6)
> segue: login (Clerk) → descobrir arenas → escolher quadra → escolher data → ver disponibilidade
> real → escolher horário → confirmar → "minhas reservas" → cancelar. Backend continua a única
> autoridade em tudo — disponibilidade, preço, dono da reserva, acesso administrativo. Double
> booking continua prevenido em camadas reais no Postgres (`pg_advisory_xact_lock` +
> `EXCLUDE USING GIST`) com `Idempotency-Key` persistida — inteiramente PostgreSQL, sem depender de
> Redis. Pagamentos ainda não foram implementados.

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

## Git

- Branch principal: `main`.
- Trabalho novo em branches `feat/<escopo>`, `fix/<escopo>`, `chore/<escopo>`.
- Commits seguem [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `chore:`, `test:`, `docs:`...).
- Pull requests para `main` disparam o workflow de CI (`.github/workflows/ci.yml`): install, lint,
  typecheck, test (unit), migrations do Prisma contra um Postgres real do CI, test (e2e da API),
  build. PRs só devem ser mergeados com CI verde.
