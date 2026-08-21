# ArenaHub — Deploy e Infraestrutura de Produção

> Companheiro de `docs/ARCHITECTURE.md` (v0.9) — este documento é operacional
> (como implantar e operar), não arquitetural (por que o sistema é como é).
>
> **Status honesto desta fase**: tudo que podia ser preparado e validado
> *dentro deste repositório* foi preparado e validado de verdade (build real
> da imagem Docker, container rodando contra Postgres real, migrations
> aplicadas em banco limpo, health/readiness testados com requisições reais,
> CI rodando de verdade num runner real do GitHub — ver Seção 0 abaixo). A
> tentativa real de deploy no Railway esbarrou em um bloqueio diferente dos
> anteriores: **custo**, não falta de acesso — o Railway exige o Hobby plan
> (US$5/mês) para qualquer deploy, e a decisão consciente foi pausar antes de
> gastar. Vercel e Clerk produção continuam **BLOQUEADO POR INFRAESTRUTURA**
> de fato (sem conta/ambiente criado). Cada seção abaixo diz explicitamente o
> que é **IMPLEMENTADO** (existe no repo, testado localmente), **TESTADO**
> (rodou de verdade neste ambiente), **BLOQUEADO POR CUSTO** (acesso existe,
> gasto não autorizado) ou **BLOQUEADO POR INFRAESTRUTURA** (sem
> conta/acesso).

---

## 0. GitHub e CI — IMPLEMENTADO e TESTADO

O repositório foi publicado em `github.com/fraagelo/arenahub` (primeiro commit e
primeiro push da história do projeto) e o workflow de CI (`.github/workflows/ci.yml`)
rodou de verdade contra um runner real do GitHub Actions. A primeira execução
**falhou de verdade**, revelando um bug real que nunca tinha sido pego: o
placeholder `CLERK_WEBHOOK_SIGNING_SECRET` do workflow não era base64 válido
para a lib `standardwebhooks` (que decodifica tudo após `whsec_` como base64
puro) — só "funcionava" localmente porque o `.env` real não versionado usa
outro valor com o formato correto. Corrigido para `whsec_` + base64 puro,
revalidado localmente contra um Postgres novo com os mesmos passos do CI
(migrate deploy + test:e2e + build, 133/133 testes) antes de subir a correção.
Segunda execução: verde.

---

## 1. Arquitetura de produção

```
                    ┌─────────────┐        HTTPS        ┌──────────────┐
   usuário  ──────▶ │   Vercel     │ ───────────────────▶│   Railway     │
                    │  (frontend)  │   NEXT_PUBLIC_API_URL│  (API NestJS) │
                    └─────────────┘                       └──────┬───────┘
                          │                                       │
                          │ Clerk SDK                              │ DATABASE_URL (TLS)
                          ▼                                       ▼
                    ┌─────────────┐                       ┌──────────────┐
                    │    Clerk     │◀──── webhook (Svix) ──│  PostgreSQL   │
                    │ (produção)   │      assinado          │  gerenciado   │
                    └─────────────┘                       └──────────────┘
```

- **Frontend**: Vercel, deploy nativo (Next.js App Router) — **IMPLEMENTADO** (pronto pra
  conectar), **BLOQUEADO POR INFRAESTRUTURA** (sem conta Vercel neste ambiente).
- **Backend**: container Docker (`apps/api/Dockerfile`) — **IMPLEMENTADO e TESTADO**
  localmente (build real + container rodando contra Postgres real, ver Seção 4).
  **BLOQUEADO POR CUSTO** o deploy real no Railway (Hobby plan pago exigido, ver
  Seção 3) — decisão consciente de pausar antes de gastar.
- **Banco**: PostgreSQL gerenciado — hoje só existe o Postgres local do
  `docker/docker-compose.yml`. **BLOQUEADO POR INFRAESTRUTURA** provisionar um
  gerenciado real.
- **Autenticação**: Clerk — só existe um ambiente de *desenvolvimento* configurado
  (chaves `sk_test_...`/`pk_test_...`). **BLOQUEADO POR INFRAESTRUTURA** criar o
  ambiente de *produção* separado (exige acesso ao dashboard.clerk.com da conta real).
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) — **IMPLEMENTADO E TESTADO**: o
  repositório foi publicado em `github.com/fraagelo/arenahub` e o workflow rodou num
  runner real do GitHub. A primeira execução **falhou de verdade** — o placeholder
  `CLERK_WEBHOOK_SIGNING_SECRET` do workflow não era base64 válido para a lib
  `standardwebhooks`, quebrando 5 testes de `auth-flow.e2e-spec.ts` (só "funcionava"
  localmente porque o `.env` real não versionado usa outro valor). Corrigido para
  `whsec_` + base64 puro, revalidado localmente contra um Postgres novo com os mesmos
  passos do CI (migrate deploy + test:e2e + build, 133/133 testes) antes do push da
  correção. Segunda execução: **verde**.

---

## 2. Redis — decisão explícita (não usar)

`REDIS_URL` está em `apps/api/.env.example` e provisionado em
`docker/docker-compose.yml` desde a Fase 1, mas **nenhum código em `apps/api/src`
usa Redis hoje** (confirmado por busca no código nesta fase). A garantia de
integridade de `Booking` é inteiramente PostgreSQL:

- `pg_advisory_xact_lock(hashtext(courtId))` — lock por quadra;
- `EXCLUDE USING GIST` (`Booking_no_overlap_excl`) — autoridade final contra double booking;
- `IdempotencyKey` persistida no Postgres (estratégia "claim-first").

**Não provisione Redis para este deploy.** Ele só volta a ser necessário quando o
roadmap chegar em BullMQ (Fase 12 — jobs assíncronos), e mesmo então, como
mecanismo de fila complementar, nunca substituindo as garantias acima.

---

## 3. Plataforma escolhida para o backend

**Railway**, entre as três opções do prompt (Railway, Render, Fly.io).

| Critério | Railway | Render | Fly.io |
|---|---|---|---|
| Simplicidade de config | Alta — detecta `Dockerfile`, sobe direto | Alta | Média — exige `fly.toml` manual |
| Postgres gerenciado nativo | Sim (addon 1-clique) | Sim | Sim, mas configuração mais manual |
| Migrations como release step | Sim (`Release Command`) | Sim (`Pre-Deploy Command`, planos pagos) | Precisa de `release_command` no `fly.toml` |
| Health check configurável | Sim | Sim | Sim |
| Rollback | 1 clique pra deploy anterior | 1 clique | `fly releases rollback` |
| Custo mínimo razoável | Requer Hobby plan (US$5/mês) — sem free tier real hoje | Sim (free tier p/ web service, com cold start) | Sim, mas cobra por região/VM ativa |

Railway venceu por ter o **release command** (rodar `prisma migrate deploy` uma
única vez, antes de promover o novo deploy, nunca dentro de N réplicas
simultâneas — ver Seção 6) como recurso de primeira classe na UI, e por builder
de Dockerfile nativo sem `fly.toml` extra. Render é a alternativa mais próxima
se o custo do Railway não for viável; a troca é mecânica (mesmo Dockerfile,
mesmas env vars).

> **Correção (Fase 9, tentativa real de deploy):** a linha acima dizia
> originalmente que o Railway não exigia plano pago — informação desatualizada.
> Ao tentar criar o projeto de verdade, o Railway exigiu o **Hobby plan
> (US$5/mês)** para qualquer deploy, mesmo de um único serviço pequeno. Isso não
> muda a escolha técnica (a tabela acima continua válida), só o custo mínimo
> real.

**Status: BLOQUEADO POR CUSTO** — a conta Railway existe, mas o deploy real foi
**pausado deliberadamente** (decisão do usuário) por exigir gasto recorrente
(US$5/mês) que não foi autorizado neste momento. Diferente de "bloqueado por
infraestrutura" (falta de acesso/conta) — aqui o acesso existe, a decisão é de
custo. A escolha de plataforma acima continua válida caso o deploy real seja
retomado.

---

## 4. Docker (backend) — IMPLEMENTADO e TESTADO

`apps/api/Dockerfile` — multi-stage (`base` → `build` → `deploy` → `runtime`),
contexto de build = **raiz do monorepo** (não `apps/api/`), porque o Dockerfile
precisa enxergar `packages/` e o workspace inteiro:

```bash
docker build -f apps/api/Dockerfile -t arenahub-api .
```

Validado nesta fase, de verdade, contra o Postgres local (não é só inspeção
de código — ver Seção 15 "Regra de ouro"):

- imagem construída com sucesso (`node:24-slim`, usuário não-root `node`);
- container subiu, conectou no Postgres real via `DATABASE_URL`;
- `GET /health` e `GET /health/ready` responderam `200` com `database: "ok"`;
- uma rota real (`GET /v1/arenas/discover`) respondeu `401` sem token, como
  esperado (autenticação continua ativa em modo produção);
- `docker stop` (SIGTERM) encerrou o processo com exit code `0` (graceful
  shutdown funcionando).

### 5 bugs reais encontrados e corrigidos ao construir/rodar a imagem pela primeira vez

Nenhum destes era visível por inspeção de código — só apareceram ao efetivamente
construir e rodar o container:

1. **OpenSSL ausente na imagem** (`node:*-slim`/Debian não vem com ele) — o
   engine do Prisma detectava a versão de libssl "no chute". Corrigido com
   `apt-get install openssl` no estágio `base`.
2. **`pnpm deploy` exige `--legacy`** a partir do pnpm v10 pra workspaces sem
   `inject-workspace-packages` habilitado. Corrigido adicionando a flag, sem
   mudar a configuração do workspace só por causa do Dockerfile.
3. **`dist/main.js` não existe — o caminho real é `dist/src/main.js`.** O
   `tsconfig.json` não declara `rootDir`; como `prisma/seed.ts` (fora de
   `src/`) também é compilado, o TypeScript infere a raiz como a pasta do
   projeto inteiro. **Isso também significa que `pnpm start:prod` nunca
   funcionou desde que o script foi criado** — corrigido em
   `apps/api/package.json` junto com o `CMD` do Dockerfile.
4. **O client gerado do Prisma não sobrevive ao `pnpm deploy --legacy` de
   forma utilizável** — `.prisma/client` (o código real com os
   models/enums) fica numa instância do virtual store do pnpm diferente da
   que o `require()` de produção resolve; o resultado observado era todo
   enum do Prisma (`ArenaRole`, `Sport`, `BookingType`...) chegando
   `undefined` em runtime. Corrigido copiando o client já gerado no estágio
   `build` (o mesmo artefato que passou pelos 258 testes de backend) pro
   lugar exato, localizado via `require.resolve()` do próprio Node — nunca
   um terceiro `prisma generate`.
5. **Mesma causa do item 1, mas no estágio final** — o `runtime` parte de
   uma imagem `node:24-slim` **nova**, sem o OpenSSL do estágio `base`; o
   engine foi gerado contra `debian-openssl-3.0.x` mas o runtime tentava
   carregar contra outra versão. Corrigido instalando OpenSSL também no
   estágio `runtime`.

O Dockerfile final documenta cada um desses achados inline, no ponto exato
onde a correção foi aplicada.

### Segurança da imagem
- Usuário não-root (`node`, já existente na imagem base) executa o processo.
- Nenhum `.env`/segredo é copiado — só variáveis de ambiente em runtime
  (`.dockerignore` na raiz do repo exclui `.env*` exceto `.env.example`).
- `deploy --prod` exclui devDependencies (nunca `ts-node`/`jest`/`eslint` na imagem final).
- Tamanho final: ~724 MB (`node:24-slim` + Prisma engine + deps de produção).
  "Razoável", não minimizado ao extremo — trocar a base por algo menor
  (ex: distroless) teria custo de complexidade desproporcional ao ganho, dado
  o requisito real de OpenSSL do Prisma; fica como otimização futura, não
  implementada agora.

### Frontend não é Dockerizado
Conforme o item 12 do prompt — Vercel usa o mecanismo nativo dela pra Next.js
(build/deploy sem container próprio). Nenhum `Dockerfile` foi criado pra
`apps/web`.

---

## 5. Variáveis de ambiente

### `apps/api/.env.example` (atualizado nesta fase)

| Variável | Obrigatória | Onde configurar em produção |
|---|---|---|
| `DATABASE_URL` | Sim | Secret da plataforma (Railway injeta automaticamente ao linkar o addon de Postgres) |
| `CLERK_SECRET_KEY` | Sim | Secret — chave do ambiente de **produção** do Clerk |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Sim | Secret — do endpoint de webhook de produção configurado no Clerk |
| `WEB_APP_URL` | Não (default `localhost:3000`) | URL real do frontend em produção — nunca `*` |
| `PORT` | Não (default `3001`) | Geralmente definida pela própria plataforma |
| `NODE_ENV` | Não | `production` |
| `REDIS_URL` | Não (não usado hoje) | Não provisionar — ver Seção 2 |
| `APP_VERSION` | Não | SHA curto do commit, se a plataforma expuser isso automaticamente |

As três primeiras são validadas no boot (`assertRequiredEnv()` em
`apps/api/src/main.ts`, Fase 9): se qualquer uma faltar, o processo termina
imediatamente com uma mensagem clara nos logs (nunca imprime valores, só
nomes de variáveis ausentes) — nunca sobe parcialmente configurado.

### `apps/web/.env.example`

| Variável | Pública? | Observação |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Sim (`NEXT_PUBLIC_*`) | Chave pública do Clerk — segura no bundle por design |
| `CLERK_SECRET_KEY` | **Não** | Usada só nas rotas de servidor do Clerk/Next — nunca prefixada `NEXT_PUBLIC_`, nunca chega ao bundle do browser (auditado nesta fase: nenhum `NEXT_PUBLIC_*` no repo contém `DATABASE_URL`/secret) |
| `NEXT_PUBLIC_API_URL` | Sim | **Precisa apontar pra API de produção** — o fallback no código (`http://localhost:3001/v1`) só existe pra dev local; esquecer de configurar isso na Vercel faz todo request de produção falhar silenciosamente contra `localhost` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `..._SIGN_UP_URL` | Sim | Rotas internas, sem dado sensível |

---

## 6. Migrations em produção

**Nunca** `prisma migrate dev` em produção — só `prisma migrate deploy`
(já é o que o CI usa desde a Fase 1).

**Estratégia**: Railway "Release Command" — roda
`pnpm --filter @arenahub/api exec prisma migrate deploy` **uma única vez**,
antes de promover o novo deploy pro tráfego real, nunca dentro do `CMD` do
container (que roda em N réplicas simultâneas). O próprio `prisma migrate
deploy` também é seguro sob concorrência por si (usa um advisory lock do
Postgres internamente para evitar duas migrations rodando ao mesmo tempo),
mas usar o release command evita até a tentativa duplicada e mantém o log de
deploy limpo.

Nenhum script do repositório executa `prisma migrate reset` ou equivalente
destrutivo — confirmado por busca no código.

**Validado nesta fase** (não apenas documentado): `DROP SCHEMA public CASCADE`
seguido de `prisma migrate deploy` contra o Postgres local, do zero, aplicou
as 5 migrations existentes sem intervenção manual (ver Seção 15).

---

## 7. Health, readiness e graceful shutdown — IMPLEMENTADO e TESTADO

- `GET /v1/health` — **liveness**. Nunca depende do banco (uma falha
  temporária do Postgres não pode fazer a plataforma reiniciar o processo
  em loop). Sem autenticação, resposta mínima (`status`, `service`,
  `timestamp`).
- `GET /v1/health/ready` — **readiness**. Roda `SELECT 1` real contra o
  Postgres via Prisma; `503` genérico se falhar (nunca vaza mensagem do
  driver/host/porta). Configure a plataforma para só rotear tráfego depois
  desse endpoint responder `200`.
- **Graceful shutdown**: `app.enableShutdownHooks()` (Fase 9 — não existia
  antes) garante que `SIGTERM` aciona o ciclo de vida do Nest, incluindo
  `PrismaService.onModuleDestroy()` (`$disconnect()`). Bookings em andamento
  não dependem de memória do processo: o advisory lock e a transação são do
  Postgres, e são liberados pelo próprio banco mesmo num encerramento
  abrupto — um restart nunca deixa lock "preso".

Configuração sugerida na plataforma: liveness em `/v1/health`, readiness em
`/v1/health/ready`, timeout de shutdown de pelo menos alguns segundos (pra
dar tempo de `$disconnect()` e de requests em andamento terminarem).

---

## 8. Clerk em produção — BLOQUEADO POR INFRAESTRUTURA

Requer acesso à conta real do Clerk (dashboard.clerk.com). Passo a passo pra
quem tiver esse acesso:

1. No projeto Clerk existente, ativar/criar o ambiente de **Production**
   (separado do "Development" já usado neste repositório).
2. Copiar as chaves de produção (`pk_live_...`/`sk_live_...`) para:
   - `apps/web`: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (Vercel, env de produção).
   - `apps/api`: `CLERK_SECRET_KEY` (Railway, secret).
3. Cadastrar um endpoint de webhook novo apontando pra
   `https://<api-de-produção>/v1/webhooks/clerk`, copiar o *Signing Secret*
   pra `CLERK_WEBHOOK_SIGNING_SECRET` na API de produção.
4. Configurar as URLs permitidas (sign-in/sign-up/redirect) pro domínio real
   de produção do frontend.
5. Nunca reutilizar a chave de desenvolvimento em produção.

O código não muda entre ambientes — só a configuração (princípio da Fase 9,
item 4).

---

## 9. CORS em produção

`WEB_APP_URL` deve ser a URL real e única do frontend de produção — nunca
`*`. Já implementado desde a Fase 6 (`app.enableCors({ origin: ... })`),
sem `credentials` (autenticação é sempre Bearer token, nunca cookie).

Sobre *preview deployments* da Vercel (item 32): **não** abrir CORS pra
`*.vercel.app` globalmente. Se previews precisarem falar com a API de
verdade, a estratégia recomendada é apontar previews pra um ambiente de
staging da API (`WEB_APP_URL` de staging inclui a origem de preview
específica que se está testando, adicionada manualmente por vírgula) — não
implementado nesta fase por falta de um ambiente de staging real (ver Seção
12).

---

## 10. Observabilidade

- **Logs**: `Logger` do NestJS (já usado desde a Fase 2/3) — startup registra
  porta, `NODE_ENV` e `APP_VERSION` (se definida); nunca secrets. Auditado
  nesta fase: nenhum `console.log`/`console.error` no código de produção,
  nenhum log imprime `Authorization`/token/`DATABASE_URL`.
- **Versão em execução**: `APP_VERSION` (opcional) aparece no log de
  startup — normalmente o SHA curto do commit, setado pela plataforma.
- **Erros / alertas / métricas de infraestrutura (uptime, 5xx, latência)**:
  **NÃO implementado** — exigiria uma conta numa ferramenta externa (Sentry,
  Better Stack, etc.), que não existe neste ambiente. Recomendação pra
  quando houver: Sentry (SDK do Nest é direto de integrar, plano free cobre
  o volume inicial) — documentado como próximo passo, não instalado agora
  pra não adicionar uma dependência/conta sem necessidade imediata.
- **Request ID / correlation ID**: avaliado e **não implementado** — a Fase 9
  pede pra só adicionar se realmente melhorar a observabilidade agora, e sem
  uma ferramenta de log centralizada configurada (item acima), um
  correlation ID não tem pra onde correlacionar ainda. Fica documentado como
  candidato natural quando o Sentry/log centralizado entrar.

---

## 11. Segurança — checklist

- [x] Nenhum secret no Git (`.env`/`.env.*` exceto `.env.example` no
      `.gitignore` desde a Fase 1; confirmado nesta fase que nenhum
      commit existe no repositório de qualquer forma).
- [x] Nenhum secret no bundle do frontend (só `NEXT_PUBLIC_*` chega ao
      browser; auditado).
- [x] CORS restrito a uma origem configurável, nunca `*`.
- [x] `ValidationPipe` global (`whitelist`+`forbidNonWhitelisted`) — mass
      assignment testado extensivamente na Fase 8.
- [x] Nenhum endpoint de debug (`/debug`, `/admin-debug`, etc.) — auditado.
- [x] Headers de segurança no frontend (`X-Content-Type-Options`,
      `Referrer-Policy`, `X-Frame-Options`, `Strict-Transport-Security`) —
      novos nesta fase, testados contra `next start` local.
- [ ] CSP — deliberadamente **não** adicionado (item 101: "não adicionar CSP
      quebrando Clerk/Next.js sem testar" — este ambiente não tem como testar
      contra um domínio de produção real com Clerk ativo).
- [x] HTTPS — garantido pela plataforma (Vercel/Railway terminam TLS
      automaticamente); nenhuma configuração do lado da aplicação assume
      HTTP.

---

## 12. Staging

**NÃO implementado.** Criar um ambiente de staging de verdade (banco
separado, Clerk separado, URLs separadas) exige provisionar uma segunda
instância de cada serviço externo — mesmo bloqueio de infraestrutura das
seções anteriores. Documentado aqui como próximo passo recomendado antes de
um primeiro deploy real de produção, não como algo que foi montado.

---

## 13. Backup e restore

**NÃO configurado** — depende do provedor de Postgres gerenciado escolhido
(Railway oferece backups automáticos diários no plano pago do addon de
Postgres; point-in-time recovery depende do plano). Como nenhum banco
gerenciado real foi provisionado nesta fase, não há nada pra configurar
ainda, e seria falso afirmar que existe uma rotina de backup funcionando.

Procedimento documentado para quando houver banco gerenciado:
1. Confirmar no dashboard do provedor que o backup automático diário está
   ativo.
2. Antes de qualquer migration em produção, tirar um snapshot manual
   adicional, se a plataforma permitir (Seção 6 já cobre a estratégia seura
   de migration em si).
3. Restore: usar o mecanismo de restore point-in-time ou snapshot do
   provedor — nunca reconstruir o banco rodando as migrations do zero como
   "restore" (isso perde todos os dados).

---

## 14. Rollback

- **Aplicação**: Railway/Render mantêm o build anterior disponível — reverter
  é "promover o deploy anterior" na UI/CLI, sem rebuild.
- **Migrations**: Prisma não gera down-migrations automaticamente. Reverter
  o *código* da aplicação NÃO desfaz uma migration de *schema* já aplicada.
  Por isso a Parte 8 de `docs/ARCHITECTURE.md` já orienta migrations
  backward-compatible (nunca remover uma coluna/tabela ainda em uso pela
  versão anterior, sempre em duas etapas: adicionar → migrar dados/código →
  só then remover, num deploy seguinte). Nenhuma migration deste projeto até
  agora foi destrutiva.
- **Zero-downtime**: não prometido — depende inteiramente da plataforma
  escolhida (não validado neste ambiente, já que nenhum deploy real
  aconteceu).

---

## 15. Regra de ouro desta fase, aplicada de verdade

"Não considerar build local como deploy de produção" (item 131) — por isso
este documento distingue claramente:

- **TESTADO nesta fase, contra infraestrutura real que ESTE ambiente tem**:
  build da imagem Docker, container rodando contra Postgres real (via
  `docker-compose.yml`), `health`/`health/ready` respondendo de verdade,
  graceful shutdown, migrations em banco limpo, `next start` local com os
  headers de segurança presentes na resposta HTTP real.
- **NÃO TESTADO / BLOQUEADO POR INFRAESTRUTURA**: qualquer coisa que exija
  Vercel, Railway, Fly.io, Render, um Clerk de produção, ou um domínio real
  — nenhuma dessas contas existe neste ambiente. A Fase 9 não declara "deploy
  concluído"; declara "o repositório está pronto para ser implantado assim
  que alguém com acesso a essas contas seguir os passos acima".

## Troubleshooting

| Sintoma | Causa provável | Onde olhar |
|---|---|---|
| API não inicia, log de "Variáveis de ambiente obrigatórias ausentes" | Secret não configurado na plataforma | `apps/api/src/main.ts`, `assertRequiredEnv` |
| Todo enum do Prisma (`ArenaRole`, etc.) vem `undefined` | Client do Prisma não gerado corretamente na imagem | Ver Seção 4, achado #4 — confirme que o Dockerfile não foi alterado sem entender essa parte |
| `/health/ready` retorna 503 | Postgres inacessível (rede, credencial, ou banco fora do ar) | `DATABASE_URL`, conectividade de rede da plataforma até o Postgres |
| Frontend chama `localhost:3001` em produção | `NEXT_PUBLIC_API_URL` não configurada na Vercel | Env vars do projeto na Vercel, ambiente de produção |
| Login/webhook do Clerk não funciona em produção | Chaves de desenvolvimento usadas em produção, ou webhook não recadastrado pro domínio real | Ver Seção 8 |
