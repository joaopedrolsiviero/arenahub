# ArenaHub — Deploy e Infraestrutura de Produção

> Companheiro de `docs/ARCHITECTURE.md` (v0.18) — este documento é operacional
> (como implantar e operar), não arquitetural (por que o sistema é como é).
>
> **Status honesto (Fase 19, sessões em 2026-08-26/27 — smoke test de login
> validado de ponta a ponta, ver Seção 17 para o histórico completo)**: toda
> a infraestrutura real está no ar e funcionando. **Postgres gerenciado —
> IMPLEMENTADO e rodando** (addon Railway, projeto `bubbly-simplicity`);
> **frontend — IMPLEMENTADO, TESTADO e PÚBLICO**
> (`https://arenahub-xi.vercel.app`); **backend na Railway — IMPLEMENTADO,
> TESTADO e PÚBLICO** (`https://api-production-34e0.up.railway.app`,
> `/v1/health` e `/v1/health/ready` confirmados `200` reais — o bloqueio de
> build documentado numa sessão anterior não se repetiu, causa raiz nunca
> identificada com certeza). **Clerk — rodando em ambiente de
> Development, deliberadamente** (não Production): ver Seção 8 para o
> motivo (Clerk produção exige domínio próprio verificável por DNS, que
> este projeto não tem — um domínio `*.vercel.app` não serve, porque você
> não controla o DNS dessa zona). **Login + rota autenticada validados de
> ponta a ponta, ao vivo**: usuário real logou pelo Clerk (dev) no site de
> produção, o webhook `user.created`/`user.updated` do Clerk (Development,
> agora cadastrado apontando pro Railway) sincronizou o usuário no Postgres
> real, e `GET /v1/users/me/bookings` respondeu `200`.
>
> **Fase 20/21/22** (auditoria + smoke test completo de produto): núcleo do
> produto validado de ponta a ponta em produção (reserva, cancelamento,
> métricas, RBAC, isolamento entre arenas, IDOR) — sem nenhum bug
> encontrado. Ver relatórios das respectivas fases.
>
> **Fase 23 (Mercado Pago/PIX) — PAUSADA deliberadamente, bloqueio de
> ferramenta de teste (não do nosso código)**: a conta do Mercado Pago foi
> verificada e credenciais de teste reais (`TEST-...`) foram configuradas em
> produção (Railway). A partir daí, **três bugs reais foram encontrados e
> corrigidos** validando contra a API real do gateway (não só inspeção de
> código):
> 1. Corpo HTTP vazio interpretado como erro fatal no client (commit
>    `9b735a5`).
> 2. `payer.email` ausente no request — o Mercado Pago rejeitava toda
>    criação de pagamento com `500 payer_cannot_be_nil` (commit `43e1b7c`).
> 3. `checkoutUrl`/`pixCopyPaste`/`qrCodeBase64` nunca eram persistidos —
>    o Mercado Pago só devolve isso na criação, então toda consulta
>    seguinte (o polling que o frontend já fazia por design) via `null`; o
>    QR/copia-e-cola simplesmente não aparecia mesmo com o pagamento criado
>    com sucesso (commits `427c5f1` e `46e51cf`).
>
> Depois dos três fixes: pagamento PIX criado de verdade contra o Mercado
> Pago (sandbox), QR Code visual e código copia-e-cola exibidos
> corretamente na tela da reserva em produção, webhook de criação recebido
> e verificado (assinatura HMAC real). Toda a segurança/ownership (reserva
> cancelada/inexistente/de outro usuário, degradação graciosa sem
> credencial) também validada ao vivo.
>
> **O que ficou de fora nesta sessão**: a confirmação real de `PAID` via
> pagamento efetivamente completado — bloqueada pela mesma limitação do
> sandbox de teste do Mercado Pago descrita acima. **Resolvido na Fase 25**
> (ver abaixo) usando credencial de produção real em vez de insistir no
> sandbox.
>
> **Fase 25 (Confirmação Automática de Pagamento Real) — GO, comprovado ao
> vivo com dinheiro real (2026-08-28)**: com a Payments API já validada
> (Fase 23) e a máquina de estados do webhook já auditada (idempotente,
> nunca confia no corpo, sempre reconsulta o Mercado Pago — já era assim
> desde a Fase 17, nenhuma mudança de arquitetura foi necessária), o
> objetivo era só fechar a prova que faltava: **um pagamento real chegando
> a `approved` e o ArenaHub reconhecendo isso sozinho**. O sandbox de teste
> continuou bloqueado pela mesma limitação da Fase 23/24 (conta de teste
> não completa verificação de documento no app), então — com autorização
> explícita do usuário — a credencial de `PAYMENT_API_KEY`/
> `PAYMENT_WEBHOOK_SECRET` em produção foi trocada de teste (`TEST-...`)
> para **produção real** (`APP_USR-...`), e um PIX de **R$1,00** foi pago de
> verdade. Achado real no caminho: a conta precisava de uma **chave PIX
> ativada** (erro do Mercado Pago `"Collector user without key enabled for
> QR render"`) — resolvido pelo usuário ativando uma chave na própria
> conta, não um bug de código. Depois disso: pagamento criado, webhook
> recebido, assinatura validada, `PaymentsService` consultou o Mercado Pago
> de verdade e aplicou `PAID` sozinho, frontend refletiu "confirmado", e o
> estado sobreviveu a um reload completo da página — tudo sem qualquer
> aprovação manual. **Decisão de produto**: a credencial de produção
> **permanece ativa deliberadamente** (não foi revertida pra `TEST-...`) —
> a partir de agora, qualquer pagamento real no ArenaHub gera cobrança de
> verdade. Ver Seção 19 para o relatório completo.
>
> **Fase 26 (Jornada Completa do Cliente) — GO (2026-08-28/29)**: auditoria
> mostrou que quase toda a jornada (descoberta de arena → data → quadra →
> disponibilidade → reserva → pagamento → minhas reservas → detalhes →
> cancelamento) já estava implementada e correta desde as Fases 1-18.
> Nenhuma mudança de arquitetura. Só 3 lacunas reais foram fechadas: status
> do pagamento agora aparece na lista "Minhas reservas" (endpoint novo
> `GET /v1/users/me/payments`, sem N+1), texto explicativo pro estado
> `EXPIRED` do pagamento, e aviso honesto (sem inventar política) de que
> cancelar uma reserva já paga não gera reembolso automático. Ver Seção 20.
>
> **Fase 24 (migração pra Orders API) — TENTADA e REVERTIDA deliberadamente,
> produção usa a Payments API (clássica) de novo**: ver Seção 0.3 pro
> relato completo. Resumo: a Orders API tem, sim, um mecanismo oficial de
> auto-aprovação de PIX em sandbox (`payer.first_name: "APRO"` + um Test
> User genuíno) — **comprovado real, com evidência ao vivo** (pedido
> transicionou de `action_required`/`waiting_transfer` pra
> `processed`/`accredited` em segundos, via chamada real à API). Mas essa
> validação exige uma credencial de teste que **só aceita `payer.email`
> terminado em `@testuser.com`** — rejeitando qualquer cliente real com
> `400`. Não existe, nesta conta, uma credencial que sirva ao mesmo tempo
> pra (a) aceitar clientes reais e (b) permitir a auto-aprovação de teste.
> Além disso, a assinatura do webhook da Orders API nunca validou
> corretamente (ver Seção 0.3) apesar de o secret estar comprovadamente
> correto. Migrar teria quebrado o PIX pra clientes reais — revertido de
> volta pra Payments API (a mesma validada desde a Fase 17/23), confirmada
> funcionando de novo (criação real 201, QR real, webhook de criação
> aceito com `200`) antes de fechar a fase.

---

## 0.2. Fase 20 (Production Readiness & Go-Live Validation) — auditoria, sem novo deploy

Auditoria de "sistema publicado" → "produção tecnicamente pronta pra go-live", sem
adicionar funcionalidade nova. Nenhuma operação destrutiva foi executada contra o
banco de produção. Resultado geral: **GO COM RESSALVAS** — ver o relatório final
da fase para a classificação completa. Resumo por categoria:

**VALIDADO REALMENTE** (contra a infraestrutura de verdade, nesta fase):
- `/v1/health` e `/v1/health/ready` respondendo `200` reais, banco conectado.
- CORS: origem da Vercel aceita, origem desconhecida bloqueada — testado ao vivo.
- Rota autenticada sem token → `401` seguro, sem vazar detalhe interno.
- Headers de segurança (`helmet`, CSP, HSTS, `X-Request-Id`) presentes em resposta real.
- Migrations aplicadas no banco de produção: confirmado via log real do Pre-Deploy
  Command da Railway (`9 migrations found`, `No pending migrations to apply.`) — não
  foi possível rodar `prisma migrate status` diretamente daqui porque o Postgres da
  Railway só é alcançável de dentro da rede privada da própria Railway (postura de
  segurança correta, não uma falha).
- Nenhuma credencial de OpenAI/Mercado Pago/WhatsApp está configurada no ambiente de
  produção do backend (Railway) — confirmado listando as variáveis reais do serviço.
- Nenhum segredo real versionado no Git — confirmado por busca no repositório (a
  única ocorrência de uma chave real da OpenAI está em `apps/api/.env`, arquivo local
  nunca rastreado pelo Git).
- Suíte de testes completa (ver relatório final da fase para os números).

**VALIDADO ESTRUTURALMENTE** (por código/teste automatizado, não contra o serviço externo real):
- Rate limiting (Fase 18) — coberto por teste e2e que dispara 429 de verdade
  localmente; não foi reexercitado contra produção nesta fase para não gerar carga
  desnecessária.
- Tratamento de erro de IA/pagamento/WhatsApp sem credencial configurada (503/erro
  tratado, nunca 500 cru) — coberto pelos testes unitários/e2e de cada provider.

**BLOQUEADO / PENDENTE**:
- Clerk Production — depende de domínio próprio (Seção 8).
- Fluxo completo de reserva e áreas do dashboard em produção — depende da decisão de
  produto sobre autocadastro de arena (Parte 2 do relatório da fase); nenhum dado de
  teste foi criado em produção nesta fase até essa decisão ser tomada.
- OpenAI, Mercado Pago, WhatsApp reais — sem credencial configurada em produção.
- Backup do Postgres gerenciado — não verificável via CLI da Railway; precisa
  conferir manualmente no dashboard (projeto `bubbly-simplicity` → serviço
  `Postgres` → aba **Backups**).
- CI/CD — workflow inalterado e correto por inspeção de código; status das
  execuções mais recentes não verificável nesta sessão (repositório privado, sem
  `gh` autenticado).

**Bug real encontrado e corrigido nesta fase**: `AppModule.configure()` registrava o
middleware global (Fase 18) com `forRoutes('*')` — sintaxe antiga do
`path-to-regexp` que gerava um `WARN` de depreciação do Express em todo boot de
produção (`"Unsupported route path... /v1/*"`). Funcionava (o Nest converte
automaticamente), mas poluía o log sem necessidade. Corrigido para `forRoutes('{*path}')`
(sintaxe nomeada que a versão atual já espera direto), revalidado pela suíte e2e
inteira (o middleware de correlação/segurança é exercitado em todo teste).

---

## 0.3. Fase 24 (migração pra Orders API) — tentada, revertida, causa raiz documentada

**Resultado: NO-GO pra migração (código voltou pra Payments API); evidência real
de aprovação automática em sandbox foi obtida separadamente.** Ver relatório
final da fase (entregue no chat) para a classificação completa nos 20 itens
exigidos pelo prompt. Resumo técnico:

**Por que migrar**: a Payments API clássica (usada desde a Fase 17) não tem
nenhum mecanismo oficial de sandbox pra simular a aprovação de um PIX de
teste — confirmado via documentação oficial. Era exatamente o gap que
bloqueou a confirmação de `PAID` na Fase 23.

**O que foi encontrado, com evidência real**:
- A Orders API (`/v1/orders`) **tem** esse mecanismo: `payer.first_name:
  "APRO"` + um Test User genuíno do Mercado Pago (criado via
  `POST /users/test_user`) faz um pedido PIX transicionar sozinho de
  `action_required`/`waiting_transfer` pra `processed`/`accredited` em
  poucos segundos — sem nenhuma ação manual. **Confirmado ao vivo, duas
  vezes**, inclusive uma vez através do próprio `MercadoPagoPaymentProviderService`
  do ArenaHub (não só via `curl` direto).
- A Orders API **rejeita credenciais `TEST-` categoricamente**, em qualquer
  chamada (`401 invalid_credentials`, mensagem oficial: "Test credentials
  are not supported, use test users with production credentials..."). Isso
  só foi descoberto testando contra a API real — a documentação não deixa
  isso óbvio de antemão.
- A única combinação que de fato funcionou (criar uma aplicação nova,
  `Checkout Transparente via Orders`, usando a credencial da aba "Teste"
  dela) tem uma restrição que **inviabiliza uso em produção real**: essa
  credencial exige `payer.email` terminado em `@testuser.com` pra
  **qualquer** criação de pedido — um cliente real do ArenaHub, com e-mail
  de verdade, recebe `400 invalid_email_for_sandbox`.
- A assinatura do webhook (`X-Signature`) da Orders API **nunca validou
  corretamente**, apesar de exaustivamente investigado: manifesto
  reproduzido byte a byte conforme a documentação oficial; secret
  regenerado do zero (eliminando cópia obsoleta); confirmado, via cálculo
  HMAC independente, que o app rodando em produção usava exatamente o
  mesmo secret configurado no Railway; hipótese de case-sensitivity do ID
  testada e descartada; hipótese de encoding do secret (string vs. bytes
  decodificados de hex) testada e descartada; espera de propagação
  testada e descartada. Causa raiz não identificada — aparenta ser uma
  particularidade não documentada do produto "Webhooks" mais novo do
  Mercado Pago (distinto da tela clássica de notificações por IPN), não
  um erro no código do ArenaHub.

**Decisão**: migrar teria deixado o PIX real quebrado pra todo cliente
(nenhuma credencial disponível serve simultaneamente pra clientes reais E
pra validação de sandbox). Revertido via commit `1f273ee` — o provider
voltou a ser exatamente o da Fase 23 (`/v1/payments`), sem nenhuma mudança
de schema, de `PaymentsService` ou de `PaymentsWebhookService` (a
abstração `PaymentProvider` se manteve estável o tempo todo). Restaurado
`PAYMENT_API_KEY`/`PAYMENT_WEBHOOK_SECRET` pra os valores da aplicação
original, e **revalidado ao vivo depois do revert**: criação de pagamento
real (`201`, `pending`, QR/`ticket_url` reais) e webhook de criação aceito
com `200` (assinatura válida) — o mesmo comportamento documentado como
funcionando desde a Fase 23.

**Pendência real pra uma futura tentativa de migração**: só faz sentido
retomar a Orders API se (a) o suporte do Mercado Pago confirmar por que a
assinatura do webhook não bate mesmo com o secret certo, e (b) existir uma
credencial de teste que aceite e-mails de clientes reais nas chamadas de
criação (hoje não existe, nesta conta, uma combinação assim).

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

- **Frontend**: Vercel — **IMPLEMENTADO, TESTADO e PÚBLICO** (Fase 19):
  `https://arenahub-xi.vercel.app`, projeto `arenahub` (scope
  `fraagelos-projects`). Confirmado carregando sem erros de console numa aba
  limpa, e confirmado autenticando de verdade contra o Clerk (Development —
  ver Seção 8).
- **Backend**: container Docker (`apps/api/Dockerfile`) — **IMPLEMENTADO,
  TESTADO e PÚBLICO** (Fase 19): `https://api-production-34e0.up.railway.app`,
  projeto Railway `bubbly-simplicity`, serviço `api`. `/v1/health` e
  `/v1/health/ready` confirmados `200` reais contra o deploy ao vivo. A falha
  de build documentada numa sessão anterior desta mesma fase (todo deploy
  falhando em `BUILD_IMAGE`) não se reproduziu nas verificações mais
  recentes — a causa raiz nunca foi identificada com certeza (não sabemos se
  foi um problema transitório da plataforma ou algo que se autocorrigiu).
- **Banco**: PostgreSQL gerenciado — **IMPLEMENTADO e TESTADO** (Fase 19):
  addon oficial do Railway, projeto `bubbly-simplicity`, rodando.
  `DATABASE_URL` da API referencia o addon (`${{Postgres.DATABASE_URL}}`),
  nunca um valor copiado à mão. Migrations confirmadas aplicadas (o backend
  não estaria saudável em `/health/ready` nem sincronizaria usuários reais
  sem elas).
- **Autenticação**: Clerk — ambiente de **Development em uso real em
  produção, deliberadamente** (Fase 19). O ambiente de Production foi criado
  mas está **bloqueado**: Clerk exige um domínio próprio verificável por DNS
  para produção, e este projeto só tem domínios temporários da
  plataforma (`*.vercel.app`/`*.up.railway.app`), cujo DNS pertence à
  própria Vercel/Railway, não a você — ver Seção 8 para o detalhe completo e
  o que fazer quando houver um domínio próprio. O webhook de sincronização
  de usuário (`user.created`/`user.updated` → tabela `User`) está cadastrado
  no ambiente Development apontando pro Railway, e foi validado com um
  evento real (assinatura verificada, `200`, usuário sincronizado).
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

> **Atualização (Fase 19)**: o usuário autorizou o Hobby plan (US$5/mês) e o
> upgrade foi feito de verdade. Projeto Railway: `bubbly-simplicity`
> (workspace "João Pedro Lopes Siviero's Projects"). Dois serviços
> provisionados: `Postgres` (addon oficial, **rodando** —
> `postgres.railway.internal:5432`, referenciado pela API via
> `${{Postgres.DATABASE_URL}}`, nunca um valor copiado à mão) e `api`
> (conectado a `fraagelo/arenahub`, branch `main`, deploy automático a cada
> push). Domínio público gerado: `api-production-34e0.up.railway.app`.
>
> **Atualização (sessão seguinte, mesma Fase 19): `api` está rodando.**
> `/v1/health` e `/v1/health/ready` respondem `200` reais, o serviço
> aparece `Online` (`railway status`), e logs de boot aparecem normalmente
> (`railway logs --service api`). A falha de `BUILD_IMAGE` acima nunca foi
> diagnosticada com certeza — pode ter sido um problema transitório da
> plataforma, ou pode ter sido resolvido pelas duas correções já feitas
> (`prisma` em `dependencies`, `railway.json`/config do serviço). Não
> reproduza nem "conserte" isso de novo sem antes confirmar que o serviço
> está de fato fora do ar (`railway status`/`GET /v1/health`) — o problema
> pode simplesmente não existir mais.
>
> Duas coisas já foram corrigidas nesta sessão que valem para qualquer
> retomada:
> 1. `apps/api/package.json` — `prisma` (CLI) movido de `devDependencies`
>    para `dependencies`: sem isso, a imagem de produção (`pnpm deploy
>    --prod`, que exclui devDependencies) não tem o binário `prisma` para
>    rodar `migrate deploy` no Pre-Deploy Command. Bug real, não cosmético.
> 2. O `railway.json` (raiz do repo) **não é aplicado automaticamente** pelo
>    Railway para o serviço `api` já existente — confirmado via API
>    (`serviceInstance.dockerfilePath` continuava `null` mesmo com o arquivo
>    commitado). O CLI avisa que Config as Code está sendo descontinuado a
>    favor de `.railway/railway.ts` (que exige o pacote npm `railway`, não
>    instalado — decisão desta sessão foi não adicionar essa dependência só
>    por isso). Os valores reais em uso hoje foram setados diretamente via
>    mutation GraphQL (`serviceInstanceUpdate`) — se o serviço for recriado do
>    zero, replique manualmente: `dockerfilePath=apps/api/Dockerfile`,
>    `healthcheckPath=/v1/health`, `healthcheckTimeout=300`,
>    `preDeployCommand=["npx prisma migrate deploy"]`,
>    `restartPolicyType=ON_FAILURE`, `restartPolicyMaxRetries=10`.

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

> **Atualização (Fase 23 — Mercado Pago e Pagamento via PIX de Ponta a Ponta,
> sessões em 2026-08-27, PAUSADA — bloqueio de ferramenta de teste, não do
> nosso código)**:
>
> **Bug real #1** (encontrado antes de haver qualquer credencial): a tela de
> "minhas reservas" mostrava "Não foi possível carregar o pagamento" mesmo
> sem nenhuma tentativa de pagamento ainda existir. Causa raiz: quando
> `PaymentsController.getPayment` retorna `null` (nenhuma tentativa ainda), o
> NestJS devolve um corpo HTTP **literalmente vazio** (`Content-Length: 0`),
> nunca a string JSON `"null"`. Um `fetch().json()` real de navegador lança
> `SyntaxError` nesse caso — o teste e2e existente nunca pegou isso porque o
> supertest normaliza corpo vazio pra `{}` sozinho (`response.body`),
> mascarando o comportamento real. Corrigido em `apps/web/src/lib/api.ts`
> (commit `9b735a5`): `request()` agora lê o corpo como texto antes de
> tentar `JSON.parse`, tratando vazio como `null`.
>
> **Validado ao vivo em produção, sem precisar de credencial real** (todas
> essas checagens acontecem ANTES de qualquer chamada ao gateway):
> - Criar pagamento pra reserva já cancelada → `409`, nenhum pagamento criado.
> - Criar pagamento pra reserva inexistente → `404`, nenhuma informação vazada.
> - Usuário B tentando criar OU LER o pagamento da reserva do usuário A →
>   `404` nos dois casos (nunca 403 — mesma disciplina anti-enumeração do
>   resto do produto), testado com uma segunda identidade real do Clerk.
> - Criar pagamento numa reserva válida, própria, sem `PAYMENT_API_KEY`
>   configurada → `201` com `status: "FAILED"`,
>   `failureReason: "PROVIDER_ERROR"` — nunca um 500 cru, degrada
>   graciosamente exatamente como projetado.
>
> **Credenciais de teste reais configuradas** (sessão seguinte, conta
> Mercado Pago já verificada): aplicação criada no painel de developers
> (Checkout Transparente → API de Pagamentos, a mesma que o código já
> implementava — não a API de Orders, mais nova, que exigiria reescrever a
> integração), `PAYMENT_API_KEY` (`TEST-...`) e `PAYMENT_WEBHOOK_SECRET`
> configurados direto no Railway pelo usuário (nunca passaram pelo Claude).
>
> **Bug real #2**: toda criação de pagamento passou a responder `500` do
> lado do Mercado Pago com `"payer_cannot_be_nil"`. O request nunca incluía
> o objeto `payer` — `PaymentProviderCreateRequest` ganhou `payerEmail`,
> `PaymentsService` busca o e-mail do `User` (já validado como dono da
> Booking) antes de chamar o provider. Corrigido no commit `43e1b7c`,
> confirmado ao vivo (pagamento passou a ser criado com sucesso).
>
> **Bug real #3**: mesmo com o pagamento criado, nem o código PIX
> copia-e-cola nem o QR Code apareciam na tela. Causa raiz: o Mercado Pago
> só devolve `qr_code`/`qr_code_base64`/`ticket_url` na resposta da
> **criação** — nunca numa consulta de status. Como `PaymentsService` nunca
> persistia esses valores (só `providerPaymentId`), toda consulta seguinte
> (o polling que `useBookingPayment` já fazia por design, seguindo o
> princípio "frontend sempre reflete o estado do backend, nunca confia em
> resposta de mutation guardada em memória") devolvia `null` pros três
> campos. `Payment` ganhou as colunas `checkoutUrl`/`pixCopyPaste`/
> `qrCodeBase64` (migrations não-destrutivas), persistidas na criação e
> devolvidas em toda consulta subsequente. Corrigido nos commits `427c5f1`
> (copia-e-cola/link) e `46e51cf` (QR Code visual, campo `qr_code_base64`
> que o Mercado Pago já devolvia mas nunca era capturado). Confirmado ao
> vivo: QR Code e copia-e-cola aparecem corretamente na reserva em
> produção depois de "Pagar com PIX".
>
> **RESOLVIDO na Fase 25** (2026-08-28) — ver Seção 19 para o relatório
> completo. Resumo: o sandbox nunca foi destravado (mesmo bloqueio de
> sempre), mas com autorização explícita do usuário a credencial de
> produção real (`APP_USR-...`) foi ativada e um PIX de R$1,00 foi pago de
> verdade, fechando o ciclo completo `approved → webhook → PAID`
> automaticamente. A credencial de produção permanece ativa por decisão de
> produto (não foi revertida pra `TEST-...`).
>
> Texto original desta seção, mantido como histórico do que foi tentado
> antes da Fase 25:
>
> Para fechar o ciclo (confirmar `PAID` de verdade via webhook), é preciso
> efetivamente pagar o PIX de teste com uma conta "compradora" do Mercado
> Pago. A interface **web** do Mercado Pago recusa pagar via Pix Copia e
> Cola ("Abra o app no celular pra pagar" — bloqueio deliberado deles, não
> nosso). No **app** de celular, a conta de teste compradora criada no
> painel de developers pede verificação de documento ao logar — e falha,
> porque é uma conta fake sem CPF real por trás. Webhook de **criação** foi
> recebido e teve a assinatura verificada com sucesso (confirmado nos logs
> reais da Railway); o webhook de **aprovação** nunca chegou a ser
> exercitado porque nenhum pagamento real/de teste foi efetivamente
> completado.

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

## 8. Clerk em produção — BLOQUEADO por falta de domínio próprio; Development em uso real

> **Achado real desta fase**: o ambiente de Production do Clerk foi criado
> (clonado do Development), e por engano a Vercel ficou configurada
> primeiro com as chaves de Development, depois foi corrigida pra
> `pk_live_`/`sk_live_` reais. **Com as chaves de produção, o site inteiro
> (`/sign-in`, `/sign-up`) ficou em branco.** Causa raiz confirmada: a
> `pk_live_` do Clerk tem embutido o domínio do "Frontend API" exigido pelo
> ambiente de produção (`clerk.arenahub.vercel.app`, decodificável do
> próprio valor da chave em base64) — testado com `curl` direto nesse host:
> a conexão TLS é recusada (nenhum certificado válido ali). Clerk exige, pra
> rodar em produção, um domínio que você registre com um provedor de DNS de
> verdade e onde você adicione os registros CNAME que o próprio Clerk
> fornece (Dashboard → Configure → Domains). Um subdomínio `*.vercel.app` ou
> `*.up.railway.app` **não serve** pra isso — o DNS dessas zonas pertence à
> Vercel/Railway, você não tem como adicionar um CNAME lá.
>
> **Decisão tomada (reversível a qualquer momento)**: voltamos
> deliberadamente as chaves da Vercel e do Railway para o ambiente de
> **Development** do Clerk (`pk_test_`/`sk_test_`), que não tem essa
> exigência de domínio — funciona em qualquer host, inclusive
> `*.vercel.app`. Isso restaurou o site ao funcionamento normal. **Esta é a
> configuração real em uso em produção hoje**, uma limitação conhecida, não
> escondida — ver a tabela de diferenças abaixo antes de considerar isso
> aceitável pro seu caso.
>
> **Webhook de sincronização de usuário, agora correto para o Development**:
> como o webhook de Production apontava só pro ambiente que não está em
> uso, foi cadastrado um NOVO endpoint no ambiente **Development** do Clerk,
> apontando pra `https://api-production-34e0.up.railway.app/v1/webhooks/clerk`
> (eventos `user.created`/`user.updated`/`user.deleted`), com seu próprio
> Signing Secret (cada endpoint de webhook tem o seu — nunca é o mesmo
> "secret do ambiente" reaproveitado). **Validado com um evento real**:
> editar um campo do usuário de teste no dashboard do Clerk disparou
> `user.updated`, a assinatura HMAC verificou, o backend respondeu `200`, e
> o `upsert` em `UsersService.syncFromClerkEvent` criou a linha que faltava
> — confirmado por `GET /v1/users/me/bookings` passar de `404`
> ("Usuário autenticado ainda não sincronizado") para `200`.

### Development vs. Production do Clerk — o que muda na prática

| | Development (em uso hoje) | Production (bloqueado) |
|---|---|---|
| Domínio exigido | Qualquer um, sem verificação | Domínio próprio com DNS verificado |
| Limites de uso | Baixos (é ambiente de teste) | Do seu plano pago |
| Base de usuários | Separada da de produção | Separada da de dev |
| Marca/e-mails | Indicador "modo dev", e-mails com marca do Clerk | Sem indicador, e-mails customizáveis |

### Passo a passo para migrar para Production quando houver domínio próprio

1. Registrar um domínio de verdade (qualquer provedor: Registro.br, Namecheap etc.).
2. Apontar esse domínio pra Vercel (domínio customizado do projeto).
3. No Clerk (ambiente Production) → Configure → Domains: adicionar esse
   domínio, copiar os registros CNAME fornecidos, adicioná-los no DNS do
   provedor do domínio, aguardar a verificação do Clerk.
4. Copiar as chaves de produção (`pk_live_...`/`sk_live_...`) para:
   - `apps/web` (Vercel, env Production): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
   - `apps/api` (Railway): `CLERK_SECRET_KEY`.
5. Cadastrar um NOVO endpoint de webhook no ambiente Production apontando
   pra `https://<api-de-produção>/v1/webhooks/clerk`, copiar o *Signing
   Secret* desse endpoint específico pra `CLERK_WEBHOOK_SIGNING_SECRET` na
   API (Railway).
6. Configurar as URLs permitidas (sign-in/sign-up/redirect) pro domínio real
   de produção do frontend.
7. Redeploy do frontend (Vercel — `NEXT_PUBLIC_*` é embutido em build time,
   trocar a env var sozinha não basta) e restart do backend (Railway já
   reinicia sozinho ao salvar uma variável).
8. Repetir o smoke test de login (Seção 16) contra as chaves novas.

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
- [x] `GET https://<api>/v1/health` → `200` — **validado real** (Fase 19,
      `api-production-34e0.up.railway.app`)
- [x] `GET https://<api>/v1/health/ready` → `200` com `database: "ok"` —
      **validado real**
- [x] Resposta de `/v1/health` inclui `X-Request-Id` e os headers do
      `helmet` (`X-Content-Type-Options: nosniff` no mínimo) — **validado
      real**

**Produto — fluxo principal**
- [x] Frontend abre na URL de produção — **validado real**
      (`arenahub-xi.vercel.app`)
- [x] Login via Clerk funciona (sign-in real) — **validado real**, com o
      Clerk em ambiente Development (ver Seção 8) — usuário real logou no
      site de produção
- [x] Usuário autenticado consegue navegar (não cai em loop de redirect) —
      **validado real**: `GET /v1/users/me/bookings` responde `200`, sem
      loop, depois do webhook de sincronização estar correto (ver Seção 8)
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

## 17. Handoff — histórico da Fase 19 (sessões 2026-08-26/27)

Esta fase trocou de máquina/sessão várias vezes. Histórico condensado pra
quem retomar não repetir investigação já feita:

### Estado final desta fase (o que importa pra continuar)
- GitHub + CI: inalterado, já era real desde a Fase 9.
- Railway: projeto `bubbly-simplicity`, Hobby plan ativo, Postgres addon e
  serviço `api` **rodando** — `/v1/health`/`/v1/health/ready` validados
  reais. A falha de build de uma sessão anterior (abaixo) não se repetiu.
- Vercel: projeto `arenahub` (scope `fraagelos-projects`), frontend
  **público e funcionando** em `https://arenahub-xi.vercel.app`.
- Clerk: rodando em **Development** deliberadamente (chaves `pk_test_`/
  `sk_test_` na Vercel e no Railway) — ver Seção 8 pro motivo (Production
  exige domínio próprio verificado por DNS, que este projeto não tem).
  Webhook de sincronização de usuário cadastrado no ambiente Development,
  apontando pro Railway, **validado com evento real**.
- Login + `GET /v1/users/me/bookings` **validados de ponta a ponta, ao
  vivo**, com um usuário real.
- `apps/api/package.json`: `prisma` movido pra `dependencies` (bug real,
  necessário pro Pre-Deploy Command rodar migrations em produção) —
  correção permanente, mantida.

### Linha do tempo do que foi investigado (contexto, não pendência)

**1. Chaves do Clerk na Vercel estavam em Development por engano** — uma
sessão anterior copiou de `apps/web/.env.local` sem notar que ainda eram as
de dev. Corrigido pra `pk_live_`/`sk_live_` reais — e isso **quebrou o
site** (telas de login/cadastro em branco). Investigado e encontrada a
causa raiz real: o Clerk de produção exige um domínio próprio verificado
por DNS (a `pk_live_` tem embutido `clerk.arenahub.vercel.app`, que não
resolve com certificado válido — testado com `curl` direto). Decisão:
reverter pra Development até haver domínio próprio (ver Seção 8, que tem o
passo a passo completo de como migrar quando houver domínio).

**2. Ao reverter pra Development, "minhas reservas" continuou quebrada**
— mas com um erro diferente (`404`, não mais problema de chave). Causa:
o webhook de sincronização de usuário (`user.created`) só estava cadastrado
no ambiente **Production** do Clerk, nunca no Development — então o login
funcionava (é só client-side), mas nenhuma linha de `User` era criada no
Postgres, e qualquer chamada autenticada ao backend caía no
`NotFoundException` documentado em `UsersService.findByClerkId`
("Usuário autenticado ainda não sincronizado"). Corrigido cadastrando um
webhook novo no ambiente Development apontando pro Railway, com o Signing
Secret **daquele endpoint específico** (nunca o "secret do ambiente" — cada
endpoint de webhook do Clerk tem o seu próprio) em
`CLERK_WEBHOOK_SIGNING_SECRET` no Railway. Validado disparando um
`user.updated` manual (editar um campo do usuário de teste no dashboard do
Clerk) — o `upsert` em `syncFromClerkEvent` criou a linha que faltava.

**3. A falha de build do Railway (`BUILD_IMAGE` em ~4s, sem log útil)
documentada numa sessão anterior não se reproduziu** nas verificações mais
recentes — o serviço está `Online` e saudável. Causa raiz nunca confirmada
com certeza (pode ter sido as duas correções já aplicadas — `prisma` em
`dependencies` e a config do `dockerfilePath`/`healthcheckPath` setada via
API — ou algo transitório da própria plataforma). Se o problema
reaparecer, ver o registro histórico completo que ficava aqui antes desta
atualização (disponível no histórico do Git deste arquivo).

### Nota operacional: `.vercel/project.json` não é versionado

`.vercel` está no `.gitignore` (raiz e `apps/web`) por convenção do próprio
Vercel CLI — não contém segredo, só `projectId`/`orgId`. Em qualquer máquina
nova, rodar (da raiz do repo, não de dentro de `apps/web` — o CLI duplica o
Root Directory se rodado de dentro do subdiretório, foi um erro real cometido
nesta sessão):

```bash
vercel link --yes --project arenahub
```

antes de qualquer `vercel deploy`/`vercel env`. Idem para `railway link -p
bubbly-simplicity` do lado do Railway.

---

## 18. Handoff — Fase 24 (troca de máquina, 2026-08-28)

Sessão trocando de máquina ao final da Fase 24. Estado real pra quem
retomar não repetir investigação já feita — ver Seção 0.3 pro relato
técnico completo.

### Estado da produção agora (confirmado ao vivo antes de encerrar)
- **Provider de pagamento**: Payments API clássica (`/v1/payments`), a
  mesma validada desde a Fase 17/23 — **não** a Orders API (tentada e
  revertida nesta fase).
- **`PAYMENT_API_KEY`** (Railway, serviço `api`): restaurado pra
  credencial de teste (`TEST-...`) da aplicação **original** do Mercado
  Pago — a mesma usada desde a Fase 23. **Não** é a credencial da
  aplicação nova `arenahub2` (essa só serve pra experimentos com Orders
  API, nunca deixe configurada em produção — rejeita e-mail de cliente
  real).
- **`PAYMENT_WEBHOOK_SECRET`** (Railway): restaurado pro secret do
  webhook da aplicação **original**, cadastrado apontando pra
  `https://api-production-34e0.up.railway.app/v1/webhooks/payments/mercadopago`.
  Revalidado com uma chamada real: pagamento real criado, webhook de
  criação recebido e aceito com `200`.
- **`PAYMENT_SANDBOX_TEST_PAYER_NAME`**: variável que chegou a existir no
  Railway durante os experimentos desta fase, mas **não é lida por nenhum
  código depois do revert** (só existia na implementação da Orders API,
  que foi revertida) — inofensiva se ainda estiver configurada, pode ser
  removida por limpeza, não é urgente.
- Nenhuma migration nova, nenhuma mudança de schema.

### Coisas que existem na conta do Mercado Pago, sem uso em produção
- Uma aplicação nova, `arenahub2` (tipo "Checkout Transparente via
  Orders"), com um webhook cadastrado que **nunca validou
  corretamente** (Bug 2 da Seção 14 do relatório da Fase 24). Pode ficar
  ou ser removida — não afeta nada em produção.
- Um Test User (`test_user_...@testuser.com`) criado via
  `POST /users/test_user` — usado como e-mail de uma conta de teste do
  Clerk (Development) pra validar a auto-aprovação da Orders API. Também
  pode ficar.

### Se uma futura sessão quiser retomar a migração pra Orders API
Não repita a investigação do zero — ela já foi longa e bem documentada
(Seção 0.3 e relatório final da Fase 24, seções 5/7/14/18). Resumo do que
falta resolver antes de tentar de novo:
1. Descobrir por que a assinatura do webhook (`X-Signature`) da Orders
   API nunca bate, mesmo com o secret confirmado correto (considere abrir
   chamado com o suporte oficial do Mercado Pago).
2. Encontrar (ou confirmar que não existe) uma credencial desta conta que
   aceite `payer.email` de cliente real **e** permita a auto-aprovação de
   sandbox via `payer.first_name: "APRO"` — hoje essas duas coisas são
   mutuamente exclusivas.

### Continuidade de código/ambiente local (pouco a fazer desta vez)
Sem migrations novas e sem mudança de schema — um `git pull` simples é
suficiente. Rotina padrão de sempre ao trocar de máquina:
```bash
git pull
pnpm install
pnpm --filter @arenahub/api prisma generate
```
Docker local (Postgres/Redis) só precisa estar rodando se for trabalhar
com os testes e2e ou o backend localmente — nada mudou nesse setup nesta
fase.

---

## 19. Fase 25 — Confirmação Automática de Pagamento Real (2026-08-28)

### Objetivo
Comprovar de ponta a ponta que, quando o Mercado Pago aprova um pagamento
de verdade, o ArenaHub reconhece isso **automaticamente**, sem qualquer
aprovação manual do OWNER/ADMIN — usando a Payments API já validada
(Fase 17/23), sem migrar para Orders API (tentativa da Fase 24, revertida).

### O que já estava implementado (auditoria, nenhuma mudança precisou)
- **`Booking` nunca depende de `Payment`** (decisão documentada desde a
  Fase 4) — toda reserva já nasce `CONFIRMED`, independente de pagamento.
  Não existe, e não foi criado, um estado de "reserva pendente de
  aprovação". Confirmado explicitamente com o usuário antes de qualquer
  código (a interpretação literal do prompt da fase sugeria o contrário).
- Webhook (`payments-webhook.service.ts`): valida assinatura HMAC-SHA256
  (`timingSafeEqual`), deduplica por `providerEventId` (claim-first),
  **nunca confia no `status` do corpo** — sempre chama
  `paymentProvider.getPaymentStatus()` pra buscar o estado real antes de
  aplicar qualquer transição.
- Máquina de estados (`PaymentsService.applyProviderStatus`): só transiciona
  a partir de `PENDING` (estados terminais protegidos — evento antigo nunca
  reverte um `PAID`/`FAILED`/`CANCELLED`/`EXPIRED`), concorrência tratada
  (`updateMany` condicional + índice único parcial "um PAID por Booking"),
  `Booking` cancelada antes da aprovação vira `CANCELLED` em vez de `PAID`.
- `PaymentsController`: **nenhum `@Body()` em nenhuma rota** — estruturalmente
  impossível o cliente forjar `amount`/`status`/`payer.email`; tudo vem do
  `Booking.total` congelado e do `User` resolvido via JWT do Clerk.
- Frontend (`useBookingPayment`): já faz polling de 5s **só enquanto
  `PENDING`**, para sozinho ao atingir qualquer estado terminal — nenhum
  polling agressivo precisou ser adicionado.

### O que foi adicionado nesta fase
- 2 casos de teste e2e explícitos que faltavam (Caso 2 — status `PENDING`
  do provider nunca é tratado como pago; Caso 3 — `FAILED`/recusado nunca
  vira `PAID`), + 1 unit test equivalente. Nenhuma mudança de comportamento,
  só cobertura formal do que o código já fazia.

### Teste real de ponta a ponta — GO, com dinheiro real
O sandbox de teste continuou bloqueado pela mesma limitação da Fase 23/24
(conta de teste "comprador" nunca completa a verificação de documento no
app do Mercado Pago). Com autorização explícita do usuário, o caminho foi
outro: usar uma credencial de **produção real**.

1. `PAYMENT_API_KEY`/`PAYMENT_WEBHOOK_SECRET` (Railway, serviço `api`)
   trocados de teste (`TEST-...`) para produção (`APP_USR-...`) — ambos
   colados direto no dashboard do Railway pelo usuário, nunca vistos pelo
   Claude.
2. **Primeira tentativa: `400`** — `"Collector user without key enabled
   for QR render"`. Causa real: a conta do Mercado Pago não tinha nenhuma
   chave PIX ativada (requisito da própria conta pra receber PIX via API
   em produção, não um bug de código). Resolvido pelo usuário ativando uma
   chave PIX na conta.
3. **Segunda tentativa: pagamento criado com sucesso** — mas o secret de
   webhook configurado era o de **modo de teste**, não o de **modo de
   produção** (são cadastros/secrets separados no painel do Mercado Pago).
   O pagamento foi pago de verdade (R$1,00) mas o webhook nunca validou —
   ficou como uma cobrança real recebida sem confirmação no ArenaHub (o
   dinheiro não se perdeu, ficou no saldo da própria conta do usuário).
   Corrigido cadastrando o webhook na aba "Modo de produção" e atualizando
   o secret.
4. **Terceira tentativa (nova Booking, novo Payment): sucesso completo**.
   Evidência real, passo a passo:
   - `Payment` criado no Mercado Pago real (log:
     `Pagamento criado no Mercado Pago em 1025ms`).
   - Usuário pagou R$1,00 de verdade pelo próprio banco.
   - Webhook chegou (`POST /v1/webhooks/payments/mercadopago` → `200`,
     assinatura válida).
   - `MercadoPagoPaymentProviderService`: `Status consultado no Mercado
     Pago em 273ms` — o backend confirmou o `approved` consultando o
     Mercado Pago diretamente, nunca confiando no corpo do webhook.
   - `Payment` mudou pra `PAID` automaticamente — nenhuma ação manual do
     OWNER/ADMIN em nenhum momento.
   - Frontend, após reload manual da página (`Ctrl+F5`), continuou
     mostrando o pagamento confirmado — estado vem sempre do backend.

### Limpeza pós-teste
- Log de debug temporário (capturava o corpo do erro `400` do Mercado
  Pago pra diagnóstico) revertido — nunca logou credencial, só a resposta
  de erro do provider.
- **Decisão de produto do usuário**: a credencial de **produção real
  permanece ativa** deliberadamente (não foi revertida pra `TEST-...`) —
  a partir de 2026-08-28, qualquer pagamento real no ArenaHub gera
  cobrança de verdade. Próximo pagamento real só deve ser iniciado pelo
  usuário.
- `PAYMENT_SANDBOX_TEST_PAYER_NAME` (variável órfã da Fase 24, sem uso no
  código) continua no Railway, inofensiva — segue não sendo urgente
  remover.

### Testes automatizados (números reais, após todas as mudanças)
- Backend unit: **384/384** (30 suítes)
- Backend e2e: **311/333** — a única falha é `invitation-flow.e2e-spec.ts`
  (22 testes), problema pré-existente do ambiente local, confirmado
  reproduzindo até no commit já publicado antes de qualquer mudança desta
  fase (`git stash` + teste direto no baseline, Fase 23). `payments.e2e-spec.ts`:
  **27/27** (25 anteriores + 2 novos desta fase).
- Frontend unit: **128/128** (19 suítes)
- Lint: 0 erros, 1 aviso pré-existente (`no-img-element` no QR Code)
- Typecheck: limpo
- Build: verde

---

## 20. Fase 26 — Jornada Completa do Cliente (2026-08-28/29)

### Objetivo
Transformar o fluxo técnico comprovado na Fase 25 (pagamento real →
`approved` → webhook → `PAID` automático) numa jornada de cliente coerente
de ponta a ponta: descobrir arena → escolher data/quadra/horário → reservar
→ pagar → ver confirmação → consultar depois.

### Auditoria — quase tudo já existia (Fases 1-18)
Antes de qualquer código, a jornada inteira foi mapeada. Resultado: a
maior parte já estava implementada e correta —

| Etapa | Estado antes da Fase 26 |
|---|---|
| Descoberta de arena (`/arenas`) | ✅ Completo |
| Escolha de data (Luxon, timezone da arena) | ✅ Completo |
| Escolha de quadra | ✅ Completo |
| Disponibilidade (backend é a única fonte de verdade) | ✅ Completo |
| Criação de reserva (idempotência + concorrência) | ✅ Completo |
| Resumo antes de reservar (`BookingSummaryCard`) | ✅ Completo |
| Pagamento PIX (QR/copia-cola/polling 5s) | ✅ Completo |
| "Minhas reservas" (próximas/histórico/canceladas) | ✅ Completo |
| Detalhes da reserva | ✅ Completo |
| Cancelamento | ✅ Completo |
| Responsividade (Tailwind `sm:`/`md:`/`lg:` consistente) | ✅ Completo |
| **Status do pagamento na lista "Minhas reservas"** | ❌ Faltava — só mostrava status da reserva |
| Texto explicativo do estado `EXPIRED` do pagamento | ⚠️ Faltava (FAILED/CANCELLED já tinham) |
| Aviso ao cancelar uma reserva já paga | ⚠️ Faltava (nenhuma menção ao Payment no dialog) |

Nenhuma mudança de arquitetura foi necessária ou feita: `Booking` continua
`CONFIRMED` desde a criação, sem novo estado `PENDING_PAYMENT`; nenhuma
migration; Payments API preservada integralmente.

### O que foi implementado (só as lacunas reais)

1. **Status do pagamento em "Minhas reservas"** — endpoint novo
   `GET /v1/users/me/payments` (`MyPaymentsController`, dentro de
   `PaymentsModule`) devolve um mapa `{ bookingId: status }` da tentativa de
   pagamento mais recente de cada reserva do usuário, numa única query
   (`distinct: ['bookingId']` + `orderBy: createdAt desc`, sem N+1). Vive em
   `PaymentsModule` (não em `BookingsModule`) deliberadamente — a mesma
   regra "`Booking` nunca depende de `Payment`" da Fase 4 também vale pro
   grafo de módulos do Nest, não só pro modelo de dados; `BookingsModule` já
   é importado por `PaymentsModule`, então o inverso criaria um ciclo.
   Frontend busca essa lista em paralelo com `useMyBookings` (`useMyPaymentStatuses`)
   e mescla por `bookingId` — `BookingCard` agora mostra os dois badges
   (`BookingStatusBadge` + `PaymentStatusBadge`) lado a lado quando há
   pagamento associado.
2. **Texto explicativo pro estado `EXPIRED`** na tela de detalhes — "O
   prazo para pagar esse PIX expirou. Tente pagar novamente." (mesmo padrão
   já usado por FAILED/CANCELLED).
3. **Aviso no dialog de cancelamento** quando a reserva já tem um `Payment`
   `PAID`: "Esta reserva já está paga — o cancelamento não gera reembolso
   automático." Não inventa nenhuma política nova (reembolso, crédito,
   prazo) — só descreve honestamente o que o sistema já faz hoje (nada:
   `BookingsService.cancel` nunca tocou em `Payment`, auditado nesta fase).
   **Pendência explícita, não resolvida aqui**: se/quando o produto quiser
   uma política de reembolso de verdade, é uma fase própria — fora de
   escopo da Fase 26 por decisão do prompt.

### O que foi confirmado como já correto (nenhuma mudança)
- "Confirmação automática": o `PaymentStatusBadge` (verde, com ícone de
  check, texto "Pago") já aparece automaticamente via polling de 5s assim
  que o webhook aplica `PAID` — sem botão de confirmar, sem página de
  confirmação separada. Considerado suficiente pra clareza exigida (item
  11/13 do prompt) sem adicionar uma tela nova.
- Nenhum mass assignment possível: `PaymentsController` continua sem
  `@Body()` em nenhuma rota.
- IDOR: o novo endpoint de resumo também foi testado (usuário A nunca vê
  o status de pagamento de uma reserva do usuário B).

### Testes adicionados
- Backend: 1 novo `describe` em `payments.service.spec.ts`
  (`getLatestPaymentStatusesForUser`, 4 casos) + 1 novo `describe` e2e em
  `payments.e2e-spec.ts` (3 casos, incluindo IDOR do endpoint novo).
- Frontend: 1 novo teste em `minhas-reservas/page.test.tsx` (badge de
  pagamento aparece/some corretamente) + 1 novo teste em
  `minhas-reservas/[bookingId]/page.test.tsx` (aviso de reembolso no
  dialog de cancelamento).

### Testes automatizados (números reais, após todas as mudanças)
- Backend unit: **388/388** (30 suítes)
- Backend e2e: **314/336** — única falha continua sendo
  `invitation-flow.e2e-spec.ts` (22 testes), pré-existente e não
  relacionada (mesma causa confirmada desde a Fase 23).
- Frontend unit: **130/130** (19 suítes)
- Lint: 0 erros, 1 aviso pré-existente
- Typecheck: limpo
- Build: verde

### Teste manual em produção
Verificação feita contra dados reais já existentes da Fase 25 (o pagamento
de R$1 aprovado), **sem gerar nenhuma cobrança nova**: usuário confirmou
visualmente que o badge "Pago" passou a aparecer em "Minhas reservas" ao
lado do badge "Confirmada" da reserva.

### Incidente real da Railway durante o deploy (2026-08-29)
O primeiro deploy desta fase (commit `0ee8501`) **travou em "BUILDING" e
nunca foi promovido** — o container antigo (Fase 25) continuou servindo
tráfego o tempo todo (por isso `/v1/health/ready` respondia normal mesmo
com o código novo nunca tendo entrado no ar; health check sozinho não é
prova de que o código certo está rodando). `curl` direto na rota nova
(`GET /v1/users/me/payments`) devolvendo `404` em vez de `401` foi o que
expôs o problema de verdade.

Causa confirmada via `status.railway.com`: incidente ativo da própria
Railway, **"Deployments slow to start"** (Degraded Performance,
`Investigating`, iniciado 28/08 23:59 UTC, múltiplas regiões) — não
relacionado ao código do ArenaHub. Duas tentativas de redeploy adicionais
também ficaram lentas (uma chegou a levar mais de 30min entre build e
promoção), até a terceira tentativa (`91efecb8`) finalmente completar e
ser promovida com sucesso. Confirmado depois via boot log real
(`MyPaymentsController {/v1/users/me/payments}: mapped`) e `curl` (`401`,
não mais `404`) — nunca só pelo health check.

**Lição registrada**: depois de qualquer deploy que adicione uma rota
nova, verificar a rota específica (ou o boot log), não só
`/v1/health/ready` — um health check verde não prova que o deployment
certo está ativo quando a plataforma tem um incidente de promoção lenta.

### Pendências reais (nenhuma inventada)
- Política de cancelamento/reembolso pra reservas já pagas — hoje não
  existe nenhuma (nem reembolso, nem bloqueio de cancelamento); a Fase 26
  só tornou isso visível na UI, não implementou uma política nova.
- Testes de componente ainda faltando (pré-existente, não é regressão
  desta fase): `apps/web/src/app/arenas/[arenaId]/page.tsx` (escolha de
  quadra) e alguns componentes (`arena-card`, `court-card`,
  `dashboard-date-nav`) não têm `.test.tsx` próprio.
- `PAYMENT_SANDBOX_TEST_PAYER_NAME` (variável órfã da Fase 24 no Railway)
  continua sem uso — segue não sendo urgente remover.

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
| Telas de login/cadastro em branco depois de trocar pra chaves `pk_live_`/`sk_live_` | Clerk produção exige domínio próprio verificado por DNS — um domínio `*.vercel.app`/`*.up.railway.app` não serve | Ver Seção 8 — reverter pra Development até haver domínio próprio, ou completar a verificação de domínio no Clerk |
| Login funciona mas qualquer chamada autenticada ao backend retorna 404 "Usuário autenticado ainda não sincronizado" | Webhook `user.created`/`user.updated` do Clerk não está cadastrado (ou está com o Signing Secret errado) para o ambiente do Clerk realmente em uso | Cadastrar/corrigir o webhook nesse ambiente específico (Seção 8) — cada endpoint tem seu próprio Signing Secret, nunca reaproveite o de outro endpoint |
| Cliente legítimo recebe `429` num endpoint de negócio | Limite dedicado (Fase 18, Seção 5.1) atingido — verificar se é abuso real ou um limite calibrado baixo demais para o uso real do produto | `@Throttle()` no controller do endpoint em questão |
| `429` acontece "cedo demais" com múltiplas instâncias rodando | Rate limiting é por instância (em memória) — o limite efetivo multiplica pelo número de réplicas (Fase 18, Seção 5.1) | Reduzir réplicas, ou migrar o storage do throttler para Redis antes de escalar horizontalmente |
| Cliente real recebe erro ao tentar pagar PIX, `PAYMENT_API_KEY` começa com `APP_USR-` | Credencial da aplicação `arenahub2` (só-teste, exige `payer.email` `@testuser.com`) configurada por engano em produção | Trocar `PAYMENT_API_KEY` de volta pra credencial `TEST-...` da aplicação original (Seção 18) |
| Webhook do Mercado Pago sempre `403`, secret conferido e correto | Conhecido só pra Orders API (`/v1/orders`) — causa raiz nunca identificada apesar de investigação exaustiva (Fase 24, Seção 0.3) | Não reproduz na Payments API clássica (`/v1/payments`), que é a que está em produção — se voltar a acontecer nela, é um bug novo, investigar do zero |
