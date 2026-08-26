# ArenaHub — Deploy e Infraestrutura de Produção

> Companheiro de `docs/ARCHITECTURE.md` (v0.18) — este documento é operacional
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

## 0.1. Fase 18 (Production Readiness e Hardening) — IMPLEMENTADO e TESTADO

Auditoria completa de produção sem adicionar nenhuma funcionalidade de
produto nova. Tudo abaixo foi validado de verdade nesta fase — não só
implementado, mas exercitado contra infraestrutura real (Postgres local,
imagem Docker construída e executada, requisições HTTP reais):

- **Rate limiting** (`@nestjs/throttler`, em memória, por instância — ver
  Seção 5.1) — limite padrão global + limites dedicados em endpoints
  sensíveis a abuso (IA, pagamentos, convites, reservas, disponibilidade,
  clientes, relatórios). Webhooks e health check nunca são limitados.
  Validado com um teste e2e real que dispara 12 requisições concorrentes
  contra um endpoint com limite de 10/min e confirma o 429.
- **Security headers** via `helmet` (defaults) no backend — confirmado por
  requisição HTTP real contra a imagem Docker construída nesta fase
  (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`,
  CSP default, e ausência de `X-Powered-By`, inclusive em requisições de
  preflight CORS — achado real corrigido nesta fase, ver Seção 5.2).
- **X-Request-Id / correlation ID** — gerado ou ecoado (só se já for um
  valor seguro), devolvido no header de resposta e propagado para os logs
  de cada requisição via `AsyncLocalStorage` nativo do Node (nenhuma
  dependência nova). Confirmado por requisição real.
- **Filtro global de exceções** — rede de segurança que garante que
  nenhum erro não previsto (bug, erro do Prisma não tratado num service
  novo) vaza stack trace ou mensagem interna do driver pro cliente; mapeia
  `P2025`→404 e `P2002`→409 genéricos, qualquer outro caso vira 500
  genérico. `HttpException`s já intencionais passam inalteradas.
- **Logging estruturado por requisição** — um log por requisição HTTP
  (método, rota sem query string, status, duração, requestId), nível
  `error` só para 5xx (um 4xx é tráfego normal do produto, não um
  incidente).
- **`trust proxy`** habilitado condicionalmente em produção — sem isso, o
  rate limiter atrás do proxy da plataforma trataria todos os clientes
  como um único IP.
- **CORS**: origens agora normalizadas (`trim`) e métodos declarados
  explicitamente; `WEB_APP_URL` passou a ser **obrigatória** em produção
  (`assertProductionSafety()` em `main.ts`) — o processo se recusa a subir
  em produção sem ela, em vez de silenciosamente usar o default de
  desenvolvimento (`http://localhost:3000`).
- **Docker HEALTHCHECK** nativo (`node -e` contra `/v1/health`, sem
  dependência nova) — confirmado `"Status":"healthy"` via
  `docker inspect` contra a imagem construída nesta fase.
- **Permissions-Policy** adicionado aos headers do frontend
  (`camera=(), microphone=(), geolocation=()`).
- Auditoria transversal de multi-tenant/IDOR/mass assignment nos módulos
  de Pagamentos/Clientes/Relatórios (Fases 14/15/17) — nenhuma
  vulnerabilidade nova encontrada; a cobertura já existente (Fase 8,
  `hardening.e2e-spec.ts`, mais os specs dedicados de cada fase) já
  exercita isso.
- Auditoria de segredos no repositório (busca por padrões de chave/token) —
  nenhum segredo real versionado encontrado.

Ver `docs/ARCHITECTURE.md`, "Decisões revisadas na v0.18", para o raciocínio
completo de cada decisão, e o relatório final da Fase 18 para os números
exatos de teste e as ressalvas.

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
  shutdown funcionando);
- **(Fase 18)** `HEALTHCHECK` nativo do Docker (`node -e` contra
  `/v1/health`, sem `curl`/`wget` — a imagem `node:*-slim` não os tem)
  reportou `"Status":"healthy"` via `docker inspect` após o
  `start-period`;
- **(Fase 18)** headers de `helmet` e `X-Request-Id` presentes em
  requisições reais contra o container; `X-Powered-By` do Express
  confirmado ausente, inclusive em preflight CORS;
- **(Fase 18)** preflight CORS (`OPTIONS`) de uma origem não configurada
  não recebe `Access-Control-Allow-Origin` (bloqueado pelo browser), e de
  uma origem configurada recebe corretamente;
- **(Fase 18)** subir o container em modo produção (`NODE_ENV=production`,
  herdado do próprio Dockerfile) sem `WEB_APP_URL` falhou o boot
  imediatamente com a mensagem esperada (`assertProductionSafety`) — nunca
  sobe silenciosamente mal configurado.

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
| `WEB_APP_URL` | **Sim em produção** (Fase 18 — antes era opcional com default `localhost:3000`) | URL real do frontend em produção — nunca `*`. Sem ela, a API **se recusa a subir** em produção (`assertProductionSafety`, `main.ts`) |
| `RATE_LIMIT_WINDOW_MS` | Não (default `60000`) | Fase 18 — janela (ms) do limite padrão de rate limiting. Só afeta rotas sem `@Throttle()` próprio (ver Seção 5.1) |
| `RATE_LIMIT_MAX` | Não (default `300`) | Fase 18 — número de requisições por janela do limite padrão |
| `PORT` | Não (default `3001`) | Geralmente definida pela própria plataforma |
| `NODE_ENV` | Não | `production` |
| `REDIS_URL` | Não (não usado hoje) | Não provisionar — ver Seção 2 |
| `APP_VERSION` | Não | SHA curto do commit, se a plataforma expuser isso automaticamente |
| `INVITATION_EXPIRES_DAYS` | Não (default `7`) | Nova na Fase 11 — dias até um convite de equipe expirar. Não é secret; só ajuste se `7` não fizer sentido pro produto |
| `AI_PROVIDER_API_KEY` | Não* (ver abaixo) | Secret — chave da API da OpenAI (platform.openai.com). Nova na Fase 12 |
| `AI_PROVIDER_MODEL` | Não (default `gpt-4o-mini`) | Modelo da OpenAI usado pelo assistente |
| `AI_PROVIDER_TIMEOUT_MS` | Não (default `15000`) | Timeout (ms) de cada chamada à OpenAI |
| `WHATSAPP_VERIFY_TOKEN` | Não* (ver abaixo) | Secret — token arbitrário cadastrado no painel da Meta para o handshake do webhook. Novo na Fase 16 |
| `WHATSAPP_APP_SECRET` | Não* (ver abaixo) | Secret — App Secret da Meta, usado para verificar `X-Hub-Signature-256`. Novo na Fase 16 |
| `WHATSAPP_ACCESS_TOKEN` | Não* (ver abaixo) | Secret — token de acesso (System User) da WhatsApp Business Platform, usado para ENVIAR mensagens. Novo na Fase 16 |
| `PAYMENT_API_KEY` | Não* (ver abaixo) | Secret — access token da conta Mercado Pago (mercadopago.com.br/developers). Novo na Fase 17 |
| `PAYMENT_WEBHOOK_SECRET` | Não* (ver abaixo) | Secret — usado para verificar `X-Signature` de `POST /v1/webhooks/payments/mercadopago`. Novo na Fase 17 |
| `PAYMENT_TIMEOUT_MS` | Não (default `15000`) | Timeout (ms) de cada chamada ao Mercado Pago |

As três primeiras são validadas no boot (`assertRequiredEnv()` em
`apps/api/src/main.ts`, Fase 9): se qualquer uma faltar, o processo termina
imediatamente com uma mensagem clara nos logs (nunca imprime valores, só
nomes de variáveis ausentes) — nunca sobe parcialmente configurado.
`INVITATION_EXPIRES_DAYS`, as variáveis de IA, de WhatsApp e de pagamento
não estão nessa lista — são opcionais, com default (ou comportamento
degradado) no próprio código, então a ausência delas nunca impede o boot da
API (\* `AI_PROVIDER_API_KEY` é a única das de IA cuja ausência tem efeito
visível: sem ela, só o endpoint `POST /v1/arenas/:arenaId/ai/ask` responde
503, o resto do produto continua 100% funcional — ver "Assistente de IA"
abaixo. Das três de WhatsApp, `WHATSAPP_VERIFY_TOKEN` ausente faz o
handshake `GET /v1/webhooks/whatsapp` sempre rejeitar com 403;
`WHATSAPP_APP_SECRET` ausente faz TODO `POST /v1/webhooks/whatsapp` ser
rejeitado com 403 — nunca aceita um evento sem conseguir verificar a
assinatura; `WHATSAPP_ACCESS_TOKEN` ausente só impede o ENVIO da resposta —
o processamento da mensagem e a escrita no banco continuam acontecendo
normalmente, só a entrega ao cliente falha, e fica logada — ver "Canal de
WhatsApp" abaixo. Das duas de pagamento, `PAYMENT_API_KEY` ausente faz
`POST /v1/users/me/bookings/:bookingId/payments` responder com um erro
tratado do provider — nenhum Payment fica "meio criado" (ver "Pagamentos"
abaixo); `PAYMENT_WEBHOOK_SECRET` ausente faz TODO
`POST /v1/webhooks/payments/mercadopago` ser rejeitado com 403, mesmo fail
closed do WhatsApp).

### Convites por e-mail (Fase 11) — sem provedor real configurado

`WEB_APP_URL` (já existente desde a Fase 9, **reaproveitada, não é uma
variável nova**) agora também compõe o link de aceite do convite
(`${WEB_APP_URL}/convites/:token`) — se ela estiver errada em produção, o
link enviado por e-mail aponta pro lugar errado, do mesmo jeito que hoje
afeta CORS (Seção 9).

O envio em si passa por uma abstração (`InvitationEmailService`) com um
único adapter implementado, `ConsoleInvitationEmailService` — ele só loga o
link via `Logger` do Nest, e **somente fora de produção**
(`NODE_ENV !== 'production'`); em produção, loga um aviso genérico (nome da
arena, nunca o link/token) e retorna sem lançar, porque a criação do convite
nunca deve falhar por causa da notificação. **Nenhum provedor de e-mail real
(SendGrid/Postmark/Resend/SES) foi integrado nesta fase** — em produção,
hoje, o OWNER precisaria copiar o link manualmente dos logs do servidor
(inviável na prática). Antes de usar convites em produção de verdade:
implemente um novo adapter de `InvitationEmailService` para o provedor
escolhido e troque o `provide: InvitationEmailService, useClass:
ConsoleInvitationEmailService` em `InvitationsModule` — nenhuma outra parte
do sistema precisa mudar, é só trocar a implementação da mesma interface.

**Expiração** (`INVITATION_EXPIRES_DAYS`, default 7 dias) é avaliada em
tempo de leitura (não há job/cron marcando convites como expirados) — um
convite `EXPIRED` continua existindo no banco, só deixa de ser aceitável.
Sem impacto de infraestrutura adicional.

**Segurança do link**: o token no link tem 256 bits de entropia
(`crypto.randomBytes(32)`), e só o hash SHA-256 é persistido — mesmo com
acesso de leitura ao banco de produção, não é possível reconstruir o token
original nem aceitar um convite em nome de outra pessoa. Isso também
significa que **um convite perdido não pode ser recuperado** — a única
opção é revogar e reenviar (`POST .../resend`, que gera um token novo e
invalida o anterior implicitamente ao trocar o hash salvo).

### Assistente de IA operacional (Fase 12) — segurança, custo e comportamento sem chave

**Provedor**: OpenAI (Chat Completions API), chamado via `fetch` nativo do Node — sem SDK
adicional. Decisão tomada em conjunto com o usuário durante a Fase 12 (nenhuma decisão anterior
vinculava o projeto a um provedor específico para este escopo). Trocar de provedor no futuro é
implementar um novo `AiProvider` (`apps/api/src/modules/ai/providers/ai-provider.ts`) e trocar o
`useClass` registrado em `AiModule` — nenhuma outra parte do sistema muda.

**Segurança da chave**: `AI_PROVIDER_API_KEY` só existe no backend, nunca no frontend — nenhuma
variável `NEXT_PUBLIC_*` a referencia, e ela nunca é logada (nem em sucesso, nem em erro; os logs
do `OpenAiAiProviderService` incluem só status/duração/modelo). Nunca é persistida no banco.

**Comportamento sem a chave configurada**: o resto da API sobe normalmente — `AI_PROVIDER_API_KEY`
não está em `REQUIRED_ENV_VARS` (Fase 9), porque a IA é uma funcionalidade adicional, não um
requisito para reservar quadra/gerenciar arena. Só `POST /v1/arenas/:arenaId/ai/ask` responde `503`
("Assistente de IA temporariamente indisponível.") até a chave ser configurada.

**Timeout e erros do provedor**: cada chamada à OpenAI tem um timeout configurável
(`AI_PROVIDER_TIMEOUT_MS`, default 15s) via `AbortController` — se a OpenAI não responder a tempo,
o request é abortado e a API responde `503`, nunca fica pendurada. Qualquer erro do provedor
(timeout, status de erro, resposta malformada) é mapeado para `503` com uma mensagem genérica —
o detalhe interno (ex: mensagem de erro da OpenAI, motivo do timeout) é logado no servidor, nunca
devolvido na resposta HTTP.

**Custo**: modelo default `gpt-4o-mini` (custo por token baixo comparado aos modelos "full-size" da
OpenAI) — variável, cobrado por uso pela OpenAI, fora do controle direto do ArenaHub. Mitigações de
custo implementadas nesta fase: limite de 500 caracteres por pergunta, limite de 92 dias por período
explícito consultado, e nenhum retry automático em caso de erro. **Rate limiting persistente
(por usuário/IP/arena) não foi implementado** — um contador em memória seria descartado a cada
redeploy (falso senso de proteção); se o volume de uso justificar, uma solução real precisa de
estado persistente (Postgres/Redis) e fica para uma fase futura. Monitorar custo real via o próprio
painel da OpenAI (platform.openai.com/usage) até esse controle existir no produto.

**Prompt injection**: o system prompt (centralizado em `apps/api/src/modules/ai/prompts.ts`) inclui
regras explícitas contra revelar dados de outras arenas, executar ações, ou tratar texto do usuário
como instrução — mas isso **nunca foi validado contra uma chamada real à OpenAI neste ambiente**
(sem credencial de produção disponível). O que É garantido estruturalmente, e testado (e2e contra
Postgres real): o contexto enviado ao modelo é montado só a partir de queries filtradas por
`arenaId` — não existe caminho de código pelo qual dado de outra arena chegaria ao contexto, com ou
sem a cooperação do modelo. Antes de expor a funcionalidade a usuários reais em produção, validar a
resistência semântica do modelo escolhido com testes manuais/automatizados contra a API real.

### Canal de WhatsApp (Fase 16) — provider, identidade, segurança e limitações

**Provedor**: WhatsApp Business Platform / Cloud API oficial da Meta, chamada via `fetch` nativo
(`MetaWhatsAppProviderService`) — nunca uma solução não oficial baseada em QR Code/scraping/sessão
de WhatsApp Web. Abstraído atrás de `WhatsAppProvider`
(`apps/api/src/modules/whatsapp/providers/whatsapp-provider.ts`); trocar de provider é implementar
uma nova classe e trocar o `useClass` em `WhatsAppModule`, igual ao padrão já usado pelo `AiProvider`
(Fase 12).

**Identidade do cliente**: reaproveita `User.phone`, já sincronizado do Clerk desde a Fase 2 —
nenhuma conta/tabela de identidade paralela foi criada. Um cliente só consegue usar o WhatsApp
depois de ter uma conta ArenaHub (via Clerk) **com um número de telefone verificado cadastrado no
próprio Clerk** (recurso do Clerk, habilitado no painel do projeto — não é código deste
repositório). Sem isso, a mensagem recebida é respondida com uma explicação amigável
("Não encontramos uma conta ArenaHub vinculada a este número...") e nada mais acontece — nenhuma
conversa é criada, nenhum dado é tocado.

**Identidade da arena**: cada arena configura o próprio `phone_number_id` da Meta via
`PATCH /v1/arenas/:arenaId` (campo `whatsappPhoneNumberId`, OWNER/ADMIN, também editável em
`/dashboard/[arenaId]/configuracoes`) — o webhook (uma única URL compartilhada por todas as arenas)
resolve a arena de destino por esse identificador estável, nunca comparando strings de telefone.
Uma arena sem esse campo configurado nunca recebe mensagens processadas (o evento chega, mas é
ignorado e logado — a Meta não é notificada de erro, porque tecnicamente não há erro nenhum do lado
dela).

**Segurança do webhook**: `GET /v1/webhooks/whatsapp` (handshake de verificação, exigido ao
configurar o endpoint no painel da Meta) só responde com sucesso se `hub.verify_token` bater com
`WHATSAPP_VERIFY_TOKEN`. `POST /v1/webhooks/whatsapp` (eventos reais) exige `X-Hub-Signature-256`
válido — HMAC-SHA256 do corpo cru com `WHATSAPP_APP_SECRET`, comparado com `timingSafeEqual` (mesma
disciplina do webhook do Clerk desde a Fase 2/9). Sem esse secret configurado, **todo** POST é
rejeitado com 403 — nunca um fallback "aceita mesmo assim".

**Idempotência em duas camadas**: (1) o próprio evento do webhook é deduplicado por
`providerEventId` (`WhatsAppEvent`, técnica "claim-first" igual ao `IdempotencyKey` da Fase 4) — a
Meta pode entregar a mesma mensagem mais de uma vez, e só a primeira é processada; (2) a criação de
reserva em si usa o mecanismo formal de `Idempotency-Key` já existente
(`IdempotencyService.execute`), com a chave (`pendingActionId`) gerada uma única vez ao entrar no
estado de confirmação e nunca regenerada por retry — a mesma proteção da Fase 4/13, não uma segunda
implementação.

**IA usada só para classificar intenção, nunca para responder ao cliente**: a única saída do LLM
(`WhatsAppIntentService`) é um JSON fechado de intenção (`{"intent": "..."}`), validado
rigorosamente contra um schema fixo antes de qualquer uso — nunca texto livre interpolado numa
resposta. Todo texto que o cliente efetivamente recebe vem de templates centralizados
(`apps/api/src/modules/whatsapp/messages.ts`), parametrizados só com dados já validados pelo
domínio. Isso significa que, mesmo que o modelo fosse completamente manipulado por uma tentativa de
prompt injection na mensagem do cliente, o pior resultado possível é a intenção cair em `UNKNOWN`
(resposta de ajuda genérica) — não existe caminho de código pelo qual a saída do modelo alcance o
cliente como prosa não filtrada, nem pelo qual influencie `arenaId`/`userId`/preço de qualquer
escrita (esses três nunca são enviados ao modelo, nunca lidos da resposta dele). Reaproveita o MESMO
`AiProvider` da Fase 12 (exportado de `AiModule`) — nenhuma segunda chave de API, nenhum segundo
cliente OpenAI.

**Datas/horários nunca calculados pelo modelo**: o LLM só extrai a frase bruta ("amanhã", "19h") —
toda a aritmética de data relativa e validação de horário é determinística
(`apps/api/src/modules/whatsapp/nlp.util.ts`), testada sem nenhum mock de IA. A maioria das
mensagens de uma conversa completa (seleção numérica, "sim"/"não", data/hora já em formato
reconhecido) nunca chama o modelo — só a primeira mensagem de cada nova intenção (estado `IDLE`)
passa pelo classificador.

**Rate limiting**: não implementado nesta fase (mesma decisão e mesmo motivo da Fase 12 — um
contador em memória seria uma falsa sensação de proteção, descartada a cada redeploy; uma solução
persistente real fica para quando o volume de uso justificar). A superfície pública é protegida por
verificação de assinatura (só a Meta consegue produzir um POST aceito) e pela deduplicação de
eventos — não por limite de taxa.

**Sem integração real validada nesta fase**: não há credenciais reais da Meta neste ambiente
(`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN` de produção). Toda a
implementação foi desenvolvida e testada (unitário e e2e contra Postgres real) usando
`FakeWhatsAppProvider` (nunca chega a fazer uma requisição HTTP real) e o mesmo `FakeAiProvider` já
usado pela Fase 12 — o formato das chamadas ao Graph API segue a documentação pública da Cloud API,
mas **não foi exercitado contra a Meta de verdade**. Antes de ativar o canal em produção: criar um
app WhatsApp Business no Meta for Developers, configurar o webhook apontando pra
`https://<sua-api>/v1/webhooks/whatsapp`, gerar um token de acesso permanente (System User), e
validar manualmente o fluxo completo com um número de teste — não fingir que essa validação já
aconteceu.

### Pagamentos (Fase 17) — gateway, webhook, idempotência e limitações

**Provedor**: Mercado Pago (PIX), chamado via `fetch` nativo (`MercadoPagoPaymentProviderService`) —
sem SDK adicional, mesma filosofia de dependências mínimas da Fase 12/16. Escolhido depois de avaliar
PIX/Mercado Pago/Asaas/Stripe (ver docs/ARCHITECTURE.md, Fase 17, "Gateway escolhido" — o motivo
decisivo é sandbox acessível sem CNPJ e um esquema de assinatura de webhook (HMAC + manifest) que
mapeia diretamente no mesmo padrão já usado por Clerk/WhatsApp). Abstraído atrás de `PaymentProvider`
(`apps/api/src/modules/payments/providers/payment-provider.ts`); trocar de provedor é implementar uma
nova classe e trocar o `useClass` em `PaymentsModule`.

**Ciclo financeiro separado do operacional**: `Payment` (nova tabela) tem seu próprio status
(`PENDING`/`PAID`/`FAILED`/`EXPIRED`/`CANCELLED`), nunca reaproveita `BookingStatus`
(`CONFIRMED`/`CANCELLED`, intocado). Uma Booking pode ter várias tentativas de pagamento (retry após
FAILED/EXPIRED), mas nunca duas `PAID` — garantido por um índice único parcial no Postgres
(`Payment_bookingId_single_paid`), a mesma técnica já usada pro único-OWNER de arena (Fase 10).

**Valor sempre do backend**: `Payment.amount` é copiado de `Booking.total` no momento da criação —
o cliente não tem nenhum campo pra enviar `amount`/`status`/`currency` (o endpoint de criação nem
declara um corpo aceito). Testado explicitamente (mass assignment com `{amount: 1}` no corpo é
ignorado).

**Webhook nunca confia no próprio corpo**: `POST /v1/webhooks/payments/mercadopago` exige
`X-Signature`/`X-Request-Id` válidos (HMAC-SHA256 com `PAYMENT_WEBHOOK_SECRET`, mesma disciplina do
Clerk/WhatsApp) e, mesmo depois de aceito, NUNCA aplica o `status` que o corpo da notificação alega —
sempre busca o status real de volta na API do Mercado Pago pelo `data.id` antes de qualquer mudança
de estado. Deduplicado por `PaymentWebhookEvent` (mesma técnica "claim-first" do `WhatsAppEvent`).

**Máquina de estados**: `PENDING` é o único estado não-terminal. Qualquer evento que chegue depois de
`PAID`/`FAILED`/`EXPIRED`/`CANCELLED` já ter sido alcançado é ignorado (CAS condicionado a
`status: PENDING`, mesmo padrão do CAS de cancelamento da Fase 13) — resolve os dois exemplos de
webhook fora de ordem do prompt da fase sem depender da ordem real de chegada.

**Integração com cancelamento**: se a Booking for cancelada enquanto um Payment ainda está `PENDING`,
uma confirmação `PAID` que chegue depois nunca é aplicada — o Payment vira `CANCELLED`
(`failureReason: BOOKING_CANCELLED_BEFORE_PAYMENT`), nunca finge que houve reembolso. **Refund não foi
implementado nesta fase** (fora de escopo explícito do prompt) — se uma Booking já paga for
cancelada, o `Payment` permanece `PAID` no registro (histórico correto de que o dinheiro entrou), e
qualquer devolução real precisa ser tratada manualmente/numa fase futura.

**Rate limiting**: não implementado (mesma decisão e mesmo motivo da Fase 12/16) — a superfície
pública é protegida por verificação de assinatura e deduplicação de eventos, não por limite de taxa.

**Sem integração real validada nesta fase**: não há credenciais reais do Mercado Pago neste ambiente
(`PAYMENT_API_KEY`/`PAYMENT_WEBHOOK_SECRET` de produção ou mesmo de sandbox). Toda a implementação foi
desenvolvida e testada (unitário e e2e contra Postgres real, incluindo concorrência real com
`Promise.all`) usando `FakePaymentProvider` — nunca chega a fazer uma requisição HTTP real. O formato
das chamadas segue a documentação pública da API de Pagamentos do Mercado Pago, mas **não foi
exercitado contra o gateway de verdade**. Antes de ativar em produção: criar uma conta Mercado Pago,
gerar credenciais de sandbox, configurar o webhook apontando pra
`https://<sua-api>/v1/webhooks/payments/mercadopago`, e validar manualmente uma cobrança PIX de ponta
a ponta com as credenciais de teste — não fingir que essa validação já aconteceu.

### 5.1. Rate limiting (Fase 18) — em memória, NUNCA distribuído

`@nestjs/throttler`, registrado globalmente (`ThrottlerModule.forRoot` +
`APP_GUARD`), com um limite **padrão** generoso
(`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS`, default 300 req/min por IP+rota) e
limites **dedicados**, fixos no código (decisão de segurança, não um
parâmetro operacional), nos endpoints mais sensíveis a abuso:

| Endpoint | Limite dedicado | Motivo |
|---|---|---|
| `POST .../ai/ask` | 30/min | Cada chamada é uma requisição paga à OpenAI |
| `POST .../bookings/payments` | 30/min | Cada chamada fala com o gateway de pagamento |
| `POST/POST blocks/POST maintenance/POST cancel` de reservas | 100/min cada | Maior valor de negócio para abusar (varredura de agenda) |
| `POST .../invitations` | 20/min | Dispara e-mail real |
| `POST .../invitations/:id/resend` | 10/min | Vetor de spam de e-mail mais direto |
| `GET .../customers*` | 100/min | Toca PII (nome, telefone, histórico) |
| `GET .../reports` | 60/min | Agregações potencialmente caras |
| `GET .../availability` | 200/min | Legitimamente polido com frequência pelo calendário do frontend |

**Nunca aplicado** (`@SkipThrottle()`) em: `GET /v1/health`,
`GET /v1/health/ready` (a própria plataforma de deploy os chama com muito
mais frequência do que qualquer limite permitiria), e nos três webhooks
(`Clerk`, `WhatsApp`, `Mercado Pago`) — a autenticidade desses já é
garantida por verificação de assinatura + deduplicação de eventos; um rate
limiter por IP arriscaria descartar retries legítimos do provider sem
proteger contra nada que a assinatura já não cubra.

**Limitação conhecida, documentada deliberadamente**: o armazenamento do
contador é em memória, por instância do processo Node. Com uma única
instância (cenário atual/MVP no Railway), o limite é exatamente o
configurado. Com múltiplas instâncias rodando em paralelo, o limite
EFETIVO por usuário multiplica pelo número de instâncias, porque cada uma
mantém seu próprio contador — **isto não é uma garantia distribuída**.
Redis já está provisionado no `docker-compose.yml` (Fase 1) mas nenhum
código o usa hoje (ver Seção 2); se o produto crescer para múltiplas
instâncias, o storage do throttler precisa migrar para um backend
compartilhado (`@nestjs/throttler` suporta um `storage` customizado) antes
de confiar nesses limites como proteção real de escala.

Em produção, `trust proxy` é habilitado condicionalmente
(`NODE_ENV=production`) para que o rate limiter use o IP real do cliente
(via `X-Forwarded-For`, confiando exatamente um hop — o proxy da própria
plataforma), não o IP interno do proxy reverso.

### 5.2. Security headers e X-Request-Id (Fase 18)

`helmet()` (configuração default) está registrado em dois pontos
deliberadamente não-redundantes: em `AppModule.configure()` (para estar
ativo em todos os testes e2e, que nunca executam `main.ts`) e novamente em
`main.ts`, antes de `app.enableCors()` — porque o middleware de CORS
intercepta e finaliza sozinho toda requisição de preflight (`OPTIONS`)
antes dela alcançar o middleware registrado a nível de módulo. Sem o
segundo registro, um preflight OPTIONS vazava `X-Powered-By: Express`
mesmo com helmet "ativo" — achado real ao testar a imagem Docker desta
fase contra um preflight de verdade, corrigido e reverificado.

`X-Request-Id`: gerado (`crypto.randomUUID()`) ou ecoado de volta **só** se
o cliente já enviar um valor que bate com um padrão seguro para log
(alfanumérico + `-`/`_`, até 128 caracteres) — nunca usado para
autenticação/autorização, é só um rótulo de correlação. Disponível para
qualquer service via `RequestContext.getRequestId()`
(`AsyncLocalStorage`), e aparece em toda linha de log HTTP.

CSP no backend usa o default do `helmet` — seguro aqui porque esta API
nunca responde HTML (só JSON), e CSP só é interpretado pelo browser em
documentos renderizados. No **frontend** (Next.js), CSP continua
deliberadamente **não** adicionado (mesma decisão da Fase 9): a lista de
origens do Clerk só pode ser validada contra um domínio de produção real,
que este ambiente não tem. `Permissions-Policy` (novo nesta fase,
`camera=(), microphone=(), geolocation=()`) foi adicionado sem essa
ressalva — não depende de conhecer domínios externos.

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
  nenhum log imprime `Authorization`/token/`DATABASE_URL`/chaves de
  provider.
- **Log estruturado por requisição** (Fase 18, `LoggingInterceptor`): uma
  linha por requisição HTTP — método, **rota sem query string** (uma query
  string pode carregar PII, ex: `?search=email@...` em `GET /customers`),
  status, duração e `requestId`. Nível `error` só para 5xx; um 4xx
  (validação, 403 de IDOR bloqueado, etc.) é log normal, não um alerta de
  erro real.
- **Versão em execução**: `APP_VERSION` (opcional) aparece no log de
  startup — normalmente o SHA curto do commit, setado pela plataforma.
- **Erros / alertas / métricas de infraestrutura (uptime, 5xx, latência)**:
  **NÃO implementado** — exigiria uma conta numa ferramenta externa (Sentry,
  Better Stack, etc.), que não existe neste ambiente. Recomendação pra
  quando houver: Sentry (SDK do Nest é direto de integrar, plano free cobre
  o volume inicial) — documentado como próximo passo, não instalado agora
  pra não adicionar uma dependência/conta sem necessidade imediata. O
  filtro global de exceções (Fase 18, `AllExceptionsFilter`) já loga todo
  erro não tratado com stack completo e `requestId`, então uma integração
  futura com Sentry tem um único ponto de captura, não dezenas espalhados.
- **Request ID / correlation ID**: **implementado na Fase 18**
  (`requestIdMiddleware` + `AsyncLocalStorage`, nenhuma dependência nova) —
  todo response inclui `X-Request-Id` (gerado ou ecoado só se já for um
  valor seguro para log), e todo log de uma requisição (HTTP, e qualquer
  service que chame `RequestContext.getRequestId()`) carrega o mesmo valor.
  Nunca usado para autenticação/autorização. Continua útil integrar com uma
  ferramenta de log centralizada quando existir — o campo já está em todo
  lugar, só falta um lugar pra agregá-lo.

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
      `Referrer-Policy`, `X-Frame-Options`, `Strict-Transport-Security`,
      `Permissions-Policy` — este último novo na Fase 18) — testados contra
      `next start` local.
- [x] Headers de segurança no backend (Fase 18, `helmet`, default) —
      confirmado por requisição HTTP real contra a imagem Docker construída
      nesta fase, inclusive em requisições de preflight CORS.
- [ ] CSP — deliberadamente **não** adicionado no frontend (item 101: "não
      adicionar CSP quebrando Clerk/Next.js sem testar" — este ambiente não
      tem como testar contra um domínio de produção real com Clerk ativo).
      No backend, o CSP default do `helmet` está ativo (seguro: esta API só
      responde JSON, nunca HTML).
- [x] HTTPS — garantido pela plataforma (Vercel/Railway terminam TLS
      automaticamente); nenhuma configuração do lado da aplicação assume
      HTTP.
- [x] Rate limiting (Fase 18) — limite padrão global + limites dedicados em
      endpoints sensíveis a abuso; em memória/por instância, documentado
      como limitação conhecida (ver Seção 5.1) — nunca aplicado a webhooks
      ou health check.
- [x] X-Request-Id / correlation ID (Fase 18) — ver Seção 5.2 e Seção 10.
- [x] Filtro global de exceções (Fase 18) — nenhum erro não tratado vaza
      stack trace/mensagem de driver pro cliente; `HttpException`s
      intencionais passam inalteradas.
- [x] `WEB_APP_URL` obrigatória em produção (Fase 18) — a API se recusa a
      subir sem ela, nunca herda silenciosamente o default de
      desenvolvimento.
- [x] Docker HEALTHCHECK nativo (Fase 18) — confirmado `"healthy"` via
      `docker inspect` contra a imagem construída nesta fase.

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

## 16. Smoke test pós-deploy (Fase 18)

Checklist mínimo a rodar manualmente logo após qualquer deploy real (ainda
não automatizado — nenhuma ferramenta de teste end-to-end contra ambiente
implantado foi configurada nesta fase). Marcar cada item com o resultado
real, nunca assumir que "deveria funcionar":

**Infraestrutura**
- [ ] `GET https://<api>/v1/health` → `200`
- [ ] `GET https://<api>/v1/health/ready` → `200` com `database: "ok"`
- [ ] Resposta de `/v1/health` inclui `X-Request-Id` e os headers do
      `helmet` (`X-Content-Type-Options: nosniff` no mínimo)

**Produto — fluxo principal**
- [ ] Frontend abre na URL de produção
- [ ] Login via Clerk funciona (sign-in real)
- [ ] Usuário autenticado consegue navegar (não cai em loop de redirect)
- [ ] Criação/seleção de arena administrada aparece no dashboard
- [ ] Dashboard carrega (ocupação do dia)
- [ ] Criar uma quadra nova
- [ ] Configurar horário de funcionamento
- [ ] Consultar disponibilidade de uma quadra
- [ ] Criar uma reserva (cliente) de ponta a ponta
- [ ] "Minhas reservas" mostra a reserva recém-criada
- [ ] Cancelar a reserva de teste
- [ ] Lista de clientes da arena carrega
- [ ] Relatórios operacionais carregam com números plausíveis

**IA, WhatsApp e Pagamentos — teste estrutural vs. teste real**
- [ ] IA: **estrutural** — sem `AI_PROVIDER_API_KEY`, `POST .../ai/ask`
      responde `503` de forma limpa (sem 500/stack trace). **Real** — com a
      chave configurada, uma pergunta simples retorna uma resposta
      coerente e o custo aparece no painel da OpenAI.
- [ ] WhatsApp: **estrutural** — handshake `GET /v1/webhooks/whatsapp` com
      token errado retorna `403`. **Real** — com credenciais reais da
      Meta configuradas e um número de teste, enviar "oi" pelo WhatsApp
      recebe uma resposta do bot.
- [ ] Pagamento PIX: **estrutural** — sem `PAYMENT_API_KEY`, criar
      pagamento falha com erro tratado (nunca 500 cru). **Real** — com
      credenciais de sandbox do Mercado Pago, criar um pagamento PIX
      real, pagar com o QR/copia-e-cola de teste, e confirmar que o
      webhook `POST /v1/webhooks/payments/mercadopago` chega e o status
      muda para `PAID` na tela de "minhas reservas" sem recarregar a
      página manualmente (polling).

**Segurança (rápido, não substitui a suíte automatizada)**
- [ ] Uma rota autenticada sem token retorna `401`
- [ ] Uma rota de outra arena (ID forjado na URL) retorna `403`/`404`,
      nunca os dados de fato
- [ ] `OPTIONS` de uma origem não configurada não recebe
      `Access-Control-Allow-Origin`

---

## Troubleshooting

| Sintoma | Causa provável | Onde olhar |
|---|---|---|
| API não inicia, log de "Variáveis de ambiente obrigatórias ausentes" | Secret não configurado na plataforma | `apps/api/src/main.ts`, `assertRequiredEnv` |
| API não inicia, log de "Configuração de produção inválida" | `WEB_APP_URL` não configurada em produção (Fase 18) | `apps/api/src/main.ts`, `assertProductionSafety` |
| Todo enum do Prisma (`ArenaRole`, etc.) vem `undefined` | Client do Prisma não gerado corretamente na imagem | Ver Seção 4, achado #4 — confirme que o Dockerfile não foi alterado sem entender essa parte |
| `/health/ready` retorna 503 | Postgres inacessível (rede, credencial, ou banco fora do ar) | `DATABASE_URL`, conectividade de rede da plataforma até o Postgres |
| Frontend chama `localhost:3001` em produção | `NEXT_PUBLIC_API_URL` não configurada na Vercel | Env vars do projeto na Vercel, ambiente de produção |
| Login/webhook do Clerk não funciona em produção | Chaves de desenvolvimento usadas em produção, ou webhook não recadastrado pro domínio real | Ver Seção 8 |
| Cliente legítimo recebe `429` num endpoint de negócio | Limite dedicado (Fase 18, Seção 5.1) atingido — verificar se é abuso real ou um limite calibrado baixo demais para o uso real do produto | `@Throttle()` no controller do endpoint em questão |
| `429` acontece "cedo demais" com múltiplas instâncias rodando | Rate limiting é por instância (em memória) — o limite efetivo multiplica pelo número de réplicas (Fase 18, Seção 5.1) | Reduzir réplicas, ou migrar o storage do throttler para Redis antes de escalar horizontalmente |
