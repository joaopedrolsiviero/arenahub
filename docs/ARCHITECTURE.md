# ArenaHub — Documento de Arquitetura Inicial (v0.18)

> Status: **arquitetura geral aprovada**, em implementação incremental por fases (Fase 1 — Setup,
> Fase 2 — Autenticação, Fase 3 — Arenas/Quadras, Fase 4 — Disponibilidade e Booking, Fase 5 —
> Horários de Funcionamento e Timezone, Fase 6 — Experiência de Reserva do Cliente, Fase 7 —
> Dashboard Operacional da Arena, Fase 8 — Hardening/Segurança/Robustez, Fase 10 — Gestão de
> Membros/RBAC Operacional, Fase 11 — Convites de Equipe e Transferência Segura de Ownership,
> Fase 12 — Assistente de IA Operacional, Fase 13 — Customer Booking Lifecycle, Fase 14 —
> Customer & Arena Client Management, Fase 15 — Operational Reports & Analytics, Fase 16 —
> WhatsApp + Assistente de Reservas Controlado, Fase 17 — Pagamentos e Ciclo de Vida Financeiro e
> Fase 18 — Production Readiness, Observabilidade e Hardening Final já concluídas; Fase 9 — Deploy e
> Infraestrutura preparada, GitHub/CI validados contra um runner real, deploy real no Railway
> bloqueado por custo (Hobby plan pago) e Vercel/Clerk produção por falta de acesso — ver Roadmap e
> `docs/DEPLOYMENT.md`).
> Esta revisão (v0.18) registra as decisões tomadas durante a Fase 18 — uma auditoria e hardening de
> produção transversal (rate limiting, security headers, correlation ID, filtro global de exceções,
> `trust proxy`, HEALTHCHECK do Docker, `WEB_APP_URL` obrigatória em produção), sem nenhuma
> funcionalidade de produto nova. Este documento é a fonte de verdade da arquitetura até que decisões
> aqui descritas sejam revisadas.

---

## Decisões revisadas na v0.18

Resumo das mudanças desta revisão (Fase 18 — Production Readiness, Observabilidade e Hardening
Final). Detalhe completo na seção "Fase 18" do Roadmap abaixo.

1. **Rate limiting introduzido pela primeira vez** (`@nestjs/throttler`, em memória, por instância) —
   decisão explícita de NÃO introduzir Redis só para isto (ver Parte "Redis" em
   `docs/DEPLOYMENT.md`, Seção 2): a garantia é por instância, documentada como limitação conhecida,
   não uma falsa promessa de garantia distribuída. Limite padrão global generoso + limites dedicados
   fixos no código para os endpoints mais sensíveis a abuso (IA, pagamentos, convites, reservas,
   disponibilidade, clientes, relatórios). Webhooks e health check nunca são limitados — a
   autenticidade deles já vem de assinatura + deduplicação, nunca de limite de taxa por IP.
2. **Correlation ID (`X-Request-Id`) implementado sem dependência nova** — `AsyncLocalStorage`
   nativo do Node carrega o `requestId` por toda a árvore de chamadas assíncronas de uma requisição,
   sem precisar injetar o `Request` do Express em nenhum service (`AiService`/`PaymentsService`
   continuam puros). Reverte a decisão da v0.9 de não implementar isso ainda — na época não havia
   pra onde correlacionar; agora, o log estruturado por requisição (item 3) é esse destino.
3. **Log estruturado por requisição** (`LoggingInterceptor`, global) — uma linha por requisição HTTP
   com método, rota (nunca query string — pode carregar PII), status, duração e `requestId`. Erros
   4xx (tráfego normal do produto) logados em nível `log`; só 5xx vira `error`.
4. **Filtro global de exceções** (`AllExceptionsFilter`) como rede de segurança — nunca a primeira
   linha de defesa (cada service já trata os próprios erros esperados desde as fases anteriores),
   mas garante que um erro não previsto nunca vaza stack trace ou mensagem interna do Prisma/driver.
5. **`WEB_APP_URL` passou a ser obrigatória em produção** — antes tinha um default de desenvolvimento
   (`http://localhost:3000`) que podia silenciosamente "vazar" para um deploy de produção mal
   configurado. Agora o processo se recusa a subir em produção sem ela.
6. **Security headers no backend via `helmet`** (defaults) — registrado tanto em
   `AppModule.configure()` (para ficar ativo em todos os testes e2e) quanto em `main.ts` antes do
   CORS (porque o middleware de CORS finaliza sozinho requisições de preflight antes delas
   alcançarem o middleware a nível de módulo — achado real corrigido nesta fase).
7. **`trust proxy` condicional em produção** — sem isso, o rate limiter (item 1) atrás do proxy da
   plataforma trataria todo cliente como o mesmo IP.
8. **Docker HEALTHCHECK nativo** (`node -e`, sem dependência nova) contra `/v1/health` (liveness,
   nunca `/health/ready` — uma falha temporária do Postgres não deve fazer o orquestrador reiniciar
   o container em loop).
9. **Nenhuma vulnerabilidade nova de multi-tenant/IDOR/mass assignment encontrada** na auditoria
   transversal desta fase sobre Pagamentos/Clientes/Relatórios (Fases 14/15/17) — a cobertura
   existente desde a Fase 8 (`hardening.e2e-spec.ts`) e os specs dedicados de cada fase já
   exercitavam isso.
10. **Nenhum segredo real versionado encontrado** na auditoria de segredos desta fase (busca por
    padrões de chave/token no repositório inteiro).
11. **Roadmap não precisou ser renumerado** — "Fase 18" é a próxima entrada natural depois da Fase 17.

---

## Decisões revisadas na v0.17

Resumo das mudanças desta revisão (Fase 17 — Pagamentos e Ciclo de Vida Financeiro). Detalhe
completo na seção "Fase 17" do Roadmap abaixo.

1. **Booking e Payment são conceitos diferentes, de propósito** — `Booking.status` continua só
   `CONFIRMED`/`CANCELLED` (ocupação da quadra); `Payment.status` é um ciclo financeiro à parte
   (`PENDING`/`PAID`/`FAILED`/`EXPIRED`/`CANCELLED`). Isso é um desvio deliberado do placeholder
   original desta fase (que previa `BookingStatus` ganhando `PENDING`/`EXPIRED` como hold) —
   registrado explicitamente, não silenciosamente.
2. **Valor sempre do backend**: `Payment.amount` é copiado de `Booking.total` (já congelado desde a
   Fase 4) — o endpoint de criação não aceita `amount`/`status`/`currency` do cliente (nem declara
   um corpo aceito).
3. **Cardinalidade evoluída conscientemente**: de "1—1, 0 ou 1 no MVP" (sugestão original da Parte 7,
   pré-implementação) para "1—N tentativas, no máximo 1 `PAID`" — garantido por um índice único
   parcial (`Payment_bookingId_single_paid`), mesma técnica do único-OWNER de arena (Fase 10).
4. **Máquina de estados com um único estado não-terminal** (`PENDING`) — todos os outros são
   definitivos, via CAS condicionado a `status: PENDING` (mesmo padrão do CAS de cancelamento da
   Fase 13). Resolve webhooks fora de ordem sem depender da ordem real de chegada.
5. **Idempotência sem mecanismo novo**: a mesma técnica "claim-first" de `IdempotencyKey`
   (Fase 4)/`WhatsAppEvent` (Fase 16), aplicada à própria tabela `Payment`
   (`@@unique([bookingId, idempotencyKey])`) — não uma segunda tabela. A chamada ao gateway
   acontece FORA de qualquer transação Prisma.
6. **Webhook nunca confia no próprio corpo** — sempre busca o status real de volta no provider pelo
   `data.id` antes de aplicar qualquer transição (`PaymentProvider.getPaymentStatus`).
7. **Integração com cancelamento**: Booking cancelada com Payment ainda `PENDING` faz uma
   confirmação `PAID` posterior virar `CANCELLED`, nunca `PAID`. Nenhum refund foi implementado —
   limitação documentada, não fingida.
8. **Gateway escolhido: Mercado Pago (PIX)** — sandbox acessível sem CNPJ e assinatura de webhook
   HMAC compatível com o padrão já usado por Clerk/WhatsApp. Nenhuma integração real validada nesta
   fase (sem credenciais no ambiente) — testado com `FakePaymentProvider`.
9. **WhatsApp/IA nunca escrevem em `Payment`** — nenhuma intenção de pagamento foi adicionada ao
   classificador do WhatsApp; `PaymentsService` é exportado só para um consumidor futuro.
10. **Roadmap não precisou ser renumerado** — "Fase 17 — Pagamentos" já ocupava esse número desde a
    v0.15 (como placeholder); esta revisão substitui o placeholder pela implementação real.

---

## Decisões revisadas na v0.16

Resumo das mudanças desta revisão (Fase 16 — WhatsApp + Assistente de Reservas Controlado). Detalhe
completo na seção "Fase 16" do Roadmap abaixo.

1. **WhatsApp é só mais um canal de entrada, nunca uma segunda implementação do domínio**:
   `WhatsAppModule` reaproveita literalmente `BookingsService` (criação/cancelamento, mesmo lock/
   EXCLUDE constraint/CAS), `AvailabilityService`, `ArenasService.discoverOne` e `AiProvider`
   (exportado de `AiModule`) — nunca uma query, um cálculo de preço/disponibilidade ou uma chamada
   de LLM duplicados.
2. **A IA só classifica intenção — nunca responde ao cliente diretamente**: a única saída do modelo
   é um JSON fechado (`WhatsAppIntentService`), validado contra um schema fixo. Todo texto que o
   cliente recebe vem de templates centralizados (`messages.ts`). Principal defesa contra prompt
   injection: mesmo um modelo manipulado só produz `UNKNOWN`, nunca alcança o cliente como prosa
   livre nem influencia `arenaId`/`userId`/preço (nunca enviados ao nem lidos do modelo).
3. **Datas/horários nunca calculados pelo modelo** — o LLM extrai só a frase bruta; toda a
   aritmética é determinística (`nlp.util.ts`), e a maior parte da conversa (seleção numérica,
   confirmação) nunca chama o modelo.
4. **Identidade do cliente reaproveita `User.phone`** (já sincronizado do Clerk desde a Fase 2,
   agora `@unique`) — nenhuma tabela de identidade paralela. Identidade da arena via novo campo
   `Arena.whatsappPhoneNumberId` (identificador estável da Meta, nunca comparação de telefone).
5. **Estado da conversa é autoridade do backend** (`WhatsAppConversation`, nova model — um estado
   explícito por par arena+cliente) — o LLM nunca decide nem lembra o que está sendo confirmado.
6. **Confirmação explícita com TTL de 15 minutos** — resposta precisa ser EXATA ("sim", "confirmo"),
   nunca um match parcial; confirmação expirada exige recomeçar.
7. **Idempotência em duas camadas**: dedup de evento do webhook (`WhatsAppEvent`, nova model) +
   `Idempotency-Key` já existente na criação de reserva (chave gerada uma vez, nunca por retry).
8. **Duas migrations novas**: `WhatsAppConversation`/`WhatsAppEvent` (novas tabelas),
   `Arena.whatsappPhoneNumberId` e `User.phone` (`@unique`) — nenhum dado existente violava as
   novas constraints.
9. **Nenhuma integração real validada** — sem credenciais de produção da Meta neste ambiente,
   testado com `FakeWhatsAppProvider`/`FakeAiProvider`. Ver `docs/DEPLOYMENT.md`.
10. **Roadmap não precisou ser renumerado** — "Fase 16 — WhatsApp" já ocupava esse número desde a
    v0.15 (como placeholder); esta revisão só substitui o placeholder pela implementação real.

---

## Decisões revisadas na v0.15

Resumo das mudanças desta revisão (Fase 15 — Operational Reports & Analytics). Detalhe completo na
seção "Fase 15" do Roadmap abaixo.

1. **Fonte única de verdade, literal, não só conceitual**: `ReportsModule` importa `AiModule` e
   reaproveita a MESMA instância de `OperationalMetricsService` (exportada de lá) — não uma segunda
   cópia da lógica de receita/ocupação/demanda/comparação. `ReportsService` é uma camada fina de
   orquestração/apresentação: resolve o período, chama `getMetrics()` (atual e anterior) e
   `buildComparison()`, e só reformata o resultado — nunca recalcula nada.
2. **Uma capacidade genuinamente nova foi adicionada a `OperationalMetricsService` (não duplicada
   em outro lugar)**: série diária (`dailySeries`) — os mesmos números do `summary`, quebrados por
   dia civil da arena. Implementada reaproveitando um novo `operationalMinutesByDay()` (do qual o
   `operationalMinutes()` da Fase 12 passou a ser só a soma), nunca um segundo cálculo de minutos
   operacionais.
3. **Dois presets novos no período**: `thisMonth`/`lastMonth`, adicionados a `PeriodPreset` no
   mesmo método central (`resolvePeriod`) — os presets já existentes desde a Fase 12 mantêm o
   mesmo comportamento; a IA nem precisa saber que os novos existem (ela valida contra sua própria
   lista fixa em `AskAiPeriodDto`).
4. **Novo campo de comparação**: `cancelledBookingsDeltaPct` em `PeriodComparison` — mesma função
   `percentDelta` já usada pelos outros três deltas (`null`, nunca `0` ou `Infinity`, quando a base
   do período anterior é zero).
5. **Disciplina null vs. zero estendida à série diária**: um dia sem nenhum horário de
   funcionamento configurado tem `occupancyRate: null` nesse ponto específico da série — nunca `0%`
   forjado, mesmo que outros dias do mesmo período tenham capacidade real.
6. **Um endpoint novo, só leitura**: `GET /v1/arenas/:arenaId/reports` (`ReportsModule`), aceitando
   `preset` OU `from`/`to` via query string (nunca os dois juntos, mesma regra de
   `resolvePeriod`), `OWNER`/`ADMIN`-only via `@RequireArenaRole` — reaproveitando
   `ClerkAuthGuard`/`ArenaAccessGuard` sem nenhuma modificação.
7. **Nenhuma migration nova** — a fase não introduz nenhuma query nova: `ReportsService` chama
   literalmente a mesma `OperationalMetricsService.getMetrics()` já auditada nas Fases 12-14 (índice
   único parcial em `Court(arenaId, name)` cobre o filtro por arena; `Booking(courtId, startsAt)`
   cobre o restante). Nenhum índice novo foi necessário.
8. **Sem lib de gráficos nova**: visualizações (evolução diária, demanda por horário) construídas
   com SVG/CSS simples, decorativas (`aria-hidden`), sempre acompanhadas de uma tabela textual
   equivalente com os mesmos dados — decisão justificada pelo baixo volume de dados (no máximo 92
   pontos por série, período máximo já limitado desde a Fase 12) e por evitar uma dependência nova
   só para poucas barras.
9. **Roadmap renumerado**: "Fase 15 — WhatsApp" do roadmap anterior virou Fase 16; Pagamentos
   deslocado para Fase 17. Esta fase (Operational Reports & Analytics) não existia no roadmap
   original.

---

## Decisões revisadas na v0.14

Resumo das mudanças desta revisão (Fase 14 — Customer & Arena Client Management). Detalhe completo
na seção "Fase 14" do Roadmap abaixo.

1. **"Cliente da arena" é uma visão derivada, nunca uma entidade nova**: usuário com pelo menos uma
   `Booking` `type=CUSTOMER` numa quadra da arena. Sem migration — mesma técnica de "estado
   derivado" já usada em `ArenaInvitation` (Fase 11) e nas métricas da IA (Fase 12): nunca um dado
   que possa dessincronizar do que já existe em `User`/`Booking`.
2. **Três endpoints novos, todos só leitura**: `GET /v1/arenas/:arenaId/customers` (lista, com busca
   e paginação), `GET .../customers/:userId` (resumo agregado) e `GET .../customers/:userId/bookings`
   (histórico) — módulo novo (`CustomersModule`), reaproveitando `ClerkAuthGuard`/`ArenaAccessGuard`/
   `RequireArenaRole(OWNER, ADMIN)` sem nenhuma modificação.
3. **Isolamento por arena é absoluto**: toda agregação é filtrada por `court: { arenaId }` — um
   usuário com reservas em duas arenas tem métricas calculadas de forma totalmente independente em
   cada uma (nunca somadas). Validado com um cliente real (`João`) com reservas em duas arenas
   diferentes, confirmando que os totais nunca se misturam.
4. **Sem N+1**: a listagem usa duas chamadas `groupBy` (agregação no próprio Postgres) sempre
   delimitadas pela página atual — nunca uma query por cliente. Primeira paginação da API
   (`page`/`limit`, teto de 50), documentada como decisão nova desta fase.
5. **Receita segue exatamente a regra da Fase 12**: soma de `Booking.total` só de
   `CUSTOMER`+`CONFIRMED` — `CANCELLED` nunca entra na receita, mas entra no total de reservas.
6. **PII minimizada**: só `name`/`email` do `User` são expostos — nunca `clerkId`, nunca telefone
   (existe no schema desde a Fase 2, mas não foi adicionado a nenhuma resposta desta fase por não
   haver necessidade operacional comprovada).
7. **Nenhuma migration nova.**
8. **IA da Fase 12 permanece inalterada** — nenhuma pergunta específica de cliente foi adicionada
   (ex: "quanto o João gastou?"); isso fica para uma decisão futura específica sobre PII na IA.

---

## Decisões revisadas na v0.13

Resumo das mudanças desta revisão (Fase 13 — Customer Booking Lifecycle). Detalhe completo na seção
"Fase 13" do Roadmap abaixo.

1. **Auditoria como entrega principal**: a fase pedia consolidar o ciclo de vida do CUSTOMER
   (disponibilidade → criação → "minhas reservas" → detalhe → cancelamento), e a auditoria
   obrigatória encontrou que quase tudo isso já existia, correto, desde a Fase 6 — inclusive o
   modelo de acesso exato que o prompt desta fase pedia (CUSTOMER nunca precisa ser `ArenaMember`;
   identidade sempre do Clerk/`User`, nunca de um `userId` do corpo; `404` em vez de `403` pra não
   vazar existência de reserva alheia). Nada disso foi reescrito.
2. **Única correção de código: `BookingsService.cancel` ganhou proteção CAS real contra corrida
   concorrente.** O `update` incondicional virou `updateMany` condicionado a `status: CONFIRMED`
   (mesmo padrão já usado no aceite de convite e na transferência de ownership da Fase 11) — a
   idempotência sequencial (cancelar 2x em chamadas separadas) já funcionava antes; o que faltava
   era a corrida real entre duas requisições simultâneas.
3. **Cancelamento não usa `Idempotency-Key`, por decisão explícita** — diferente da criação, cujo
   retry sem proteção criaria dois registros, cancelar converge pro mesmo estado terminal por
   natureza da máquina de estados. Exigir o header aqui seria uma restrição nova sem proteger
   contra nada que o CAS já não resolvesse.
4. **Ausência de janela/prazo de cancelamento, reafirmada** — decisão já registrada na Fase 6, não
   inventada agora: continua não havendo prazo mínimo de antecedência para cancelar.
5. **Nova prova de integração real entre Fase 13 (ciclo de vida) e Fase 12 (métricas)**: um
   cancelamento de verdade, através dos endpoints reais, remove a reserva da receita/ocupação
   vistas pelo assistente de IA no mesmo instante — não só a fórmula isolada (já testada desde a
   Fase 12), mas a composição ponta a ponta.
6. **Nenhuma migration nova** — nenhum campo, índice ou tabela precisou mudar.
7. **Frontend sem nenhuma alteração** — `/minhas-reservas` e `/minhas-reservas/:bookingId`
   (Fase 6) já cumpriam 100% dos requisitos de UI desta fase, auditoria confirmada.
8. **Roadmap renumerado**: "Fase 13 — WhatsApp" do roadmap anterior virou Fase 14; Pagamentos
   deslocado para Fase 15. Esta fase (Customer Booking Lifecycle) não existia no roadmap original.

---

## Decisões revisadas na v0.12

Resumo das mudanças desta revisão (Fase 12 — Assistente de IA Operacional). Detalhe completo na
seção "Fase 12" do Roadmap abaixo.

1. **Escopo redefinido em relação ao placeholder anterior do roadmap**: a v0.11 tinha "Fase 12 —
   IA" descrevendo um agente com tools de escrita (`create_booking`/`cancel_booking`). O prompt
   desta fase substituiu isso por um assistente deliberadamente **só leitura/análise** — a
   capacidade de agir continua descrita como "visão futura" (Parte 3), mas sem fase numerada até
   ser retomada. Não foi uma contradição silenciada: registrada explicitamente aqui e na seção do
   roadmap.
2. **Provider escolhido em conjunto com o usuário: OpenAI (`gpt-4o-mini`)** — nenhuma decisão firme
   preexistia (a menção anterior a OpenAI era só para a visão futura maior, escopo diferente).
   `AiProvider` é uma abstração (classe abstrata) com um único adapter real
   (`OpenAiAiProviderService`, `fetch` nativo, sem SDK novo) — trocar de provider é só trocar o
   `useClass` registrado em `AiModule`.
3. **A IA nunca recebe acesso direto ao banco nem gera SQL** — o backend
   (`OperationalMetricsService`) calcula toda métrica via Prisma/Postgres; só um contexto
   estruturado (JSON, sem PII, sem IDs internos) é enviado ao modelo. O modelo interpreta números
   já prontos, nunca calcula agregações a partir de texto bruto sozinho.
4. **Comparação de período é sempre calculada pelo backend** (período atual + período anterior de
   mesma duração + deltas percentuais, `null` nunca `0`/`Infinity` quando não há base) — a IA nunca
   precisa inferir "aumentou quanto %" por conta própria.
5. **Definições de métrica documentadas explicitamente**: ocupação = minutos ocupados por
   `CUSTOMER`+`CONFIRMED` ÷ minutos operacionais (só quadras ativas, `null` quando não há horário
   configurado); receita estimada = soma de `Booking.total` só de `CUSTOMER`+`CONFIRMED` — nunca
   `BLOCK`/`MAINTENANCE`/`CANCELLED`.
6. **Prompt injection: o que foi provado estruturalmente vs. o que não foi validado.** Testes provam
   que o contexto nunca vaza dado de outra arena e que o system prompt sempre carrega as regras de
   defesa — mas a resistência *semântica* de um modelo real da OpenAI a um prompt malicioso não foi
   testada neste ambiente (sem `AI_PROVIDER_API_KEY` real). Os testes e2e usam um `AiProvider` fake,
   nunca registrado em produção.
7. **Sem rate limiting persistente** — mesma decisão e mesmo motivo da Fase 11 (convites): um
   contador em memória seria descartado a cada redeploy. Mitigado parcialmente por limite de
   tamanho de pergunta (500 caracteres) e de período explícito (máximo 92 dias).
8. **Sem histórico de conversa persistido** (stateless: pergunta → contexto atual → resposta) e
   **nenhuma migration nova** — todas as métricas vêm de tabelas já existentes desde as Fases 4/5/7.
9. **Roadmap NÃO foi renumerado desta vez** — Fase 12 já era "IA" (mesmo que com outro escopo);
   Fase 13 (WhatsApp) e Fase 14 (Pagamentos) mantêm os números da v0.11, com uma ressalva anotada na
   Fase 13 sobre a dependência não resolvida das tools de escrita.

---

## Decisões revisadas na v0.11

Resumo das mudanças desta revisão (Fase 11 — Convites de Equipe e Transferência Segura de
Ownership). Detalhe completo na seção "Fase 11" do Roadmap abaixo.

1. **Convites implementados como módulo novo** (`InvitationsModule`), diferente da Fase 10 (que
   reaproveitou o `ArenaMembersModule`) — convite é uma entidade com ciclo de vida próprio
   (pendente/aceito/revogado/expirado), não uma variação de `ArenaMember`. A **transferência de
   ownership**, por outro lado, opera diretamente sobre linhas de `ArenaMember` já existentes — foi
   adicionada ao `ArenaMembersModule` existente, não a um módulo novo.
2. **Token de convite: só o hash é persistido, nunca o token em si.** `crypto.randomBytes(32)` em
   base64url (256 bits) vira o token enviado por e-mail; `ArenaInvitation.tokenHash` guarda apenas
   `sha256(token)`. Nenhuma resposta de API — nem a de criação, nem a de listagem — jamais devolve o
   token puro; a única forma dele existir é no e-mail (ou, em dev, no log do
   `ConsoleInvitationEmailService`).
3. **Status do convite é derivado, nunca uma coluna própria** — `PENDING`/`ACCEPTED`/`REVOKED`/
   `EXPIRED` são calculados em tempo de leitura a partir de `acceptedAt`/`revokedAt`/`expiresAt`.
   Evita um campo de enum que pudesse dessincronizar dos timestamps que já carregam a mesma
   informação.
4. **Aceite e transferência de ownership são atômicos via `updateMany` condicional + checagem de
   `count`**, não lock pessimista — mesmo espírito de defesa em camadas da Fase 4 (booking), mas
   resolvido no nível do Prisma: um `UPDATE` condicionado ao estado atual (`acceptedAt: null` /
   `role: 'OWNER'` atual) naturalmente falha (`count: 0`) para a segunda tentativa concorrente,
   graças ao MVCC de linha do Postgres. Validado com testes reais de concorrência
   (`Promise.all` de duas requisições HTTP simultâneas contra Postgres real), não simulado.
5. **Identidade do e-mail do aceitante vem do `User.email` local (já sincronizado do Clerk via
   webhook), nunca de um campo enviado pelo cliente** — a única forma de um e-mail chegar ali é
   através do fluxo de sincronização já auditado na Fase 2, fechando a porta para alguém aceitar um
   convite alegando ser outro e-mail.
6. **`GET /v1/invitations/:token` é público (sem guard) por necessidade** — o convite precisa ser
   visível antes do login, para a pessoa convidada decidir se quer entrar. Anti-enumeração: token
   não encontrado sempre devolve 404 genérico ("convite inválido ou indisponível"), nunca
   distinguindo "nunca existiu" de "revogado"; mas, uma vez que o hash bate com um convite real, o
   status completo (incluindo REVOKED/EXPIRED/ACCEPTED) é devolvido — posse do token de 256 bits já
   prova legitimidade.
7. **Envio de e-mail é uma abstração (`InvitationEmailService`, classe abstrata) com um único
   adapter real** (`ConsoleInvitationEmailService`) — loga o link em desenvolvimento, e em produção
   loga só um aviso genérico (nome da arena, nunca o link/token) sem lançar exceção. Deliberado:
   nenhum provedor de e-mail real (SendGrid/Postmark/SES) foi integrado nesta fase — ver limitação
   registrada abaixo. A ação de domínio (criar o convite) sempre acontece primeiro; a notificação é
   um efeito posterior que nunca pode derrubar a criação.
8. **Contradição do prompt resolvida da mesma forma que na Fase 10**: a distinção fina
   OWNER-vs-self em `DELETE /members/:userId` continua no service, não no guard — nenhuma mudança
   nessa área nesta fase, só reafirmada.
9. **Roadmap renumerado de novo**: "Fase 11 — IA" (e as fases seguintes) deslocadas para Fases
   12-14. Esta fase (Convites/Ownership) não existia no roadmap original.
10. **41 novos testes e2e de segurança/concorrência** (`invitation-flow.e2e-spec.ts` com 22 testes,
    `ownership-transfer.e2e-spec.ts` com 16 testes — mais testes unitários) — token nunca vazado em
    resposta de API, expiração, revogação, aceite concorrente, transferência concorrente, mismatch
    de e-mail, anti-enumeração — todos contra Postgres real.
11. **Rate limiting em criação/reenvio de convite não foi implementado** — ver limitação registrada
    na seção "Fase 11" abaixo; não é fingido com um contador em memória descartável a cada deploy.

---

## Decisões revisadas na v0.10

Resumo das mudanças desta revisão (Fase 10 — Gestão de Membros/RBAC Operacional). Detalhe completo
na seção "Fase 10" do Roadmap abaixo.

1. **Gestão de equipe implementada sobre o `ArenaMembersModule` já existente**, não um módulo novo —
   `GET/POST/PATCH/DELETE /v1/arenas/:arenaId/members`, reaproveitando `ArenaAccessGuard`/
   `RequireArenaRole` sem qualquer modificação neles.
2. **"No máximo um OWNER por arena" passou a ser garantido pelo banco**, não só pela aplicação — um
   índice único parcial (`ArenaMember_arenaId_single_owner`, `WHERE role = 'OWNER'`; Prisma não tem
   sintaxe de schema para isso, então existe só na migration SQL manual, mesma técnica da `EXCLUDE`
   de `Booking`). A migration **falhou na primeira tentativa contra o banco de desenvolvimento
   real**, porque esse banco já tinha dois `OWNER` na mesma arena — achado genuíno, não simulado,
   corrigido nos dados antes de reaplicar.
3. **Adicionar membro identifica por e-mail, não por `userId`** — decisão deliberada para nunca
   precisar de um endpoint de busca/enumeração de usuários (o OWNER não tem como conhecer o cuid
   interno de outra pessoa). Sem esse endpoint, sem nenhuma superfície nova de enumeração de contas.
4. **Interpretação registrada de uma contradição do prompt da fase**: "`DELETE`: somente OWNER"
   convivia com "ADMIN pode remover a si próprio" — logicamente incompatíveis se `DELETE` fosse
   OWNER-only no guard. Resolvido como guard permissivo (`@RequireArenaRole()`, qualquer membro) +
   regra fina no service (OWNER remove qualquer ADMIN; ADMIN só remove a si mesmo; OWNER nunca é
   removível, nem por si mesmo).
5. **Roadmap renumerado**: "Fase 10 — IA" (e as fases seguintes) deslocadas para Fases 11-13. Esta
   fase (Gestão de Membros) não existia no roadmap original.
6. **26 novos testes e2e de segurança** (`member-management.e2e-spec.ts`) — IDOR, mass assignment,
   escalação de privilégio (tentativa de promover a OWNER via payload), proteção do OWNER,
   isolamento cross-tenant — todos contra Postgres real, nenhum só mockado.

---

## Decisões revisadas na v0.9

Resumo das mudanças desta revisão em relação à v0.8 (detalhe de cada uma na seção correspondente).
O "como implantar" fica em `docs/DEPLOYMENT.md` (documento novo desta fase) — aqui só o "por quê":

1. **Primeiro `Dockerfile` de produção do projeto** (`apps/api/Dockerfile`, multi-stage:
   `base`→`build`→`deploy`→`runtime`), construído e **efetivamente rodado** contra o Postgres local
   nesta fase — não só escrito e inspecionado. Isso revelou **5 bugs reais** que nenhuma quantidade
   de leitura de código teria encontrado: OpenSSL ausente na imagem Debian slim (2x — build e
   runtime são estágios `FROM` diferentes); `pnpm deploy` exigindo `--legacy` a partir do pnpm v10;
   `dist/main.js` não existe — o caminho real é `dist/src/main.js` (o `tsconfig.json` não declara
   `rootDir`, e como `prisma/seed.ts` fora de `src/` também é compilado, o TypeScript infere a raiz
   como o projeto inteiro) — **isso também significa que `pnpm start:prod` nunca funcionou desde
   que foi criado**, silenciosamente, porque nada nunca o testou de verdade; e o client gerado do
   Prisma não sobrevivendo ao `pnpm deploy --legacy` de forma utilizável (enums como `ArenaRole`
   chegando `undefined` em runtime), corrigido copiando o client já gerado no estágio `build` — o
   mesmo artefato que passou pelos 258 testes de backend — em vez de depender de um terceiro
   `prisma generate`. Ver Parte 6.
2. **Health check dividido em liveness (`GET /v1/health`) e readiness (`GET /v1/health/ready`)** —
   antes só existia um endpoint único e estático. Liveness nunca depende do banco (evita restart em
   loop por uma falha temporária de conectividade); readiness roda `SELECT 1` real via Prisma,
   nunca vaza mensagem do driver/host/porta em caso de falha (`503` genérico).
3. **Graceful shutdown real** (`app.enableShutdownHooks()`) — não existia antes. Sem essa chamada,
   `SIGTERM` (enviado pela plataforma em todo redeploy) nunca aciona o ciclo de vida do Nest, e
   `PrismaService.onModuleDestroy()` nunca roda. Bookings em andamento continuam protegidos mesmo
   sem essa chamada (advisory lock e transação são do Postgres, liberados pelo próprio banco), mas
   um shutdown limpo evita conexões penduradas.
4. **Validação de variáveis de ambiente obrigatórias no boot** (`assertRequiredEnv()` em `main.ts`)
   — falha rápido e com mensagem clara (nunca vaza valor, só nome da variável ausente) em vez de
   deixar o primeiro request real revelar a configuração incompleta.
5. **Redis permanece deliberadamente fora do deploy** — confirmado por auditoria de código que
   nenhum módulo usa Redis hoje; `Booking`/idempotência continuam 100% PostgreSQL (Fase 4). Está
   provisionado no `docker-compose.yml` e citado no `.env.example` só como reserva documentada para
   quando BullMQ chegar (Fase 12), nunca como requisito do deploy atual.
6. **Headers de segurança no frontend** (`X-Content-Type-Options`, `Referrer-Policy`,
   `X-Frame-Options`, `Strict-Transport-Security`) via `next.config.ts` — testados contra `next
   start` local real (não só `next build`). CSP deliberadamente **não** adicionado: exigiria testar
   contra o domínio real de produção com Clerk ativo, que este ambiente não tem como fazer sem
   risco de quebrar silenciosamente o login.
7. **`Railway` escolhido como plataforma do backend** (entre Railway/Render/Fly.io), com
   justificativa registrada em `docs/DEPLOYMENT.md`. Na tentativa real de criar o projeto, o
   Railway exigiu o Hobby plan (US$5/mês) — sem free tier real hoje, diferente do que este
   documento registrava antes; corrigido. Decisão consciente de pausar antes de gastar.
8. **Nenhuma dependência nova, nenhuma atualizada** — inclusive reafirmando a decisão da Fase 8 de
   não atualizar o Prisma (6.19.3, major disponível é 7.x) sem necessidade real.
9. **Deploy real permanece bloqueado, por dois motivos diferentes, nunca declarados como
   feitos**: Railway por **custo** (acesso existe, gasto recorrente não autorizado); Vercel e
   Clerk produção por **infraestrutura** (falta de conta/ambiente criado). Ver Roadmap e
   `docs/DEPLOYMENT.md`, "Regra de ouro desta fase".
10. **Repositório publicado no GitHub e CI validado contra um runner real do GitHub Actions** —
    primeiro commit e primeiro `git push` da história do projeto
    (`github.com/fraagelo/arenahub`). A primeira execução real do CI **falhou**, revelando mais um
    bug real do tipo que só aparece rodando de verdade: o placeholder
    `CLERK_WEBHOOK_SIGNING_SECRET` do workflow não era base64 válido para a lib `standardwebhooks`
    (decodifica tudo após `whsec_` como base64 puro) — mascarado localmente porque o `.env` real
    não versionado usa outro valor. Corrigido e revalidado localmente (mesmos passos do CI contra
    um Postgres novo: migrate deploy + test:e2e + build, 133/133 testes) antes do push da correção.
    CI verde na segunda execução.

1. **Cache do TanStack Query passa a ser limpo no logout/troca de conta** — `AppQueryProvider`
   ganhou um componente interno (`ClearQueryCacheOnUserChange`) que observa `useAuth().userId` do
   Clerk e chama `queryClient.clear()` sempre que ele muda. Bug real encontrado via auditoria (item
   56 do prompt da Fase 8): o `<UserButton/>` desloga sem recarregar a página, então sem essa
   limpeza dados privados do usuário anterior ficariam em memória até o próximo refetch. Ver Parte
   6.
2. **`AvailabilityService.buildSlots` corrigido para construir o instante de cada slot via
   `.set({hour, minute})`, nunca `.plus({minutes})`** — a versão anterior somava duração absoluta a
   partir da meia-noite local, o que desloca o horário de parede em 1h no dia em que o DST começa
   (achado real, provado por teste com `America/New_York`, 8/mar/2026). Não afeta `America/
   Sao_Paulo` (sem DST hoje), mas era um bug genuíno de timezone. A mesma técnica correta já era
   usada por `isWithinOperatingHours` desde a Fase 5 — o bug estava isolado à direção "hora local →
   instante" da geração de slots, não à direção "instante → hora local" usada em todo o resto do
   código. Ver Parte 8.
3. **Nenhuma vulnerabilidade de autorização/multi-tenancy encontrada** — nova bateria de 21 testes
   e2e (`hardening.e2e-spec.ts`) cobrindo mass assignment, IDOR sistemático (Arena A nunca acessa
   recursos de Arena B em 7 rotas administrativas diferentes), semântica de `@RequireArenaRole()`
   vazio e isolamento de `Idempotency-Key` — todos passaram de primeira, confirmando (não só
   assumindo) que as proteções das Fases 3-5 já estavam corretas.
4. **Webhook do Clerk confirmado idempotente para reentrega/atualização** — dois testes novos:
   reenviar o mesmo evento assinado não duplica `User`; `user.updated` atualiza o registro existente
   em vez de criar um segundo. `syncFromClerkEvent` já usava `upsert`/`deleteMany`, que são
   naturalmente idempotentes — nenhuma mudança de código, só a prova formal via teste.
5. **Playwright avaliado e descartado, com a limitação documentada explicitamente** (não silenciada)
   — sem conta Clerk real neste ambiente, uma suíte Playwright não conseguiria autenticar uma sessão
   de browser de verdade; criar uma mesmo assim produziria falsa cobertura. Mesma decisão da Fase 2,
   reavaliada e mantida.
6. **Cascades, constraints e índices críticos reauditados sem necessidade de alteração** —
   `Booking → Court` continua `onDelete: Restrict` (histórico nunca desaparece), unique constraints
   de `Arena.slug`/`ArenaMember(arenaId,userId)`/`Court(arenaId,name)`/`IdempotencyKey(userId,
   endpoint,key)` e os índices de `Booking(courtId,startsAt)`/`Booking(userId)` conferidos presentes
   e corretos — nenhuma migration nova nesta fase.

---

## Decisões revisadas na v0.7

Resumo das mudanças desta revisão em relação à v0.6 (detalhe de cada uma na seção correspondente):

1. **Primeiro Dashboard operacional do produto, sem criar um segundo domínio** — só reorganiza
   Arena/Court/ArenaOperatingHours/Booking já existentes numa visão agregada por dia. Nenhuma regra
   de negócio nova: disponibilidade continua exclusiva do `AvailabilityService` (Fase 5), criação de
   `Booking` continua exclusiva do `BookingsService` (Fase 4) — o Dashboard só lê. Ver Parte 9.
2. **`GET /v1/arenas/:arenaId/dashboard?date=YYYY-MM-DD` — uma única consulta de `Booking` cruzando
   todas as quadras da arena** (`where: { court: { arenaId } } }`), nunca uma consulta por quadra
   (N+1 explicitamente evitado). `date` é opcional: quando omitida, o backend resolve "hoje no
   timezone da arena" — nunca o frontend, nunca o timezone do servidor. Ver Parte 8 e Parte 9.
3. **"Ocupação por quadra" é a lista real de `Booking`s `CONFIRMED` do dia, não um grid sintético de
   slots** — evita duplicar o algoritmo de geração de slots do `AvailabilityService` (que continua
   sendo a única fonte de "isso está disponível?"). O Dashboard mostra o que já está ocupado; nunca
   recalcula disponibilidade.
4. **`GET /v1/arenas` (Fase 3) reaproveitado como fonte de "minhas arenas administradas"** para o
   seletor de arena do Dashboard — não foi criado nenhum endpoint novo para isso, nem o contrato
   existente foi alterado.
5. **Nenhum endpoint novo de escrita** — o Dashboard consome exclusivamente endpoints já existentes
   (`PATCH` de Arena/Court da Fase 3, `PUT operating-hours` da Fase 5) para as telas de
   configuração/quadras/horários; o único endpoint novo é de leitura agregada (item 2).
6. **Escopo deliberadamente menor que a visão original do roadmap** (que previa gestão de
   funcionários, faturamento e uma tela protegida contra `STAFF`) — nada disso existe no domínio
   ainda (`ArenaRole` continua só `OWNER`/`ADMIN`) nem foi pedido nesta fase; adicionar seria
   antecipar funcionalidade de fase futura. Ver Roadmap.
7. **Primeiro editor de horário de funcionamento do produto** — a Fase 5 só expunha a API; a Fase 7
   constrói a primeira UI para `PUT .../operating-hours`, com o mesmo modelo de dados (múltiplos
   intervalos por dia, `HH:mm`, overnight não suportado) refletido 1:1 no formulário.
8. **Timezone via `Intl.supportedValuesOf('timeZone')` no frontend** (não um catálogo próprio) para
   o campo de timezone da arena nas configurações — mesma fonte usada pelo validador
   `IsIanaTimezone` do backend (Fase 5), nunca uma segunda lista.
9. **Segurança do Dashboard reaproveita `ArenaAccessGuard` + `@RequireArenaRole()` sem
   modificação** — como `ArenaRole` só tem `OWNER`/`ADMIN` e `CUSTOMER` nunca é `ArenaMember`,
   `@RequireArenaRole()` vazio (qualquer membro) já é suficiente para excluir `CUSTOMER`
   automaticamente nas rotas de leitura do Dashboard; nenhuma checagem de papel duplicada no
   frontend (o frontend não decide acesso, só reage ao 403 do backend).

---

## Decisões revisadas na v0.6

Resumo das mudanças desta revisão em relação à v0.5 (detalhe de cada uma na seção correspondente):

1. **Primeira experiência de cliente ponta a ponta no frontend** — login (Clerk) → descobrir arenas
   → escolher quadra → escolher data → ver disponibilidade real → escolher horário → confirmar →
   "minhas reservas" → cancelar. Nenhuma lógica de negócio nova: o frontend só consome os endpoints
   já existentes (disponibilidade, criação de `Booking`, cancelamento — todos da Fase 4/5) mais dois
   endpoints novos de leitura (descoberta pública e "minhas reservas", ver itens 3-4). Ver Parte 6.
2. **CORS habilitado na API** (`app.enableCors`, origem = `WEB_APP_URL`) — gap real e até então não
   detectado: nenhuma chamada `fetch` do browser para a API teria funcionado antes disso. Sem
   `credentials` (a API nunca usa cookies, só Bearer token do Clerk), então não há necessidade de
   `Access-Control-Allow-Credentials`. Ver Parte 9.
3. **`GET /v1/arenas/discover` e `GET /v1/arenas/discover/:arenaId` (descoberta pública)** —
   endpoints novos, deliberadamente separados de `GET /v1/arenas` (que já significa "minhas arenas
   administradas" desde a Fase 3 e **não foi ressemantizado**). Exigem só autenticação
   (`ClerkAuthGuard`), nunca `ArenaMember` — um cliente não precisa administrar uma arena para
   reservar nela. Nunca retornam `members`/`role`; só quadras **ativas**. `sports` é derivado das
   quadras ativas da arena, não um campo próprio. Registrados antes de `GET /v1/arenas/:arenaId` na
   ordem de rotas do Nest/Express (senão `discover` seria capturado pelo wildcard `:arenaId`). Ver
   Parte 9 e Parte 10.
4. **`GET /v1/users/me/bookings` e `GET /v1/users/me/bookings/:bookingId` ("minhas reservas")** —
   endpoint novo (não reaproveita nenhuma listagem administrativa existente). Filtra
   **obrigatoriamente** por `userId = chamador` **e** `type = CUSTOMER` no próprio `WHERE` do banco
   (nunca busca tudo e filtra em memória) — o filtro por `type` é essencial: `BLOCK`/`MAINTENANCE`
   também têm `userId` preenchido (o admin que criou), e sem esse filtro vazariam nas "reservas" do
   próprio admin. Detalhe de reserva de terceiro retorna `404` (nunca `403`) — mesmo padrão de
   "nunca vazar existência" já usado desde a Fase 3/4. Resposta inclui `court`/`arena` aninhados
   (incluindo `arena.timezone`) para o frontend nunca precisar de uma segunda chamada nem reconstruir
   a URL de cancelamento a partir de IDs soltos. Ver Parte 9 e Parte 10.
5. **Nenhum endpoint novo de cancelamento** — "minhas reservas" reaproveita a rota já existente
   (`POST .../bookings/:bookingId/cancel`, Fase 4), usando `arenaId`/`courtId` vindos da própria
   resposta de "minhas reservas" (nunca reconstruídos no cliente a partir de outra fonte). Nenhuma
   política de janela de cancelamento foi inventada — o domínio não tem uma ainda.
6. **Índice `Booking(userId)` adicionado** — a Fase 4 original já havia deixado registrado (Parte 7)
   que esse índice seria "eventual, quando o primeiro caso de uso realmente filtrar por ele"; "minhas
   reservas" é esse caso de uso. Migration isolada, não altera nenhuma migration anterior.
7. **Frontend: `luxon` e `@tanstack/react-query` adicionados a `apps/web`** — Luxon por reaproveitar
   a mesma biblioteca de timezone já usada no backend desde a Fase 5 (nunca `toLocaleString()` cru,
   nunca assumir que o timezone do navegador é o da arena); TanStack Query porque o requisito real é
   invalidação de cache após reserva/cancelamento — não uma segunda biblioteca de estado global
   (nenhum Redux/Zustand/etc. foi adicionado). Componentes shadcn novos (`card`, `badge`, `skeleton`,
   `input`, `label`, `alert`, `tabs`, `separator`) gerados no preset `base-nova` já configurado,
   reaproveitando os tokens OKLCH existentes — nenhuma segunda biblioteca de componentes. Seleção de
   data usa `<input type="date">` nativo (sem novo componente de calendário). Ver Parte 6.
8. **Regra de ouro do frontend: backend continua sendo a única autoridade** — o cliente nunca decide
   se um horário está disponível, nunca calcula preço/total, nunca confia no `userId` que ele mesmo
   enviaria; a UI só reflete o que a API responde. `Idempotency-Key` é gerada no cliente e **reaproveitada
   em retries da mesma tentativa lógica** (mesmo horário selecionado), nunca uma nova chave por
   clique — reaproveita a infraestrutura "claim-first" já existente desde a Fase 4/5 sem alterá-la.
   Um `409` (horário ficou indisponível entre a consulta e a confirmação) limpa a seleção, mostra
   mensagem amigável e força um novo `GET .../availability` — nunca assume que a grade antiga
   continua correta. Ver Parte 6 e Parte 8.
9. **Sem testes de browser E2E (Playwright) nesta fase** — mesma decisão já registrada na Fase 2
   (não há conta Clerk real disponível neste ambiente para autenticar uma sessão de browser de
   ponta a ponta); a cobertura fica em testes de componente (Jest + React Testing Library, mockando
   os hooks de dados) no frontend e e2e contra Postgres real no backend, como nas fases anteriores.
10. **Roadmap consolidado**: esta fase real ("Fase 6 — Experiência de Reserva do Cliente") ocupa o
    número que a v0.5 havia reservado para "Fase 6 — Dashboard" — mesmo padrão de consolidação já
    usado pelas Fases 3, 4 e 5. Dashboard e as fases seguintes foram renumeradas (+1). Ver Roadmap.

---

## Decisões revisadas na v0.5

Resumo das mudanças desta revisão em relação à v0.4 (detalhe de cada uma na seção correspondente):

1. **`Arena.timezone` implementado** — identificador IANA (ex: `America/Sao_Paulo`), `NOT NULL` com
   default no banco só para backfill de arenas existentes; obrigatório no DTO de criação a partir de
   agora (uma arena nova em outro fuso não deve herdar São Paulo silenciosamente). Ver Parte 7.
2. **`ArenaOperatingHours` implementado — pertence à Arena, não à Court.** Todas as quadras de uma
   arena compartilham o mesmo horário de funcionamento; modelar por quadra duplicaria configuração
   sem necessidade real hoje (decisão análoga à do timezone). Múltiplas linhas por
   `(arenaId, dayOfWeek)` representam múltiplos intervalos no mesmo dia (ex: abre de manhã, fecha
   para almoço, reabre à tarde); um dia sem nenhuma linha significa fechado. `opensAt`/`closesAt`
   são minutos-desde-meia-noite locais (Int), não um `@db.Time` do Postgres nem timestamp. Ver
   Parte 7.
3. **Overnight (intervalo atravessando a meia-noite, ex: 22:00→02:00) não é suportado nesta fase** —
   decisão explícita pela alternativa mais simples: todo intervalo precisa estar contido no mesmo
   dia civil local (`closesAt > opensAt`, sempre). Sem representação explícita de "24 horas" (não
   necessária ainda). Ver Parte 7.
4. **Arena nova nasce sem nenhum horário configurado — fechada todo dia por padrão.** Decisão
   deliberada para nunca inventar disponibilidade: o admin precisa configurar o horário
   explicitamente (`PUT .../operating-hours`) antes da arena mostrar qualquer slot como disponível.
   Ver Parte 7 e Parte 9.
5. **Validação de sobreposição/intervalo inválido em código, não em constraint do Postgres** —
   diferente da proteção contra double-booking em `Booking` (Parte 8), não há `EXCLUDE USING GIST`
   para `ArenaOperatingHours`: o risco de concorrência real é baixo (só `OWNER`/`ADMIN` escreve,
   baixa frequência, sem disputa cliente-a-cliente), então trazer `btree_gist`/`tsrange` para essa
   tabela seria desproporcional. A atualização é atômica via transação (substituição completa:
   apaga tudo e recria), não via constraint. Ver Parte 7.
6. **Dependência de timezone: Luxon**, adicionada como dependência real do `apps/api` — toda
   conversão local↔instante passa por `DateTime.fromObject({...}, {zone}).toUTC()`/
   `DateTime.fromJSDate(instant, {zone})`, nunca aritmética manual de offset. Resolve DST
   corretamente por construção (testado explicitamente com `America/New_York`). Ver Parte 8.
7. **Disponibilidade deixou de ser uma grade matemática ancorada em `from`** (decisão provisória da
   Fase 4) **e passa a respeitar o horário de funcionamento real da arena**: slots são gerados a
   partir do horário de ABERTURA de cada intervalo configurado, no timezone da arena — nunca fora do
   horário de funcionamento. A regra de "esse candidato cabe no intervalo, considerando o buffer?" é
   a mesma função reutilizada por `AvailabilityService` e `BookingsService` — nunca duas
   implementações. Ver Parte 8.
8. **Criação de `Booking` do tipo `CUSTOMER` agora valida horário de funcionamento; `BLOCK`/
   `MAINTENANCE` não são restringidos por ele** — decisão documentada: bloqueio/manutenção são
   operações administrativas (podem representar um evento privado fora do horário comercial normal,
   ou uma manutenção de madrugada) e não passam pela mesma regra de "isso é uma reserva de cliente
   dentro do expediente" — mesmo padrão já usado para buffer=0 administrativo na Fase 4. Ver Parte 8.
9. **Alterar o horário de funcionamento (ou o timezone da arena) nunca apaga/recalcula `Booking`s
   existentes** — `startsAt`/`endsAt` são instantes reais, gravados uma vez; só a disponibilidade
   futura e novas criações passam a refletir a configuração atual. Ver Parte 8.
10. **Resposta de `GET .../availability` passa a ser um objeto** (`{ courtId, timezone, from, to,
    slots }`), não mais um array solto de slots — mudança de contrato justificada (item 36 do
    prompt da Fase 5 pede exatamente esse formato) e sem impacto real, já que não existe ainda
    cliente frontend consumindo esse endpoint. Ver Parte 9.
11. **`GET .../operating-hours` não exige `ArenaMember`** (só autenticação) — mesmo padrão já
    aplicado a `CUSTOMER`/disponibilidade na Fase 4: saber quando a arena abre faz parte da
    experiência pública do cliente. `PUT` continua exigindo `OWNER`/`ADMIN`. Ver Parte 9 e Parte 10.
12. **Roadmap consolidado**: esta fase real ("Fase 5 — Horários de Funcionamento e Disponibilidade
    Real") ocupa o número que a v0.4 havia reservado para "Fase 5 — Dashboard" — mesmo padrão de
    consolidação já usado pelas Fases 3 e 4. Dashboard e as fases seguintes foram renumeradas
    (+1). Ver Roadmap.

---

## Decisões revisadas na v0.4

Resumo das mudanças desta revisão em relação à v0.3 (detalhe de cada uma na seção correspondente):

1. **`Booking`, `BookingType` e `BookingStatus` implementados com campos deliberadamente mínimos**,
   mais simples que a visão completa desenhada na Parte 7: sem `arenaId` denormalizado (a cadeia
   arena→court já é validada antes de qualquer operação em `Booking`), sem coluna `idempotencyKey`
   em `Booking` (tabela `IdempotencyKey` própria — ver item 5), campo `total` (não `totalPrice`),
   `BookingStatus` com só `CONFIRMED`/`CANCELLED` (sem `PENDING`/`EXPIRED`/`COMPLETED` — esses
   dependem de pagamento, fora de escopo). Ver Parte 7.
2. **`Court.pricePerSlot`, `slotDurationMinutes` e `bufferMinutes` implementados** — os campos que a
   v0.3 deixou pendentes "por não fazerem sentido isolados" agora existem, junto com o sistema que os
   consome. Ver Parte 7.
3. **Advisory lock com granularidade por quadra via `pg_advisory_xact_lock(hashtext(courtId))`** —
   serializa criação de reservas para a mesma quadra sem lock global. Ver Parte 8.
4. **Exclusion constraint implementada com uma função SQL auxiliar `booking_occupied_range(...)`,
   marcada `IMMUTABLE`**, em vez de uma expressão `tsrange(...)` direta no índice GiST. Necessário
   porque o operador `timestamptz + interval` é `STABLE` (não `IMMUTABLE`) no catálogo do Postgres, e
   um índice GiST exige que sua expressão seja `IMMUTABLE`. Ver Parte 8.
5. **`Idempotency-Key` implementada como tabela própria (`IdempotencyKey`), com estratégia
   "claim-first"** — não "claim-last" como o desenho original desta seção sugeria. A linha de
   idempotência é reservada (com um placeholder) **antes** do handler de criação rodar, não depois.
   Isso foi uma correção feita durante o teste de concorrência real da Fase 4: com "claim-last", duas
   requisições concorrentes com a mesma chave ficavam serializadas pelo advisory lock da própria
   criação de reserva, e a segunda — ao ser liberada — via a reserva que a primeira acabara de
   commitar e a rejeitava como conflito de horário (409), em vez de reconhecer que era a mesma
   requisição e replicar a resposta (201). Ver Parte 8.
6. **Criar reserva `CUSTOMER` exige só autenticação (`ClerkAuthGuard`), não `ArenaAccessGuard`** —
   decisão explícita: o domínio ainda não tem um papel de "cliente" em `ArenaMember` (só
   `OWNER`/`ADMIN`), e exigir associação à arena inviabilizaria a própria funcionalidade de reserva
   (um cliente que joga numa arena não é funcionário dela). `BLOCK`, `MAINTENANCE` e a listagem
   administrativa continuam exigindo `ArenaAccessGuard` + `@RequireArenaRole(OWNER, ADMIN)`. Ver
   Parte 7 e Parte 10.
7. **Disponibilidade calculada em grade fixa de `Court.slotDurationMinutes`, a partir do início da
   janela consultada (`from`/`to`, obrigatórios)** — decisão provisória documentada: como não existe
   ainda `CourtOperatingHours`/horário de funcionamento por arena, não há um "horário de abertura"
   para ancorar a grade. Cada slot é avaliado individualmente contra as reservas existentes, usando a
   mesma semântica de conflito (com buffer) da criação — não uma regra paralela. Ver Parte 8.
8. **Sem `CourtOperatingHours`/horário de funcionamento por arena ainda** — a Fase 5 original do
   roadmap (ver abaixo) previa isso como parte de "Disponibilidade"; a Fase 4 real entregou
   disponibilidade calculada sobre a janela pedida pelo cliente, sem depender desse conceito.
9. **Roadmap consolidado**: a Fase 4 real ("Disponibilidade e Booking") absorveu o que o roadmap
   original desenhava como duas fases separadas ("Fase 5 — Disponibilidade" e "Fase 6 — Reservas") —
   mesmo padrão de consolidação já usado pela Fase 3. Fases seguintes renumeradas. Ver Roadmap.

---

## Decisões revisadas na v0.3

Resumo das mudanças desta revisão em relação à v0.2 (detalhe de cada uma na seção correspondente):

1. **`Arena`, `ArenaMember` e `Court` implementados com campos deliberadamente mínimos** nesta
   fase — menos do que a visão completa desenhada na Parte 7 (que já previa endereço/timezone/
   imagens/status em `Arena`, `invitedAt`/`acceptedAt`/papel `STAFF` em `ArenaMember`, e
   `pricePerSlot`/`slotDurationMinutes`/`bufferMinutes` em `Court`). Decisão explícita da Fase 3
   ("não adicionar campos por antecipação") — os campos que faltam chegam quando a fase que
   realmente precisa deles (disponibilidade/booking, RBAC granular, marketplace) for implementada.
   Ver Parte 7.
2. **`Sport` é um enum (`BEACH_VOLLEYBALL`), não a tabela-catálogo prevista na Parte 7.**
   Simplificação explícita da Fase 3 — novas modalidades = novo valor de enum + migration, sem
   redesenho. Migrar para uma tabela `Sport` de verdade só se/quando o catálogo precisar de dados
   por modalidade (ícone, configuração) que um enum não comporta. Ver Parte 7.
3. **Autorização por arena implementada como guard + decorator reutilizáveis**
   (`ArenaAccessGuard` + `@RequireArenaRole(...roles)`, módulo `arena-members/`), não checagem
   duplicada por controller. O guard distingue "arena não existe" (404) de "existe mas sem
   permissão" (403) — nunca confunde os dois. Ver Parte 7 e Parte 10.
4. **`GET /v1/arenas/:arenaId` e `GET /v1/arenas` exigem associação (`ArenaMember`), não são
   públicos ainda** — a Parte 9 original já previa esses endpoints como eventualmente públicos
   (busca de arena pelo marketplace), mas isso só se aplica quando o storefront público existir;
   por ora, sem cliente-facing de descoberta de arenas, o acesso é sempre restrito aos membros. Ver
   Parte 9.
5. **`ArenaMember` só nasce automaticamente** (criador de uma arena vira `OWNER` na mesma
   transação) — não existe ainda endpoint de convite de membro (`POST /v1/arenas/:arenaId/members`
   da Parte 9 permanece não implementado). Promover alguém a `ADMIN` hoje só é possível via acesso
   direto ao banco; é o próximo passo natural quando RBAC precisar de mais de um administrador por
   arena na prática.

---

## Decisões revisadas na v0.2

Resumo das mudanças desta revisão em relação à v0.1 (detalhe de cada uma na seção correspondente):

1. **Booking/bloqueios** — reforçada a interpretação conceitual: `Booking` representa uma *ocupação*
   de quadra; `type` (`CUSTOMER` | `BLOCK` | `MAINTENANCE`) diferencia a origem da ocupação. Ver Parte 7 e Parte 8.
2. **Redis deixou de ser parte da garantia de integridade da reserva.** A proteção contra double
   booking passa a se apoiar só em Postgres (transação, advisory lock, validação, exclusion
   constraint) e `Idempotency-Key`. Ver Parte 8.
3. **Cache de disponibilidade não é obrigatório no MVP.** Disponibilidade é calculada direto no
   Postgres; Redis como cache é uma otimização futura, condicionada a métrica real. Ver Parte 5.
4. **Sem limite artificial de "uma arena por usuário".** O backend já suporta múltiplas arenas por
   usuário via `ArenaMember` desde o dia 1; a UI do MVP apenas guia a criação da primeira. Ver Parte 3 e Parte 7.
5. **Duração da reserva no MVP é fixa**, igual a `Court.slotDurationMinutes` — sem duração
   arbitrária ainda. Ver Parte 7.
6. **Buffer entre reservas é aplicado dentro da exclusion constraint**, via um valor congelado por
   reserva (`bufferMinutesSnapshot`), não apenas como regra de exibição de disponibilidade. Ver Parte 8.
7. **Regra de preço do MVP explicitada**: preço único por quadra, um slot por reserva, preço
   congelado em `Booking.totalPrice` na criação. Ver Parte 7.
8. **Escopo de `packages/shared` restrito** explicitamente a tipos e schemas Zod compartilhados —
   proibido regra de negócio, acesso a banco ou services do NestJS ali. Ver Parte 6.
9. **Testes passam a fazer parte de cada fase**, não só da Fase 8. Ver Roadmap.
10. **Critérios de conclusão de todas as fases revisados** para exigir testes, RBAC, tratamento de
    erro e validação de backend antes de considerar uma fase concluída. Ver Roadmap.

---

## Parte 1 — Visão do produto

ArenaHub é uma plataforma que conecta **donos de arenas esportivas** (beach tennis, vôlei de praia,
tênis, futebol society, futevôlei, basquete etc.) a **clientes que querem jogar**, resolvendo dois
problemas ao mesmo tempo:

- Para a arena: substituir planilha/WhatsApp/caderno por um sistema que controla quadras, horários,
  preços, clientes e faturamento, com uma **fonte única de verdade sobre o que está reservado**.
- Para o cliente: descobrir arenas, ver disponibilidade real e reservar em minutos, sem precisar
  ligar ou trocar mensagens para saber "tem horário livre?".

A trajetória do produto é deliberadamente incremental:

```
Sistema de reservas (MVP)
        ↓
Plataforma SaaS multi-arena (várias arenas, cada uma com seu painel)
        ↓
Marketplace (cliente descobre arenas por proximidade/modalidade, IA no WhatsApp)
```

A decisão mais importante da arquitetura é justamente **não construir o marketplace agora, mas não
fechar a porta para ele depois** — isso aparece em decisões como multi-tenancy desde o início,
separação entre "disponibilidade calculada" e dados armazenados, e a IA nunca tocando o banco
diretamente.

---

## Parte 2 — Personas

### Cliente
Joga em uma ou mais arenas, não administra nada. Quer: achar quadra livre rápido, reservar sem
fricção, saber quanto vai pagar antes de confirmar, cancelar sem precisar ligar. É o usuário mais
sensível a UX ruim — se demorar mais que ligar para a arena, o produto falhou.

### Administrador da arena (Owner/Admin)
Dono ou gerente da arena. Quer: parar de perder reserva por conflito manual, ver a agenda do dia de
relance, saber quanto faturou, configurar preço/horário sem depender de suporte técnico. É o
usuário que paga (ou decide contratar) o SaaS — a experiência do painel precisa transmitir
confiança ("esse sistema não vai deixar dois clientes na mesma quadra").

### Funcionário
Trabalha na recepção/quadra. Precisa operar o dia a dia (ver agenda, criar reserva no balcão,
marcar check-in) **sem** acesso a configurações sensíveis (preços, faturamento, gestão de outros
funcionários). Existe desde o MVP como conceito de RBAC, mesmo que o conjunto de permissões seja
pequeno no início — é mais barato modelar isso agora do que migrar depois.

---

## Parte 3 — MVP

Critério de corte: **o que é necessário para uma arena real operar reservas de ponta a ponta sem
planilha paralela**, e nada além disso.

### Dentro do MVP
- Autenticação (Clerk): cadastro, login, recuperação de acesso, perfil básico.
- Cadastro de arena (o backend permite, desde o início, que um usuário tenha vínculo com várias
  arenas via `ArenaMember` — ver Parte 7; a UI do MVP apenas guia o usuário a criar sua primeira
  arena, sem impor limite estrutural).
- Cadastro de quadras vinculadas a uma modalidade.
- Configuração de horário de funcionamento por quadra (recorrente, semanal).
- Bloqueio manual de horários (manutenção, evento, etc.).
- Consulta de disponibilidade real (calculada, não armazenada).
- Fluxo de reserva completo: arena → modalidade → quadra → data → horário → confirmação.
- Cancelamento de reserva (pelo cliente, com regras de prazo mínimo) e pelo admin/funcionário.
- Histórico de reservas do cliente.
- Painel simples para o admin: lista de reservas + calendário do dia.
- RBAC básico: OWNER, ADMIN, STAFF por arena.
- Prevenção de double booking (regra crítica — Parte 6 do briefing / Parte 5 deste documento).

### Fora do MVP (arquitetura preparada, funcionalidade não implementada)
- Pagamentos (PIX/cartão) — reserva no MVP é confirmada sem cobrança online; tabela `Payment`
  existe no schema mas não é usada.
- WhatsApp / IA conversacional.
- Marketplace / busca por proximidade geográfica.
- Torneios.
- Analytics/dashboard avançado (faturamento aparece de forma simples, não como BI).
- Notificações multi-canal (MVP pode ter e-mail transacional simples; push/SMS/WhatsApp ficam para depois).
- Preços dinâmicos por horário/dia (peak/off-peak) — MVP tem preço único por quadra.

Justificativa: cada item "fora" tem uma dependência forte em algo que ainda não existe (gateway de
pagamento, número de WhatsApp Business, volume de arenas suficiente para marketplace fazer sentido).
Construir isso agora seria abstração prematura.

---

## Parte 4 — Casos de uso principais

**Cliente**
1. Criar conta / entrar.
2. Buscar arenas (por nome/modalidade no MVP; por localização no futuro).
3. Ver detalhes de uma arena (quadras, modalidades, endereço, fotos).
4. Consultar disponibilidade de uma quadra em uma data.
5. Criar uma reserva.
6. Cancelar uma reserva (respeitando janela mínima de cancelamento).
7. Ver histórico e reservas futuras.
8. Ver status de pagamento de uma reserva (placeholder no MVP).

**Administrador**
9. Cadastrar/editar a arena (dados, endereço, fotos, modalidades oferecidas).
10. Cadastrar/editar quadras (nome, modalidade, preço, status).
11. Configurar horário de funcionamento de uma quadra.
12. Bloquear um horário/quadra manualmente.
13. Ver agenda do dia / semana por quadra.
14. Criar reserva manual (cliente que ligou, por exemplo).
15. Cancelar reserva de qualquer cliente.
16. Convidar/gerenciar funcionários e seus papéis.
17. Ver faturamento simples (soma de reservas confirmadas por período).

**Funcionário**
18. Ver agenda do dia.
19. Criar/cancelar reserva no balcão.
20. Sem acesso a: preços, faturamento, gestão de funcionários, dados de outras arenas.

**Sistema (não interativo)**
21. Expirar reservas pendentes não confirmadas dentro do prazo (hold com TTL).
22. Enviar notificação de confirmação/cancelamento.

---

## Parte 5 — Arquitetura

### Visão geral (estado MVP)

```
                     ┌─────────────────────┐
                     │   Next.js (Vercel)  │
                     │  App Router + RSC    │
                     └──────────┬───────────┘
                                │ REST (HTTPS, JWT do Clerk)
                     ┌──────────▼───────────┐
                     │     NestJS API        │
                     │  (Railway/Render/Fly) │
                     │  módulos por domínio  │
                     └────┬─────────────┬────┘
                          │             │
                ┌─────────▼───┐   ┌─────▼──────┐
                │  PostgreSQL  │   │   Redis     │
                │  (via Prisma)│   │ (fila async)│
                └──────────────┘   └─────┬───────┘
                                          │
                                   ┌──────▼───────┐
                                   │   BullMQ      │
                                   │  workers      │
                                   │ (notificações,│
                                   │ expirar holds)│
                                   └───────────────┘
```

### Visão futura (IA / WhatsApp) — histórico da previsão original (implementada nas Fases 12 e 16)

> **Atualização Fase 12**: a metade "só leitura" desta visão (a IA nunca acessa o banco direto, só
> um contexto/tools controlados) foi implementada de verdade em `AiModule` — ver seção "Fase 12" do
> Roadmap.
>
> **Atualização Fase 16**: a metade que faltava — canal WhatsApp e ações de escrita
> (criar/cancelar reserva) — também foi implementada, mas com uma diferença deliberada em relação
> ao diagrama original abaixo: em vez de a IA "chamar tools" que internamente batem na API REST, o
> desenho real (`WhatsAppModule`) usa a IA SÓ para classificar a intenção da mensagem num JSON
> fechado (`WhatsAppIntentService`) — quem decide QUANDO e COMO chamar `BookingsService`/
> `AvailabilityService` é código determinístico (`ConversationService`), nunca o modelo escolhendo
> livremente qual tool invocar com quais argumentos. A garantia de fundo é a mesma da previsão
> original ("a IA nunca causa uma reserva inválida porque a camada de negócio é a mesma para todos
> os canais"), só que reforçada: o modelo nem tem a opção de "chamar a tool errada com o argumento
> errado", porque ele não chama tools nenhuma — só classifica. Ver seção "Fase 16" do Roadmap para o
> desenho real implementado.

```
WhatsApp Cloud API
        │ webhook
        ▼
NestJS (módulo whatsapp)
        │
        ▼
AI Agent (orquestração de intenção)
        │  chama apenas tools controladas:
        │  get_available_slots(), get_arena(), get_booking(),
        │  create_booking(), cancel_booking(), get_price()
        ▼
ArenaHub API (as mesmas rotas REST internas do MVP)
        │
        ▼
PostgreSQL
```

**Decisão arquitetural chave:** a IA nunca recebe acesso direto ao Prisma/banco. Ela só enxerga um
conjunto pequeno de *tools* que são, na prática, chamadas para a própria API REST do ArenaHub — as
mesmas regras de validação, RBAC e prevenção de double booking que valem para o app valem para a
IA. Isso significa que o "cérebro" da IA pode errar de intenção, mas não pode causar uma reserva
inválida, porque a camada de negócio é a mesma para todos os canais.

### Por que NestJS modular monolito (e não microsserviços) agora

Comparação rápida:

| Opção | Prós | Contras |
|---|---|---|
| **Monolito modular (recomendado)** | 1 deploy, transações ACID simples entre módulos, custo de infra baixo, mais fácil para 1 dev/time pequeno | Precisa disciplina para não acoplar módulos |
| Microsserviços desde o início | Escala/isola por serviço | Overhead de infra, latência entre serviços, transações distribuídas para algo tão acoplado quanto "reserva" é dor desnecessária agora |

Reservar uma quadra é fundamentalmente uma operação transacional (arena, quadra, disponibilidade,
preço, reserva — tudo precisa estar consistente no mesmo commit). Separar isso em serviços agora
adicionaria complexidade sem benefício real no volume atual. Os módulos do NestJS já são a costura
para separar em serviços depois, se o crescimento (ex: módulo de pagamentos ou IA) justificar.

### Por que monorepo

Recomendo **pnpm workspaces + Turborepo**, um único repositório com `apps/web`, `apps/api` e
`packages/shared` (tipos e schemas de validação compartilhados entre front e back, ex: o shape de
um `Booking` ou o schema Zod de "criar reserva"). Isso evita duplicar contratos de API manualmente
e mantém front/back sempre compilando contra o mesmo tipo. Alternativa (dois repositórios
separados) só compensa quando times diferentes têm ciclos de deploy realmente independentes — não é
o caso aqui.

### Cache e filas (Redis + BullMQ)

Redis e BullMQ continuam na stack aprovada, mas com um escopo mais estreito do que a v0.1 descrevia:

- **Redis não faz parte da garantia de integridade da reserva.** Toda a proteção contra double
  booking vive inteiramente no Postgres (transação, advisory lock, exclusion constraint) — ver
  Parte 8. Isso é deliberado: a integridade de uma reserva não pode depender da disponibilidade de
  um serviço externo ao banco.
- **Disponibilidade é calculada direto no Postgres no MVP**, via query indexada (`CourtOperatingHours`
  menos `Booking`s ativos no intervalo). Nenhum cache é necessário para o MVP funcionar
  corretamente. Se, com uso real, métricas (ex: p95/p99 de latência do endpoint de disponibilidade
  em quadras de alto tráfego) mostrarem necessidade, um cache curto em Redis pode ser adicionado
  depois como otimização — não como pré-requisito de correção.
- **BullMQ é o mecanismo de trabalho assíncrono** (fila sobre Redis), reservado para tarefas que são
  naturalmente assíncronas e não fazem parte do caminho crítico de escrita de uma reserva: envio de
  notificações e, a partir da Fase 17, expiração de holds de pagamento (`PENDING` vencido). No MVP,
  como a reserva é criada direto como `CONFIRMED` (sem hold), a fila fica provisionada na infra
  (Docker Compose, Fase 1) mas só passa a ser exercitada de fato quando notificações assíncronas ou
  o fluxo de pagamento entrarem.

---

## Parte 6 — Estrutura dos projetos

```
arenahub/
├── apps/
│   ├── web/                      # Next.js — site público + área do cliente + Dashboard da arena
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── arenas/                        # descoberta + reserva (Fase 6)
│   │   │   │   │   └── [arenaId]/courts/[courtId]/ # data picker + disponibilidade + confirmação
│   │   │   │   ├── minhas-reservas/               # lista (abas) + detalhe/cancelamento (Fase 6)
│   │   │   │   ├── dashboard/                     # área administrativa (Fase 7) — nunca mistura
│   │   │   │   │   │                               # com o fluxo de cliente acima (item 58)
│   │   │   │   │   └── [arenaId]/
│   │   │   │   │       ├── quadras[/courtId]/     # CRUD de quadra (reaproveita API da Fase 3)
│   │   │   │   │       ├── horarios/              # editor de operating-hours (reaproveita Fase 5)
│   │   │   │   │       └── configuracoes/         # dados básicos + timezone da arena
│   │   │   │   ├── sign-in/, sign-up/             # Clerk (Fase 2)
│   │   │   │   └── proxy.ts                       # clerkMiddleware (Next 16 renomeou middleware.ts)
│   │   │   ├── components/
│   │   │   │   ├── ui/            # componentes shadcn (baixo nível, "burros")
│   │   │   │   └── *.tsx          # componentes compostos por caso de uso (arena-card, booking-card,
│   │   │   │                      # dashboard-header, booking-timeline, arena-selector, ...)
│   │   │   ├── lib/               # client de API tipado, formatação (BRL/Luxon), tipos espelhando a API
│   │   │   └── hooks/             # hooks de dados (TanStack Query)
│   │   # Observação: os route groups (marketing)/(client)/(dashboard) do
│   │   # desenho original nunca foram adotados — a separação real entre
│   │   # cliente e administração é por PATH (/arenas, /minhas-reservas vs.
│   │   # /dashboard), não por route group de layout; nenhum dos dois lados
│   │   # precisou de layout próprio o suficiente para justificar a
│   │   # convenção original.
│   │
│   └── api/                       # NestJS
│       ├── src/
│       │   ├── modules/
│       │   │   ├── health/        # GET /health (liveness) e /health/ready (readiness — Fase 9)
│       │   │   ├── auth/          # integração Clerk, guards
│       │   │   ├── users/
│       │   │   ├── arenas/
│       │   │   ├── arena-members/ # RBAC por arena
│       │   │   ├── sports/
│       │   │   ├── courts/
│       │   │   ├── operating-hours/ # horário de funcionamento (Fase 5)
│       │   │   ├── availability/  # cálculo de slots, horários, bloqueios
│       │   │   ├── bookings/
│       │   │   ├── dashboard/     # visão agregada só-leitura (Fase 7) — não é um domínio novo
│       │   │   ├── payments/      # schema pronto, lógica desativada no MVP
│       │   │   ├── notifications/
│       │   │   └── ai/            # fase futura — tools expostas para o agente
│       │   ├── common/            # guards, decorators, filters, interceptors, pipes
│       │   ├── prisma/            # PrismaService, módulo global
│       │   └── main.ts
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── migrations/
│       ├── Dockerfile             # build de produção (Fase 9) — contexto = raiz do monorepo
│       └── test/
│
├── packages/
│   ├── shared/                    # tipos TS + schemas Zod compartilhados (DTOs de request/response)
│   └── config/                    # eslint, tsconfig, prettier compartilhados
│
├── docker/
│   └── docker-compose.yml         # postgres + redis (só postgres é usado hoje — Fase 9, item 2)
│
├── .dockerignore                  # raiz, não apps/api/ — o contexto de build do Docker é a raiz
├── .nvmrc                         # versão do Node fixada (Fase 9), igual ao CI
├── .github/workflows/             # CI: lint, test, build — validado contra runner real (Fase 9)
└── docs/
    ├── ARCHITECTURE.md            # este documento
    └── DEPLOYMENT.md              # runbook operacional de deploy (Fase 9) — "como", não "por quê"
```

Ponto de atenção deliberado: o painel da arena (`/dashboard`) e a área do cliente (`/arenas`,
`/minhas-reservas`) vivem no **mesmo app Next.js**, separados só por path (não por route group nem
por app separado) — implementado assim na Fase 7. Simplifica deploy e compartilhamento de
componentes agora; se um dia o dashboard precisar de ciclo de release independente, a separação em
`apps/dashboard` é uma extração mecânica, não um redesenho.

### Regra de escopo do `packages/shared`

Para evitar que `packages/shared` vire uma segunda casa para lógica de backend (armadilha comum em
monorepos), fica definido:

**Pode conter:**
- Tipos TypeScript públicos (ex: shape de `Booking`, `Arena`, enums como `BookingType`).
- Schemas Zod compartilhados para validar o mesmo contrato nos dois lados (ex: payload de
  "criar reserva").
- Contratos de request/response de endpoints, quando front e back realmente precisam do mesmo tipo
  para não divergir.

**Não pode conter:**
- Regra de negócio (ex: cálculo de disponibilidade, lógica de preço, lógica de RBAC).
- Acesso a banco de dados ou ao Prisma Client.
- Services, guards, providers ou qualquer artefato do NestJS.
- Detalhes internos da aplicação que não precisam atravessar a borda front/back.

Teste prático para decidir se algo entra em `packages/shared`: "isso é a *forma* de um dado, ou é
uma *regra* sobre um dado?". Forma vai para `shared`; regra fica em `apps/api`.

---

## Parte 7 — Banco de dados

### Entidades propostas (revisão da lista original)

Mantive a essência da lista sugerida, mas fiz três mudanças deliberadas:

1. **`BlockedSlot` foi incorporado a `Booking`** via um campo `type`. A interpretação conceitual é:
   `Booking` representa **uma ocupação de uma quadra em determinado intervalo de tempo**; `type`
   apenas diferencia a *origem* dessa ocupação — `CUSTOMER` (cliente reservou), `BLOCK` (bloqueio
   administrativo, ex: evento) ou `MAINTENANCE` (manutenção da quadra). Motivo: se existirem duas
   tabelas independentes guardando "tempo ocupado em uma quadra", a constraint anti-conflito do
   banco (Parte 8) não consegue enxergar as duas ao mesmo tempo — teria que ser reforçada em duas
   estruturas diferentes, o que é uma fonte clássica de bug ("bloqueei manutenção, mas o sistema
   deixou reservar por cima"). Com uma tabela só, **existe uma única fonte de verdade sobre "o que
   está ocupado nessa quadra"**, e uma única exclusion constraint garante consistência para os três
   tipos de ocupação.
2. **`Availability` não é uma tabela de slots**. Guardar cada slot de cada dia de cada quadra
   explodiria em volume e ficaria dessincronizado toda vez que o horário de funcionamento mudasse.
   Em vez disso, existe `CourtOperatingHours` (regra recorrente semanal: "seg-sex 07h-23h") e os
   slots disponíveis são **calculados sob demanda**, com uma query no Postgres (horário de
   funcionamento menos reservas/bloqueios existentes no intervalo). Nenhum cache é necessário para
   isso funcionar corretamente no MVP — ver Parte 5.
3. Adicionei `ArenaMember` já pensando em RBAC multi-arena: um usuário pode ser `OWNER` de uma
   arena e simplesmente `CLIENTE` (sem registro em `ArenaMember`) de outra. Não existe um campo
   global "role" no `User" — o papel é sempre relativo a uma arena.

### Modelo de entidades

**User**
Espelha o usuário do Clerk (`clerkId` único). Campos: `id`, `clerkId`, `email`, `name`, `phone`,
`avatarUrl`, `createdAt`, `updatedAt`. Não tem campo de "papel" global — ver acima.

**Arena**
Visão completa (eventual): `id`, `ownerId` (User), `name`, `slug` (único, para URL pública),
`description`, `phone`, `email`, endereço estruturado (`addressLine`, `city`, `state`, `zipCode`,
`latitude`, `longitude` — os dois últimos já presentes para o marketplace futuro, mesmo sem uso de
busca geoespacial ainda), `timezone` (IANA, ex. `America/Sao_Paulo` — ver estratégia de horários
abaixo), `images` (array de URLs ou tabela separada `ArenaImage` se precisar de ordenação/
metadata), `status` (`ACTIVE`/`INACTIVE`), `createdAt`, `updatedAt`.

**Implementado na Fase 3** (deliberadamente menor — "não adicionar campos por antecipação"):
`id`, `name`, `slug` (único), `description`, `phone`, `email`, `createdAt`, `updatedAt`. **Sem**
`ownerId`: não existe FK direta de dono em `Arena` — o proprietário é sempre resolvido via
`ArenaMember` com `role = OWNER` (fonte única de verdade, evita um segundo lugar que poderia
divergir). Endereço, `images` e `status` entram quando a fase que precisa deles (marketplace)
chegar.

**Implementado na Fase 5**: `timezone` (`String`, identificador IANA — ex: `America/Sao_Paulo`).
`NOT NULL` com default `'America/Sao_Paulo'` no banco — o default existe **só** para não quebrar a
migration em arenas já existentes (backfill automático, sem intervenção manual); o DTO de criação
(`CreateArenaDto`) exige o campo explicitamente a partir de agora, porque herdar São Paulo em
silêncio para uma arena nova em outro fuso produziria disponibilidade sistematicamente errada.
Alterar o timezone de uma arena existente é permitido via `PATCH` normal (mesmo endpoint de sempre)
— análise de impacto (Parte 8) mostrou que não há corrupção de dado possível: `Booking.startsAt`/
`endsAt` são instantes absolutos, nunca reinterpretados; só `ArenaOperatingHours` (armazenado em
minutos locais) passa a ser lido através do novo timezone dali em diante — comportamento desejado,
não um bug.

**ArenaOperatingHours** (horário de funcionamento — implementado na Fase 5)
Pertence à **Arena**, não à Court — decisão análoga à do timezone (Parte 7, acima): todas as
quadras de uma arena tipicamente compartilham o mesmo horário de funcionamento; modelar por quadra
duplicaria configuração sem necessidade real hoje (override por quadra fica como evolução aditiva
futura, se um caso real aparecer). Campos: `id`, `arenaId`, `dayOfWeek` (enum `Weekday`), `opensAt`,
`closesAt` (`Int`, minutos desde a meia-noite **local** do dia — 0-1439, nunca um `@db.Time` do
Postgres nem um timestamp; mesmo padrão já usado para `bufferMinutes`/`slotDurationMinutes` em
`Court`, e evita a ambiguidade de um `@db.Time` carregando uma data espúria via Prisma).

Múltiplas linhas com o mesmo `(arenaId, dayOfWeek)` representam múltiplos intervalos no mesmo dia
(ex: abre de manhã, fecha para o almoço, reabre à tarde). Um dia **sem nenhuma linha** significa
fechado — nunca uma linha-sentinela `00:00→00:00`.

**Weekday**: enum `MONDAY`..`SUNDAY` — centraliza o dia da semana num único lugar, nunca um inteiro
solto (`0=domingo` vs. `1=domingo` é uma fonte clássica de bug se espalhado pelo código). A
conversão do `weekday` ISO 8601 do Luxon (1=segunda..7=domingo) para o enum vive numa única função
(`weekdayFromIso`), reutilizada por `AvailabilityService` e `BookingsService`.

**Regras de validação da configuração** (aplicadas em código por `OperatingHoursService`, nunca
confiadas só ao formato do payload):
- `closesAt > opensAt`, sempre — overnight (intervalo atravessando a meia-noite, ex: `22:00→02:00`)
  **não é suportado nesta fase**: decisão explícita pela alternativa mais simples entre as
  cogitadas. Todo intervalo precisa estar contido no mesmo dia civil local.
- Sem representação explícita de "24 horas" — não necessária ainda; se um dia for preciso, será uma
  decisão própria e documentada, não inferida de `opensAt == closesAt` ou similar.
- Intervalos do mesmo dia não podem se sobrepor.
- `opensAt`/`closesAt` limitados a `[0, 1439]` — a API troca `"HH:mm"` (nunca minutos crus) com o
  cliente; a conversão para/de `Int` é interna.

**Sem `EXCLUDE USING GIST` para `ArenaOperatingHours`** (diferente da proteção contra double-booking
em `Booking`, Parte 8) — decisão deliberada: o risco de concorrência real aqui é baixo (só
`OWNER`/`ADMIN` escreve, baixa frequência, sem disputa cliente-a-cliente como em `Booking`), então
trazer `btree_gist`/`tsrange` para essa tabela seria uma complexidade desproporcional ao risco.
Validação de sobreposição/intervalo inválido acontece inteiramente em código, e a atualização é
atômica via transação — não via constraint do banco.

**Arena nova nasce sem nenhum horário configurado** (fechada todo dia) — decisão deliberada para
nunca inventar disponibilidade comercial arbitrária (ex: "09h-18h" por padrão). O admin precisa
configurar o horário explicitamente (`PUT .../operating-hours`, Parte 9) antes da arena mostrar
qualquer slot como disponível.

**ArenaMember** (tabela de junção — RBAC)
Visão completa (eventual): `id`, `arenaId`, `userId`, `role` (`OWNER` | `ADMIN` | `STAFF`),
`invitedAt`, `acceptedAt`. Constraint única em `(arenaId, userId)`. Toda checagem de permissão no
backend passa por aqui: "esse usuário tem papel X *nesta* arena?".

**Implementado na Fase 3**: `id`, `arenaId`, `userId`, `role` (`OWNER` | `ADMIN` — **sem** `STAFF`
ainda), `createdAt`. **Sem** `invitedAt`/`acceptedAt`: a associação nasce sempre já efetivada (quem
cria a arena vira `OWNER` na mesma transação); não existe ainda fluxo de convite pendente. Adicionar
`STAFF` ou o fluxo de convite depois é aditivo (novo valor de enum / novos campos opcionais), não
exige redesenho.

**Sport** (catálogo global — visão eventual, ver nota abaixo)
`id`, `name`, `slug`, `icon`. Poucas linhas, mantidas centralmente (Beach Tennis, Vôlei de Praia,
Tênis, Futebol Society, Futevôlei, Basquete...). Uma arena escolhe quais oferece através das
`Court`s cadastradas.

**Implementado na Fase 3**: `Sport` é um **enum** (`BEACH_VOLLEYBALL`), não uma tabela. Migrar para
a tabela-catálogo acima só quando o catálogo precisar de dados por modalidade que um enum não
comporta (ícone, configuração específica) — novo esporte até lá é só um novo valor de enum.

**Court**
Visão completa (eventual): `id`, `arenaId`, `sportId`, `name`, `description`, `pricePerSlot`
(Decimal — MVP: preço único; pronto para virar tabela `PriceRule` depois sem quebrar nada, já que o
preço final de uma reserva fica congelado em `Booking.totalPrice`), `slotDurationMinutes` (ex: 60 —
duração fixa de toda reserva nessa quadra no MVP, ver subseção abaixo), `bufferMinutes` (minutos de
intervalo obrigatório *após* cada reserva de cliente antes do próximo horário ficar disponível, ex:
0 ou 10 — ver subseção abaixo), `status` (`ACTIVE` | `INACTIVE` | `MAINTENANCE`), `createdAt`,
`updatedAt`.

**Implementado na Fase 3**: `id`, `arenaId`, `name`, `sport` (enum, ver acima), `description`,
`isActive` (Boolean, default `true`) — mais simples que o `status` de três estados da visão
eventual, suficiente para "a quadra aparece ou não como opção" nesta fase, `createdAt`,
`updatedAt`. Nome único por arena (`@@unique([arenaId, name])`).

**Implementado na Fase 4**: `pricePerSlot` (`Decimal(10,2)`, default `0`), `slotDurationMinutes`
(`Int`, default `60`, mínimo 15 — validado no DTO), `bufferMinutes` (`Int`, default `0`, máximo
24h — validado no DTO). Chegaram junto com o sistema que os consome (`Booking`/disponibilidade),
como a v0.3 já previa.

**Quadra inativa (`isActive = false`)**: não aceita novos `Booking`s (`ConflictException`, 409);
não aparece disponível (`AvailabilityService` retorna todos os slots como indisponíveis sem
consultar `Booking`); `Booking`s já existentes continuam intactos e consultáveis — desativar uma
quadra nunca apaga histórico.

**CourtOperatingHours**
`id`, `courtId`, `weekday` (0-6), `startTime`, `endTime`. Múltiplas linhas por quadra (uma por dia
da semana, podendo haver mais de uma linha por dia se precisar de janelas partidas no futuro, ex:
manhã e noite).

**Booking** (representa qualquer ocupação de quadra — reserva de cliente ou administrativa)
Visão completa (eventual): `id`, `arenaId` (desnormalizado — evita join extra em quase toda query de
listagem), `courtId`, `userId` (nulo quando `type != CUSTOMER`), `type` (`CUSTOMER` | `BLOCK` |
`MAINTENANCE`), `status` (`PENDING` | `CONFIRMED` | `CANCELLED` | `EXPIRED` | `COMPLETED`),
`startTime`, `endTime` (`timestamptz`, sempre UTC), `bufferMinutesSnapshot` (Int, default `0` —
cópia de `Court.bufferMinutes` no momento da criação, usada pela exclusion constraint; ver Parte 8),
`totalPrice` (congelado no momento da criação — não recalcular se o preço da quadra mudar depois),
`idempotencyKey` (único, nulo permitido), `cancelReason`, `cancelledAt`, `cancelledByUserId`,
`createdAt`, `updatedAt`.

**Implementado na Fase 4** (mais simples que a visão eventual acima — "implementar o mínimo
necessário para o domínio desta fase"):
`id`, `courtId`, `userId` (nulo quando `type != CUSTOMER` — para `BLOCK`/`MAINTENANCE` registra o
admin que criou), `type` (`BookingType`), `status` (`BookingStatus`, default `CONFIRMED`),
`startsAt`, `endsAt` (`timestamptz`), `bufferMinutesSnapshot` (Int, default `0`), `total`
(`Decimal(10,2)`, default `0` — não `totalPrice`), `reason` (String opcional — motivo
administrativo de `BLOCK`/`MAINTENANCE`), `cancelledAt`, `cancelledByUserId`, `createdAt`,
`updatedAt`. Índice `(courtId, startsAt)`.

Diferenças deliberadas em relação à visão completa:
- **Sem `arenaId` denormalizado**: não estava entre os campos mínimos pedidos, e a cadeia
  arena→court já é validada (`CourtsService.findOne`/`tx.court.findFirst`) antes de qualquer
  operação em `Booking` — adicionar o campo seria otimização prematura sem uso real ainda.
- **Sem coluna `idempotencyKey` em `Booking`**: a idempotência tem uma tabela própria
  (`IdempotencyKey`, abaixo), porque a mesma chave precisa ser validada e persistida **antes** de
  saber se um `Booking` será de fato criado (ver "claim-first" na Parte 8) — uma coluna em
  `Booking` não serviria para isso.
- **`BookingStatus` só `CONFIRMED`/`CANCELLED`**: `PENDING`/`EXPIRED`/`COMPLETED` dependem de um
  fluxo de pagamento que não existe nesta fase (Fase 17 do roadmap) — `Booking` nunca depende de
  `Payment` (item 2 do prompt da Fase 4).
- **`total` congelado na criação, sem `PricingService`**: para `CUSTOMER`, é uma cópia direta de
  `Court.pricePerSlot` no momento da criação (não recalculado depois, mesmo mudanças futuras no
  preço da quadra); para `BLOCK`/`MAINTENANCE`, sempre `0` (não são transações comerciais).
- **`onDelete: Restrict` na relação `Booking.court`** (diferente de `ArenaMember`, que é
  `Cascade`): histórico de reservas nunca deve desaparecer junto com a quadra. Não existe endpoint
  de exclusão de `Court` ainda; a constraint fica pronta para quando existir.

**BookingType**: enum `CUSTOMER` | `BLOCK` | `MAINTENANCE` — a **origem** da ocupação, nunca
confundida com `BookingStatus` (o **ciclo de vida**). Todos os três tipos ocupam a quadra da mesma
forma para efeito de conflito — a mesma `EXCLUDE` constraint protege os três (Parte 8). A única
assimetria é o buffer: `CUSTOMER` sempre usa `Court.bufferMinutes` vigente no momento da criação;
`BLOCK`/`MAINTENANCE` sempre têm `bufferMinutesSnapshot = 0` (ocupam exatamente o intervalo
declarado, sem margem implícita).

**IdempotencyKey** (tabela própria, não coluna em `Booking`)
`id`, `key`, `userId`, `endpoint` (identificador lógico da operação, ex:
`"bookings.customer.create"` — não a URL literal), `requestHash` (hash determinístico do payload
relevante), `responseStatus`, `responseBody` (Json), `createdAt`. Unique `(userId, endpoint, key)`.
Ver Parte 8 para a estratégia completa ("claim-first").

**Payment** (implementado na Fase 17 — ver seção "Fase 17" do Roadmap para o desenho real e a
justificativa completa; este parágrafo é o esboço ORIGINAL, pré-implementação, preservado como
histórico)
`id`, `bookingId`, `provider` (`ASAAS` | `MERCADO_PAGO`), `status`, `amount`, `method`,
`externalId`, `paidAt`, `refundedAt`, `createdAt`.
> **Atualização Fase 17**: o desenho real ficou mais próximo, mas não idêntico, a este esboço —
> `provider` só tem `MERCADO_PAGO` (Asaas foi avaliado e descartado, ver relatório da fase), não
> existe `method` (só PIX nesta fase) nem `externalId`/`refundedAt` (chamam-se
> `providerPaymentId`/não existe refund), e ganhou `userId`/`arenaId` denormalizados,
> `idempotencyKey`, `expiresAt` e `failureReason` — nenhum desses estava previsto aqui porque as
> exigências de idempotência/multi-tenant/concorrência só ficaram claras com a fase real.

**Notification** (schema pronto, uso mínimo no MVP — ex: e-mail de confirmação)
`id`, `userId`, `channel` (`EMAIL` | `SMS` | `WHATSAPP` | `PUSH`), `type`, `payload` (JSON),
`status`, `sentAt`, `createdAt`.

### Relacionamentos e cardinalidade

- `User` 1—N `ArenaMember` N—1 `Arena` (muitos-para-muitos entre User e Arena, via ArenaMember)
- `Arena` 1—N `Court`
- `Sport` 1—N `Court`
- `Court` 1—N `CourtOperatingHours`
- `Court` 1—N `Booking`
- `User` 1—N `Booking` (como cliente; nulo se for bloqueio administrativo)
- `Booking` 1—N `Payment` (tentativas; no máximo 1 `PAID` por Booking — implementado na Fase 17,
  ver nota acima; o esboço original desta linha previa 1—1)
- `User` 1—N `Notification`

### Índices e constraints importantes

- `ArenaMember`: unique `(arenaId, userId)`; index `(userId)` (consulta "minhas arenas").
- `Arena.slug`: unique.
- `Court`: unique `(arenaId, name)` — nome de quadra único por arena, não globalmente.
- `Booking`: index `(arenaId, startTime)` — agenda geral da arena (visão eventual, ver Parte 7 sobre
  `arenaId` não estar denormalizado ainda).
- `Booking`: index `(userId)` — histórico do cliente. **Implementado na Fase 6**, quando "minhas
  reservas" se tornou o primeiro caso de uso real filtrando por `userId` (ver Parte 9).
- `Booking.idempotencyKey`: unique (parcial, apenas quando não nulo) — visão eventual; **implementado
  na Fase 4 como tabela própria** `IdempotencyKey` com unique `(userId, endpoint, key)`, não como
  coluna em `Booking` (ver Parte 7 e Parte 8).
- **Implementado na Fase 4**: `Booking` index `(courtId, startsAt)` — toda consulta de
  disponibilidade/agenda filtra por isso. `Booking`: **constraint de exclusão** `Booking_no_overlap_excl`
  (detalhada na Parte 8) impedindo sobreposição de horário por quadra, usando a função IMMUTABLE
  `booking_occupied_range(startsAt, endsAt, bufferMinutesSnapshot)`.

### Estratégia de horários (timezone)

Toda coluna de tempo é `timestamptz` armazenada em UTC. `Arena.timezone` guarda o fuso IANA da
arena. A conversão para horário local acontece **na borda** (API formata para exibição, frontend
recebe UTC e formata usando o timezone da arena, não o do navegador do usuário — importante porque
um cliente em outro fuso reservando remotamente precisa ver o horário local da arena, não o seu
próprio). Isso evita a classe inteira de bugs de "reserva apareceu 1h deslocada" causada por
DST/fuso do servidor.

**Implementado na Fase 5**: `Arena.timezone` existe (Parte 7). O cliente continua sempre enviando
timestamps ISO 8601 completos, com offset explícito (ex: `2026-08-20T19:00:00-03:00`), tanto para
criar `Booking` quanto para consultar disponibilidade/listagem (`?from=&to=`) — nunca horário local
como string solta (ex: `"19:00"`); esse contrato não muda. O que muda é que o **servidor** agora
interpreta `ArenaOperatingHours` (horário local, sem timezone anexado) através do `Arena.timezone`
real para decidir se um instante cai dentro do horário de funcionamento — usando Luxon
(`DateTime.fromObject({...}, {zone}).toUTC()`), nunca aritmética manual de offset, para resolver DST
corretamente (testado explicitamente com `America/New_York`, que tem DST, mesmo o MVP hoje só usando
`America/Sao_Paulo`, que não tem). Ver Parte 8, "Disponibilidade (implementação Fase 5)".

### Duração da reserva no MVP

No MVP, **toda reserva usa exatamente a duração configurada em `Court.slotDurationMinutes`** — não
há duração arbitrária/variável ainda. Exemplo com `slotDurationMinutes = 60`:

```
08:00–09:00
09:00–10:00
10:00–11:00
```

O cliente escolhe um horário de início dentre os slots gerados pela disponibilidade; o sistema
deriva o fim (`startTime + slotDurationMinutes`). Isso simplifica a UI de escolha de horário e a
regra de preço (Parte 7 abaixo) no MVP.

A arquitetura já está preparada para durações variáveis no futuro **sem migração de schema**: como
`Booking.startTime`/`endTime` são `timestamptz` livres (não um índice de slot fixo), permitir que o
cliente escolha, por exemplo, 90 minutos em uma quadra de slot de 60 é uma mudança na regra de
validação da camada de aplicação (quantos slots consecutivos livres existem a partir do horário
escolhido, e como calcular o preço proporcional), não uma mudança estrutural no banco. Esse é um
item explicitamente fora do MVP (Parte 3).

### Regra de preço no MVP

- Cada `Court` possui um único `pricePerSlot`.
- Cada `Booking` do tipo `CUSTOMER` ocupa exatamente um slot (consequência direta da seção anterior).
- `Booking.totalPrice` recebe o valor de `Court.pricePerSlot` **vigente no momento da criação da
  reserva** — é uma cópia congelada, não uma referência.
- Alterar o preço de uma quadra depois **não** altera o valor de reservas já criadas, mesmo que
  ainda estejam no futuro.

Preço por horário/dia (peak/off-peak), descontos, cupons e outras regras de precificação dinâmica
ficam fora do MVP (Parte 3) — o campo único `pricePerSlot` é suficiente por ora, e o padrão de
"congelar o valor no momento da criação" já é a base correta para quando uma tabela `PriceRule`
existir: o preço final ainda será resolvido uma vez, no momento da reserva, e gravado em
`Booking.totalPrice`.

### Autorização por arena (implementação Fase 3)

"Quem é o usuário" (autenticação) e "o que ele pode fazer nesta arena" (autorização) são resolvidos
por mecanismos deliberadamente separados, no mesmo padrão guard+decorator já usado para o Clerk:

- `ClerkAuthGuard` (Fase 2) resolve autenticação — anexa `{ clerkId }` ao request.
- `ArenaAccessGuard` (módulo `arena-members/`) resolve autorização — lê `:arenaId` da rota, resolve
  o `User` interno a partir do `clerkId`, e delega a decisão a `ArenaMembersService.assertAccess`.
- `@RequireArenaRole(...roles)` declara, por rota, o que é exigido: sem argumentos, "qualquer
  membro serve" (leitura); com papéis (`ArenaRole.OWNER, ArenaRole.ADMIN`), exige um deles
  (escrita).
- `ArenaMembersService.assertAccess` distingue dois erros que a API precisa diferenciar (Parte 10):
  arena inexistente → `404`; arena existe mas o usuário não é membro (ou não tem o papel exigido) →
  `403`. Essa distinção fica centralizada aqui — nenhum controller reimplementa a checagem.

Nada disso duplica a decisão de autorização em cada endpoint: um controller só declara
`@UseGuards(ClerkAuthGuard, ArenaAccessGuard)` + `@RequireArenaRole(...)`, e a decisão real vive em
um único lugar. Rotas aninhadas sob `/arenas/:arenaId/...` (como `courts`) reaproveitam o mesmo
guard sem nenhuma lógica adicional — funciona porque `arenaId` já está no path.

### Autorização de reservas (implementação Fase 4)

`ArenaAccessGuard` é reaproveitado sem nenhuma segunda implementação, mas **nem toda rota de
`Booking` o usa** — a decisão de quando usá-lo depende de quem deveria conseguir chamar a rota:

| Operação | Guard | Motivo |
|---|---|---|
| Criar `CUSTOMER` (`POST .../bookings`) | só `ClerkAuthGuard` | Qualquer usuário autenticado pode reservar uma quadra — um cliente não precisa ser `ArenaMember` (`OWNER`/`ADMIN`) da arena. O domínio ainda não tem um papel de "cliente" em `ArenaMember`; exigir associação inviabilizaria a própria funcionalidade. |
| Listar ocupação (`GET .../bookings`) | só `ClerkAuthGuard` | Mesmo raciocínio — qualquer autenticado pode ver "este horário está livre?" (sem dados pessoais de terceiros, ver Parte 10). |
| Consultar disponibilidade (`GET .../availability`) | só `ClerkAuthGuard` | Idem — informativo, sem exigir vínculo com a arena. |
| Criar `BLOCK`/`MAINTENANCE` | `ArenaAccessGuard` + `@RequireArenaRole(OWNER, ADMIN)` | Ocupação administrativa — mesmo padrão de `CourtsController` para rotas de escrita. |
| Listagem administrativa (`GET .../bookings/admin`) | `ArenaAccessGuard` + `@RequireArenaRole(OWNER, ADMIN)` | Expõe dados do responsável pela reserva (Parte 10) — só para quem administra a arena. |
| Cancelar (`POST .../bookings/:bookingId/cancel`) | só `ClerkAuthGuard` | Autorização por **recurso** (dono da reserva OU `OWNER`/`ADMIN` da arena), não por papel estático de rota — não expressável por `@RequireArenaRole`. Resolvida dentro de `BookingsService.cancel`, que consulta `ArenaMembersService.getRole` (retorna `null` sem lançar quando o requisitante não é membro, em vez do `assertAccess` que lançaria 403). |

Em todos os casos, a cadeia `arenaId → courtId → booking` é sempre validada explicitamente dentro do
service (nunca confiando só em `courtId` — ver Parte 10), reaproveitando `CourtsService.findOne` (o
mesmo 404 "quadra não encontrada" da Fase 3) fora da transação de criação, e uma checagem equivalente
via `tx.court.findFirst` dentro dela (a criação roda em transação após o advisory lock — ver Parte
8 — e por isso não pode reaproveitar `CourtsService.findOne`, que usa o client Prisma fora da
transação).

---

## Parte 8 — Regra de reserva: prevenindo double booking

Esta é a regra mais crítica do sistema e a resposta usa **defesa em profundidade**, inteiramente
apoiada no PostgreSQL — **Redis não faz parte da garantia de integridade da reserva**. Cache e fila
(Parte 5) são otimização/trabalho assíncrono; a correção da reserva não pode depender deles.

As camadas de proteção, na ordem em que atuam durante uma criação de reserva:

**1. Transação**
Toda a criação de reserva acontece dentro de uma única transação Postgres — a checagem de
disponibilidade, a inserção do `Booking` e a checagem final da constraint são atômicas: ou tudo
confirma, ou nada é gravado.

**2. `pg_advisory_xact_lock`**
Logo ao abrir a transação, adquire-se um advisory lock baseado em hash de `courtId`, com escopo
limitado à duração da transação. Isso serializa tentativas concorrentes na mesma quadra sem lockar a
tabela inteira, e é o que permite transformar um conflito em **erro de negócio amigável** ("horário
indisponível") em vez de deixar o usuário esbarrar direto numa exceção de constraint crua.

**Implementado na Fase 4**: `pg_advisory_xact_lock(hashtext(courtId))` — `hashtext()` transforma o
`cuid` (string) de `courtId` numa chave inteira de 32 bits, dando granularidade **por quadra**
(confirmado por teste real: duas quadras diferentes sob concorrência simultânea sucedem as duas —
ver Parte 8, "Teste de concorrência real" abaixo). Uma colisão de hash entre duas quadras diferentes
apenas causaria serialização extra entre elas (nunca perda de segurança — a EXCLUDE constraint
continua sendo a autoridade final independentemente do lock).

**3. Validação de negócio no backend**
Com o lock em mãos, o backend valida: horário dentro do funcionamento da quadra, quadra ativa, dentro
da janela mínima/máxima de antecedência, e verifica overlap via query. Nunca confia em nada que o
frontend tenha mostrado como "disponível" — o frontend pode estar com cache desatualizado.

**Implementado na Fase 4** (ordem real dentro da transação, depois do lock): quadra existe nesta
arena → quadra ativa → duração válida (`endsAt > startsAt`) → pré-checagem de conflito via SQL,
reaproveitando a **mesma função `booking_occupied_range(...)`** usada pela exclusion constraint
(item 4), garantindo que a validação preventiva e a autoridade final nunca podem divergir uma da
outra por reimplementação em paralelo. Sem verificação de "horário de funcionamento" ainda (não
existe esse conceito no domínio nesta fase — ver Parte 7).

**4. Exclusion constraint no banco (garantia definitiva)**
Mesmo com os passos acima, a garantia final de que **nenhuma sobreposição jamais é persistida** vem
de uma exclusion constraint do Postgres (extensão `btree_gist`) sobre `courtId` + intervalo de
tempo, avaliada no momento do `INSERT`/`COMMIT`:

```
EXCLUDE USING gist (
  court_id WITH =,
  tsrange(start_time, end_time + (buffer_minutes_snapshot * interval '1 minute')) WITH &&
) WHERE (status IN ('PENDING', 'CONFIRMED'))
```

Isso vale **mesmo sob concorrência extrema** (dois requests no mesmo milissegundo) e **mesmo se
houver um bug na camada de aplicação** (passo 2 ou 3 falharem por algum motivo) — o banco recusa
fisicamente a segunda inserção com uma constraint violation, que a aplicação converte em erro de
negócio antes de devolver ao cliente. É por isso que o `type` unificado de `Booking` importa: uma
única constraint protege `CUSTOMER` contra `CUSTOMER`, `CUSTOMER` contra `BLOCK`/`MAINTENANCE`, e
assim por diante — todos são a mesma coisa para efeito de conflito: uma ocupação de quadra.

Comparado à alternativa mais simples (`UNIQUE(court_id, start_time)`, exigindo grade fixa) — a
exclusion constraint com `tsrange` já resolve hoje o caso de buffer (abaixo) e continua válida se o
MVP evoluir para duração variável, sem precisar de nova migração estrutural.

**Implementado na Fase 4** — a constraint real (`Booking_no_overlap_excl`) difere do esboço acima em
dois pontos importantes, ambos por necessidade técnica real do Postgres, não por escolha estética:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Postgres exige que expressões dentro de um índice GiST sejam IMMUTABLE. O
-- operador `timestamptz + interval` é marcado STABLE no catálogo (a
-- volatilidade é declarada para o operador inteiro, não por unidade — ainda
-- que somar só minutos seja de fato independente de timezone/DST). A solução
-- é envolver a expressão numa função SQL explicitamente marcada IMMUTABLE.
CREATE OR REPLACE FUNCTION booking_occupied_range(
  starts_at timestamptz, ends_at timestamptz, buffer_minutes integer
) RETURNS tstzrange
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT tstzrange(starts_at, ends_at + (buffer_minutes * interval '1 minute'), '[)');
$$;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_no_overlap_excl"
EXCLUDE USING gist (
  "courtId" WITH =,
  booking_occupied_range("startsAt", "endsAt", "bufferMinutesSnapshot") WITH &&
) WHERE (status = 'CONFIRMED');
```

1. **`booking_occupied_range(...)` em vez de `tsrange(...)` direto**: um índice GiST exige que sua
   expressão seja `IMMUTABLE`; o operador `timestamptz + interval` é `STABLE` no catálogo do
   Postgres (a marcação de volatilidade é por operador, não por unidade — mesmo somar só minutos,
   sem componente de calendário, herda a marcação `STABLE` do operador genérico). A migration
   original falhou com `P3006` até essa mudança. A mesma função é reaproveitada pela pré-checagem da
   aplicação (item 3) e pelo `AvailabilityService` (abaixo) — uma única definição de "intervalo
   ocupado", nunca reimplementada em paralelo.
2. **`WHERE (status = 'CONFIRMED')`, não `IN ('PENDING', 'CONFIRMED')`**: `BookingStatus` não tem
   `PENDING` nesta fase (ver Parte 7) — só `CONFIRMED` participa da exclusão; `CANCELLED` nunca
   bloqueia, permitindo cancelar e criar uma nova reserva no mesmo horário.

Comportamento verificado empiricamente contra o Postgres real (não apenas assumido): a violação
chega como `Prisma.PrismaClientUnknownRequestError` (SQLSTATE `23P01`, `exclusion_violation`) — **não**
como `PrismaClientKnownRequestError` com um P-code (diferente de, por exemplo, `P2002` para unique
constraints — Prisma não tem um código dedicado para exclusion constraints). `BookingsService`
detecta isso verificando `error.message.includes('23P01')`, e mapeia para `409 Conflict`.

**5. `Idempotency-Key`**
`POST /bookings` exige um header `Idempotency-Key` (gerado pelo frontend por tentativa de reserva).
Se o mesmo request for reenviado (double-click, retry de rede), o backend retorna a reserva já
criada em vez de tentar criar de novo. Isso resolve um problema diferente (mas relacionado) do
double booking entre usuários distintos: duplicata causada pelo mesmo usuário/cliente HTTP.

**Implementado na Fase 4** — `IdempotencyService.execute()` (tabela `IdempotencyKey` própria, unique
`(userId, endpoint, key)`, nunca em memória, nunca dependente de Redis) usa estratégia
**claim-first**: a linha é inserida (com placeholder) **antes** do handler de criação rodar, e só
atualizada com a resposta real depois — dentro da mesma transação:

```
BEGIN
  ↓
INSERT IdempotencyKey (placeholder)  ← reserva a chave primeiro
  ↓
handler(tx): advisory lock → validações → pré-checagem → INSERT Booking
  ↓
UPDATE IdempotencyKey (resposta real)
  ↓
COMMIT
```

Por que "claim-first" e não "claim-last" (registrar a chave só depois do handler, como uma primeira
versão desta implementação tentou): o handler de criação **já tem sua própria proteção contra
conflito** (itens 2–4 acima). Com "claim-last", duas requisições concorrentes usando a **mesma**
chave (ex: um retry automático do cliente) ficavam serializadas pelo advisory lock da própria
criação — a segunda, ao ser liberada, encontrava a reserva que a primeira acabara de commitar e a
pré-checagem de conflito a rejeitava com `409`, interpretando (incorretamente) que era *outra*
pessoa disputando o mesmo horário. Isso foi detectado pelo teste de concorrência real da Fase 4
(duas requisições simultâneas com a mesma `Idempotency-Key`) e corrigido para "claim-first": o
`INSERT` do placeholder acontece **antes** de qualquer lock/validação de domínio, então a segunda
requisição esbarra no índice único de `IdempotencyKey` **antes** de chegar perto do handler —
nunca chega a competir com a própria lógica de conflito de horário. Se perder a corrida
(violação de unicidade no placeholder), a transação inteira reverte (nunca chegou a rodar o
handler) e a requisição perdedora relê a linha (agora com a resposta real da vencedora) e a
replica — mesmo `Booking`, mesmo status `201`, nunca dois `Booking`s. Verificado com teste real
via `Promise.all` contra o servidor (não simulado) — ver "Teste de concorrência real" abaixo.

Mesma chave reutilizada com payload diferente (hash do payload não bate com o registrado) é
rejeitada com `409 Conflict`, nunca silenciosamente aceita como uma operação nova.

### Buffer entre reservas: decisão de onde ele é protegido

`bufferMinutes` (configurado por quadra) é o intervalo mínimo, **após o fim de uma reserva de
cliente**, antes que o próximo horário fique disponível. Exemplo com `slotDurationMinutes = 60` e
`bufferMinutes = 10`:

```
Reserva:        19:00–20:00
Próximo horário possível: 20:10
```

Havia duas formas de implementar isso:

| Alternativa | Como funciona | Risco |
|---|---|---|
| Regra só na geração de disponibilidade | O endpoint de disponibilidade "esconde" os 10 min seguintes a uma reserva ao montar a lista de slots livres | O banco continua aceitando, sem erro, uma reserva às 20:00 logo após uma que termina às 20:00 (buffer zero na prática) se a criação não passar pelo endpoint de disponibilidade — ex: reserva manual do admin, bug de UI, chamada futura da IA/WhatsApp fora do fluxo normal |
| **Buffer dentro da exclusion constraint (escolhida)** | O intervalo protegido por reserva não é `[startTime, endTime)`, e sim `[startTime, endTime + bufferMinutes)`. O valor de buffer é **congelado por reserva** em `Booking.bufferMinutesSnapshot` (copiado de `Court.bufferMinutes` no momento da criação) | Nenhum — o banco fisicamente recusa qualquer inserção que viole o buffer, por qualquer caminho de criação |

**Decisão: buffer faz parte do intervalo protegido pela exclusion constraint**, não apenas da
geração de disponibilidade. É a alternativa tecnicamente mais segura pelo mesmo motivo que justifica
a própria constraint (Parte 8, item 4): a garantia de negócio mais crítica do sistema não pode
depender de todo caminho de código passar pela mesma função de cálculo de disponibilidade.

O valor precisa ser **congelado no momento da criação** (`bufferMinutesSnapshot`) em vez de lido de
`Court.bufferMinutes` a cada verificação, porque uma exclusion constraint do Postgres exige uma
expressão de índice estável — ela não pode depender de uma coluna mutável de outra tabela que pode
mudar depois (se o admin alterar o buffer da quadra, reservas já existentes não devem ter seu
intervalo protegido recalculado retroativamente). Isso segue o mesmo padrão já usado para
`Booking.totalPrice` (Parte 7): valores que afetam uma reserva específica são copiados para a linha
da reserva no momento em que ela é criada.

O buffer só se aplica a ocupações do tipo `CUSTOMER` (`bufferMinutesSnapshot = 0` por padrão para
`BLOCK`/`MAINTENANCE` — um bloqueio administrativo ocupa exatamente o intervalo declarado, sem
extensão implícita) e é aplicado apenas **após** o fim da reserva, não antes do início, conforme o
exemplo acima.

O endpoint de disponibilidade (Parte 9) usa exatamente essa mesma regra ao montar a lista de slots
livres — não uma regra paralela — porque ele consulta os mesmos `Booking`s e considera o mesmo
`bufferMinutesSnapshot`/`Court.bufferMinutes` vigente.

### Disponibilidade (implementação Fase 4, revisada na Fase 5)

`AvailabilityService` é **somente leitura** — nunca cria `Booking` como efeito colateral de uma
consulta (item 61 do prompt da Fase 4). É também **apenas informativa**: o resultado de uma consulta
de disponibilidade não é garantia de reserva — entre a consulta e uma tentativa real de criação,
outra pessoa pode reservar o mesmo horário. A proteção real continua sendo inteiramente o fluxo de
criação (itens 1–5 acima), nunca o resultado de uma consulta anterior.

**Fase 4 (histórico)**: como `ArenaOperatingHours` ainda não existia, os slots eram gerados numa
grade matemática fixa de `Court.slotDurationMinutes`, ancorada no `from` da própria consulta —
decisão explicitamente provisória, documentada como tal.

**Implementado na Fase 5**: a grade passou a ser derivada do horário de funcionamento real da
arena, no timezone da arena, em três etapas conceituais:

1. **Determinar o calendário local da Arena**: a janela `[from, to)` (instantes) é convertida para
   dias civis locais via Luxon (`DateTime.fromJSDate(instant, { zone: arena.timezone })`); cada dia
   tocado pela janela é percorrido separadamente.
2. **Gerar slots válidos dentro do horário de funcionamento**: para cada dia, resolve-se o
   `Weekday` local e busca-se os intervalos de `ArenaOperatingHours` configurados para ele. Dentro
   de cada intervalo, os slots são gerados em incrementos de `Court.slotDurationMinutes`
   **ancorados na abertura do intervalo** (não mais no `from` da consulta — correção real sobre a
   Fase 4), parando assim que o fim nominal do próximo slot ultrapassaria o fechamento. Nenhum slot
   é gerado fora de um intervalo configurado; um dia sem nenhum intervalo não gera slot nenhum.
3. **Cruzar os slots com as ocupações existentes**: cada slot candidato é avaliado contra as
   reservas `CONFIRMED` existentes com a mesma semântica de conflito da criação (buffer incluso).

O buffer também precisa caber **antes do fechamento**, não só antes do próximo slot nominal: um
slot cujo horário nominal cabe no intervalo, mas cujo `endsAt + Court.bufferMinutes` ultrapassaria
`closesAt`, fica marcado indisponível — a disponibilidade nunca mostra como "livre" um horário que a
criação recusaria por violar o fechamento (item 25 do prompt da Fase 5). Essa checagem
(`intervalContains`) é a **mesma função** usada por `BookingsService` para validar a criação — nunca
duas implementações da mesma regra (item 41).

Consequência não-óbvia, mas correta, preservada da Fase 4: o buffer de uma reserva confirmada
bloqueia os slots vizinhos da grade **tanto antes quanto depois dela**, não só o slot seguinte —
exatamente porque o buffer de um slot candidato conta pros dois lados da comparação (o dele próprio,
e o de qualquer reserva existente). Exemplo: quadra com `slotDurationMinutes=60`,
`bufferMinutes=15`, arena aberta `08:00–12:00`, reserva confirmada `09:00–10:00`: `08:00–09:00` fica
indisponível (seu **próprio** buffer de saída, até `09:15`, esbarraria no início da reserva às
`09:00`); `09:00–10:00` óbvio; `10:00–11:00` fica indisponível (o buffer **da reserva**, até
`10:15`, esbarra no seu início); só `11:00–12:00`, fora do alcance do buffer nos dois sentidos, fica
livre.

Quadra inativa: todos os slots da janela vêm marcados `available: false` (a grade de horário de
funcionamento ainda é respeitada — só nada fica disponível), sem consultar `Booking` nenhum (item
37).

**Criação de `Booking` também valida horário de funcionamento (item 26)** — não bastava mudar só a
disponibilidade: `BookingsService.createBooking`, depois de calcular `endsAt`/`bufferMinutesSnapshot`
e antes da pré-checagem de conflito, valida (para `CUSTOMER`) se `[startsAt, endsAt + buffer)` cabe
inteiro num intervalo configurado do dia local correspondente — usando a mesma
`isWithinOperatingHours`/`intervalContains` da disponibilidade. Se não couber, `409 Conflict`
("Horário fora do funcionamento da arena"). **`BLOCK`/`MAINTENANCE` não são restringidos por essa
regra** — decisão documentada: são operações administrativas (podem representar um evento fora do
expediente normal, ou manutenção de madrugada), mesmo padrão já usado para buffer=0 administrativo
na Fase 4.

**Alterar o horário de funcionamento (ou o timezone da arena) nunca apaga/recalcula `Booking`s
existentes** — `Booking.startsAt`/`endsAt` são instantes absolutos, gravados uma única vez no
momento da criação; só a disponibilidade futura e novas tentativas de criação passam a refletir a
configuração atual. Confirmado por teste e2e dedicado (`test/bookings.e2e-spec.ts`, describe
"Horário de funcionamento").

**Concorrência entre alteração de horário e criação de `Booking` (item 45)**: as duas transações não
compartilham nenhum lock — a atualização de `ArenaOperatingHours` não toca `Booking`/o advisory lock
por quadra, e a criação de `Booking` só **lê** `ArenaOperatingHours` dentro da sua própria
transação. Isso significa que rodam de fato em paralelo, e não há uma ordem "correta" única — o que
importa é que nunca existe estado parcial: a atualização de horário é uma substituição transacional
completa (apaga tudo e recria), então qualquer leitura concorrente vê ou a configuração inteira
antiga, ou a inteira nova, nunca uma mistura; e a criação de `Booking` sempre resulta em `201` ou
`409`, nunca um erro cru. Validado com teste real via `Promise.all`
(`test/bookings.e2e-spec.ts`).

### Teste de concorrência real (Fase 4)

Requisitos obrigatórios da Fase 4 validados com `Promise.all` contra o **servidor Nest real e o
Postgres real** (nunca mockado) — `test/bookings-concurrency.e2e-spec.ts`:

1. **Mesma quadra, mesmo horário, chaves de idempotência diferentes** (duas pessoas distintas
   disputando o mesmo horário): exatamente uma recebe `201`, a outra `409` — nunca duas `201`.
   Repetido 8 vezes em janelas de horário distintas na mesma execução, e a suíte inteira rodada
   repetidamente sem flakiness observada.
2. **Quadras diferentes, mesmo horário**: as duas sucedem — prova de que o advisory lock tem
   granularidade por quadra (`hashtext(courtId)`), nunca lock global.
3. **Mesma `Idempotency-Key`, mesmo usuário, disparada duas vezes simultaneamente**: as duas
   respostas retornam `201` com o **mesmo** `Booking` (nunca uma `201` + uma `409`, nem dois
   `Booking`s criados) — este teste foi o que revelou a necessidade de "claim-first" descrita acima
   (a primeira versão "claim-last" falhava exatamente aqui, com a segunda resposta voltando `409`
   em vez de replicar a primeira).

---

## Parte 9 — API

Prefixo de versão: `/v1`. Autenticação via Bearer token (sessão Clerk) em **todas** as rotas —
inclusive descoberta de arenas (Fase 6): "pública" aqui significa "sem exigir `ArenaMember`", não
"sem autenticação" (ver item 3 da v0.6 acima). Erros em formato consistente
(`{ statusCode, message, error, requestId }`). Paginação cursor-based em listagens
(`?cursor=...&limit=...`). CORS habilitado (`WEB_APP_URL`, Fase 6) para o frontend em outra origem
poder chamar a API do browser.

```
Auth
  GET    /v1/users/me                        # perfil do usuário logado (criado/sincronizado via Clerk)
  PATCH  /v1/users/me
  POST   /v1/webhooks/clerk                  # sync de usuário (assinado, não é rota "de auth" tradicional)

Sports
  GET    /v1/sports                          # catálogo de modalidades

Arenas                                                              [Fase 3]
  GET    /v1/arenas                          # arenas ADMINISTRADAS pelo usuário (não ressemantizado na Fase 6)
  POST   /v1/arenas                          # cria arena (usuário vira OWNER)
  GET    /v1/arenas/:arenaId                 # requer ser membro — inclui members[] e courts[]
  PATCH  /v1/arenas/:arenaId                 # requer OWNER/ADMIN
  POST   /v1/arenas/:arenaId/images          # ainda não implementado

Arenas — descoberta pública                                         [Fase 6]
  GET    /v1/arenas/discover                 # só ClerkAuthGuard (sem ArenaMember); nunca members/role;
         # sports[] derivado das quadras ativas; registrado ANTES de GET /v1/arenas/:arenaId
  GET    /v1/arenas/discover/:arenaId        # detalhe + courts[] (só quadras ativas), inclui timezone;
         # 404 se a arena não existir

Arena members (RBAC)                                    [ainda não implementado]
  GET    /v1/arenas/:arenaId/members
  POST   /v1/arenas/:arenaId/members          # convite (requer OWNER/ADMIN)
  PATCH  /v1/arenas/:arenaId/members/:userId  # trocar papel
  DELETE /v1/arenas/:arenaId/members/:userId

Courts                                                              [Fase 3]
  GET    /v1/arenas/:arenaId/courts                       # ?includeInactive=true inclui inativas
  POST   /v1/arenas/:arenaId/courts           # requer OWNER/ADMIN
  GET    /v1/arenas/:arenaId/courts/:courtId              # aninhado sob arena, não /v1/courts/:courtId
  PATCH  /v1/arenas/:arenaId/courts/:courtId  # requer OWNER/ADMIN — inclui ativar/desativar
  DELETE /v1/arenas/:arenaId/courts/:courtId               # ainda não implementado (usa isActive)

Operating hours                                                     [Fase 5]
  GET    /v1/arenas/:arenaId/operating-hours
         # só ClerkAuthGuard (sem exigir ArenaMember, mesmo padrão de availability/CUSTOMER);
         # retorna [] para arena sem horário configurado (fechada todo dia)
  PUT    /v1/arenas/:arenaId/operating-hours
         # requer OWNER/ADMIN; substitui a semana inteira (transacional — tudo ou nada);
         # body { intervals: [{ dayOfWeek, opensAt: "HH:mm", closesAt: "HH:mm" }] };
         # dia ausente da lista fica fechado; [] fecha a arena todo dia

Bookings                                                            [Fase 4]
  POST   /v1/arenas/:arenaId/courts/:courtId/bookings
         # cria CUSTOMER — só ClerkAuthGuard (sem exigir ArenaMember, ver Parte 7);
         # Idempotency-Key obrigatório; body só {startsAt} — duração/endsAt/total/status são
         # sempre determinados pelo backend
  POST   /v1/arenas/:arenaId/courts/:courtId/bookings/blocks
         # cria BLOCK — requer OWNER/ADMIN; Idempotency-Key obrigatório; body {startsAt, endsAt, reason?}
  POST   /v1/arenas/:arenaId/courts/:courtId/bookings/maintenance
         # cria MAINTENANCE — requer OWNER/ADMIN; mesmo contrato de blocks
  GET    /v1/arenas/:arenaId/courts/:courtId/bookings?from=...&to=...
         # ocupação (sem PII — nunca userId/reason/total), from/to obrigatórios
  GET    /v1/arenas/:arenaId/courts/:courtId/bookings/admin?from=...&to=...
         # requer OWNER/ADMIN — inclui userId/user/reason/total/cancelledAt, e reservas CANCELLED
  POST   /v1/arenas/:arenaId/courts/:courtId/bookings/:bookingId/cancel
         # dono da reserva OU OWNER/ADMIN da arena; idempotente (cancelar 2x não é erro)

Availability                                                        [Fase 4, revisado na Fase 5]
  GET    /v1/arenas/:arenaId/courts/:courtId/availability?from=...&to=...
         # só ClerkAuthGuard; somente leitura, nunca cria Booking; slots respeitam o horário
         # de funcionamento real da arena (ver Parte 8, "Disponibilidade")
         # resposta: { courtId, timezone, from, to, slots: [{ startsAt, endsAt, available }] }

Minhas reservas (cliente)                                           [Fase 6]
  GET    /v1/users/me/bookings               # só ClerkAuthGuard; filtra userId=chamador E type=CUSTOMER
         # no próprio WHERE (nunca busca tudo e filtra depois); inclui court{arena{timezone}} aninhado
  GET    /v1/users/me/bookings/:bookingId    # idem, filtrado por dono; 404 (nunca 403) se não for do
         # chamador; cancelamento reaproveita POST .../bookings/:bookingId/cancel acima, sem rota nova

Dashboard (administrativo)                                          [Fase 7]
  GET    /v1/arenas/:arenaId/dashboard?date=YYYY-MM-DD
         # ArenaAccessGuard + @RequireArenaRole() (qualquer ArenaMember — só pode ser OWNER/ADMIN,
         # CUSTOMER nunca é membro); date opcional, default = hoje no timezone da arena; uma única
         # consulta de Booking cruzando todas as quadras (court: { arenaId }), sem N+1; nunca
         # recalcula disponibilidade (isso continua exclusivo de GET .../availability)
         # resposta: { arena, date, operatingHours, summary, courts[com occupancy], upcomingBookings }
```

**Mudanças da Fase 4 em relação ao esboço original**: as rotas de `Booking`/disponibilidade ficaram
aninhadas sob `/arenas/:arenaId/courts/:courtId/...` (não `/v1/bookings` nem `/v1/courts/:courtId/...`
soltos) — mesmo motivo da Fase 3 para `Court`: nunca confiar só em `courtId`, sempre validar a cadeia
arena→court. Não existe `GET /v1/bookings/:bookingId` nem `GET /v1/users/me/bookings` globais ainda
(listagem sempre passa por uma quadra específica, com janela de tempo obrigatória — item 31 do
prompt da Fase 4, evitar consulta ilimitada). `POST /v1/courts/:courtId/blocks` do esboço original
virou `POST .../bookings/blocks`, aninhado sob `bookings` em vez de um recurso irmão — mantém a regra
"o backend controla o tipo de `Booking` permitido pela operação" (endpoint determina o `type`, nunca
um campo no body).

**Mudanças da Fase 5**: `Operating hours` saiu do esboço original (`/v1/courts/:courtId/...`) e
ficou sob `/v1/arenas/:arenaId/operating-hours` — porque o horário de funcionamento pertence à
Arena, não à Court (Parte 7); usar `courtId` no path teria sugerido, incorretamente, uma
configuração por quadra. `GET .../availability` ganhou `timezone` e `courtId` no corpo da resposta,
ao lado de `slots` (mudança de contrato justificada: array solto virou objeto — não há cliente
frontend consumindo esse endpoint ainda, então o custo real da mudança é zero).

Mudanças em relação ao esboço do briefing: rotas de disponibilidade e bloqueio ficaram sob `/courts`
(o recurso dono do conceito), reservas administrativas (bloqueio) reaproveitam o mesmo recurso
`Booking` em vez de um endpoint espelhado, e adicionei `/arenas/:arenaId/members` porque RBAC é
tratado como cidadão de primeira classe da API, não um detalhe interno.

**Mudanças da Fase 3 em relação a este desenho original:** as rotas de quadra ficaram totalmente
aninhadas sob `/arenas/:arenaId/courts/:courtId` (não `/v1/courts/:courtId` solto) — isso é o que
faz o `ArenaAccessGuard` funcionar sem nenhum código extra, e evita a possibilidade de acessar uma
quadra sem que a arena dona apareça na própria URL. `GET /v1/arenas` e `GET /v1/arenas/:arenaId`
exigem associação (`ArenaMember`) — a busca pública citada aqui só faz sentido quando existir um
storefront público de fato (marketplace), fora do escopo até então. `POST /v1/arenas/:arenaId/images`
e todo o bloco de `Arena members` (convite/troca de papel) permanecem no papel — hoje a única forma
de virar `ADMIN` de uma arena é acesso direto ao banco.

---

## Parte 10 — Segurança

| Risco | Mitigação |
|---|---|
| Acesso cross-tenant (staff da Arena A vendo/editando dados da Arena B) | Todo guard de rota que recebe `:arenaId` (ou resolve a arena via `:courtId`/`:bookingId`) verifica `ArenaMember` da arena correta — nunca confia em role global |
| Escalonamento de privilégio | Papéis vivem só em `ArenaMember`, nunca em claim editável pelo cliente; alterações de papel exigem já ser OWNER/ADMIN da mesma arena |
| Input malicioso | DTOs com `class-validator` em toda rota, `ValidationPipe` global com `whitelist: true, forbidNonWhitelisted: true` |
| Força bruta / abuso de endpoint de reserva (scalping de horários) | Rate limiting (`@nestjs/throttler`) mais agressivo em `POST /bookings` e rotas de auth |
| SQL Injection | Prisma parametrizado; proibido `$queryRawUnsafe` com input não sanitizado |
| XSS | React escapa por padrão; sanitizar campos ricos (descrição de arena) se algum dia virar HTML; CSP nos headers do Next |
| CSRF | API usa Bearer token (não cookie de sessão) — risco baixo; se o Clerk usar cookie em algum fluxo, `SameSite=Lax` + checagem de origem |
| Segredos vazando | `.env` fora do git, secrets no provedor (Vercel/Railway), nunca logar token/senha |
| Webhooks forjados (Clerk agora; Asaas/WhatsApp depois) | Validar assinatura HMAC com o raw body antes de parsear/confiar no payload |
| Exposição de dados pessoais | Listagens nunca retornam dados de outro usuário; telefone/e-mail nunca em log; resposta de erro não vaza stacktrace em produção |
| Reserva duplicada por retry de rede | Idempotency-Key (ver Parte 8) |
| Dependências vulneráveis | Dependabot/`npm audit` no CI |

**Nota da Fase 4** — privacidade de `Booking`: a listagem pública (`GET .../bookings`) e a
administrativa (`GET .../bookings/admin`) têm `select` do Prisma **diferentes**, não o mesmo dado
filtrado depois em código — a versão pública nunca inclui `userId`/`reason`/`total` na própria
query, então não há campo sensível para "esquecer de remover" na resposta. Um usuário sem acesso não
descobre a existência de um `Booking` só sabendo o `courtId`: toda operação sobre um `Booking`
específico (`cancel`) valida a cadeia `arenaId → courtId → bookingId` — trocar apenas o `courtId`
por um de outra arena resulta em `404`, nunca vaza se o recurso existe. Cross-tenant testado
explicitamente (e2e): `OWNER` de uma arena não cria `BLOCK`/não vê a listagem administrativa de
outra arena onde não é membro.

**Nota da Fase 5** — `GET .../operating-hours` segue o mesmo padrão de acesso de
disponibilidade/`CUSTOMER` (Parte 7): só `ClerkAuthGuard`, sem exigir `ArenaMember` — saber quando a
arena abre é informação pública por natureza (faz parte de decidir se vale a pena tentar reservar).
`PUT` continua exigindo `OWNER`/`ADMIN` da arena correta, testado cross-tenant (e2e): `OWNER` de uma
arena não altera o horário de outra onde não é membro.

**Nota da Fase 6** — descoberta pública e "minhas reservas": `GET /arenas/discover...` nunca inclui
`members`/`role` na própria query (mesmo princípio de `select` diferente por audiência da Fase 4, não
filtragem depois em código) e só lista/retorna quadras **ativas**. `GET /users/me/bookings...` filtra
`userId = chamador` **e** `type = CUSTOMER` no `WHERE` do Prisma — o filtro por `type` evita que um
admin veja seus próprios `BLOCK`/`MAINTENANCE` (que também têm `userId` preenchido) como se fossem
"minhas reservas de cliente"; testado explicitamente (e2e) com um usuário que é `OWNER` de uma arena
e só criou `BLOCK` nela — a lista retorna vazia. Detalhe de reserva de outro usuário retorna `404`
(nunca `403`), mesmo padrão de "nunca vazar existência" já usado desde a Fase 3. Nenhum dado de
`Booking` chega ao cliente por uma rota que não seja `GET /users/me/bookings...` ou os endpoints de
`Booking` por quadra já existentes (Fase 4) — não há uma terceira via de listagem.

**Nota da Fase 7** — Dashboard: reaproveita `ArenaAccessGuard` + `@RequireArenaRole()` sem nenhuma
modificação, mesmo mecanismo já usado desde a Fase 3. Testado explicitamente (e2e): usuário sem
vínculo com a arena (equivalente a `CUSTOMER`) recebe `403`; `OWNER` de uma arena B não acessa o
Dashboard da arena A digitando a URL manualmente (`403`, cross-tenant); arena inexistente retorna
`404`. Nenhuma reserva ou quadra de outra arena aparece na resposta — a consulta de `Booking` é
sempre filtrada por `court: { arenaId }`, nunca por um `courtId`/`arenaId` solto vindo do cliente.
O frontend nunca decide se o usuário pode ver o Dashboard: só reage ao `403` do backend com uma
mensagem amigável (item 11 da Fase 7 — "mesmo que o frontend mostre uma arena, o backend valida de
novo").

**Nota da Fase 8 (Hardening)** — auditoria de segurança dedicada, sem mudança de mecanismo: 21
testes novos (`hardening.e2e-spec.ts`) provaram mass assignment bloqueado em todo endpoint de
escrita (`userId`/`role`/`type`/`status`/`total`/`bufferMinutesSnapshot`/`arenaId`/`slug` — nenhum
aceito fora do DTO whitelisted), IDOR sistemático negado em 7 rotas administrativas cruzando Arena
A/B, e isolamento de `Idempotency-Key` entre usuários, entre endpoints, e após uma falha genuína
(a chave nunca fica "presa" — a transação inteira, inclusive o placeholder de idempotência, reverte
junto com qualquer erro do handler). Dois bugs reais de correção (não de autorização) encontrados e
corrigidos — ver "Decisões revisadas na v0.8": cache do frontend não limpo no logout, e um
deslocamento de 1h na geração de slots no dia em que o DST começa. Nenhuma vulnerabilidade crítica
de autenticação/autorização/multi-tenancy encontrada.

---

## Roadmap incremental

### Processo de desenvolvimento: testes fazem parte de cada fase

O processo **não** é "implementar tudo → testar no final". É:

```
implementar feature → testar feature → validar → seguir para a próxima feature
```

A partir da Fase 2, cada fase abaixo já inclui os testes automatizados da sua própria
funcionalidade como parte do trabalho da fase, não como pendência para depois. A fase de
**hardening** (Fase 8 — renumerada na v0.6 após a consolidação da Fase 6, ver "Decisões revisadas
na v0.6"; já havia sido renumerada na v0.4 após a consolidação da Fase 4) continua existindo, mas
com propósito diferente: deixa de ser "a fase em que se escreve teste pela primeira vez" e passa a
ser onde a base já testada por fase recebe E2E completo da jornada do cliente, testes de
carga/concorrência mais agressivos e revisão de segurança ponta a ponta.

**Definição de pronto (Definition of Done), válida para toda fase de 2 a 11:** uma funcionalidade
não é considerada concluída se:
- não possui testes automatizados adequados (unitário e/ou integração, conforme o caso);
- quebra alguma funcionalidade existente (suíte de regressão das fases anteriores precisa continuar
  verde no CI);
- não respeita RBAC (acesso indevido entre arenas ou entre papéis não é bloqueado);
- não trata erros adequadamente (respostas de erro claras, sem vazar detalhe interno);
- não possui validação de entrada no backend (nunca só no frontend).

Os critérios de conclusão de cada fase abaixo são um recorte específico dessa definição — o que
testar em cada uma — mas a definição geral vale para todas.

### Fase 0 — Arquitetura
- **Objetivo:** alinhar este documento antes de qualquer código.
- **Funcionalidades:** nenhuma (documento).
- **Dependências:** nenhuma.
- **Critério de conclusão:** você aprova este documento (ou pede ajustes).

### Fase 1 — Setup
- **Objetivo:** esqueleto do monorepo rodando localmente, já com pipeline de testes configurado.
- **Funcionalidades:** monorepo (pnpm + Turborepo), Next.js e NestJS mínimos ("hello world"), Docker
  Compose com Postgres + Redis, Prisma inicial conectado, lint/prettier, CI com etapas de
  lint + build + **test** (mesmo que os testes iniciais sejam smoke tests triviais — o pipeline
  precisa existir desde já, não ser adicionado depois).
- **Dependências:** Fase 0 aprovada.
- **Critério de conclusão:** `docker compose up` sobe Postgres/Redis, `api` responde um healthcheck,
  `web` renderiza uma página, CI verde (lint + build + test) em um PR de teste.

### Fase 2 — Autenticação
- **Objetivo:** login funcional ponta a ponta.
- **Funcionalidades:** integração Clerk no frontend, guard de validação de sessão no NestJS, webhook
  de sync `User`, tela de perfil básica.
- **Dependências:** Fase 1.
- **Critério de conclusão:** usuário cria conta, loga, acessa uma rota protegida da API com o token
  do Clerk, `User` correspondente existe no Postgres. Testes automatizados cobrindo: rota protegida
  rejeita request sem token/com token inválido (401 claro), aceita com token válido; webhook de sync
  tem teste de integração. Suíte da Fase 1 continua verde.

### Fase 3 — Arenas e Quadras ✅ concluída
- **Objetivo:** CRUD de arena e quadra com autorização por arena nascendo junto. Absorveu o escopo
  originalmente planejado como uma "Fase 4 — Quadras" separada — a sequência de fases foi
  consolidada durante a execução (Arena e Court entregues juntos), sem perder nenhum critério das
  duas fases originais.
- **Funcionalidades entregues:** `Arena`, `ArenaMember` (`OWNER`/`ADMIN`), `Court` (enum `Sport`,
  `isActive`) — ver "Decisões revisadas na v0.3" e Parte 7 para os campos exatos; criar arena
  (usuário vira `OWNER` via `ArenaMember`, sem limite de quantas arenas um usuário pode criar),
  editar dados, CRUD de `Court` aninhado (nome, modalidade, ativar/desativar), `ArenaAccessGuard` +
  `@RequireArenaRole(...)` reutilizáveis (Parte 7).
- **Dependências:** Fase 2.
- **Critério de conclusão:** usuário autenticado cria uma arena e edita; um segundo usuário
  confirma que **não** consegue ler/editar a arena do primeiro nem criar quadra nela, nem acessar
  uma quadra de uma arena por outra (IDOR) — todos cobertos por teste de integração (e2e contra
  Postgres real), não apenas validado manualmente. Testes cobrindo validação de DTO (nome vazio,
  slug em formato inválido, modalidade inválida — erro claro) e erro de recurso inexistente (404).
  Um mesmo usuário consegue criar uma segunda arena com sucesso (confirma ausência de limite
  artificial). Nome de quadra único por arena e slug de arena único testados (409). Regressão das
  Fases 1-2 verde (29 testes e2e no total, incluindo os das fases anteriores).

### Fase 4 — Disponibilidade e Booking ✅ concluída
- **Objetivo:** o coração do produto — núcleo de reservas e disponibilidade, resistente a
  concorrência real. Absorveu o escopo originalmente planejado como duas fases separadas ("Fase 5 —
  Disponibilidade" e "Fase 6 — Reservas") — mesmo padrão de consolidação já usado pela Fase 3, sem
  perder nenhum critério das fases originais que já fazia sentido nesta etapa (o que ficou de fora,
  como `CourtOperatingHours`, está listado abaixo).
- **Funcionalidades entregues:** `Booking`/`BookingType`/`BookingStatus`/`IdempotencyKey` (ver Parte
  7), `Court.pricePerSlot`/`slotDurationMinutes`/`bufferMinutes`; criação de `CUSTOMER` (só
  autenticação, duração fixa, buffer aplicado, total congelado), `BLOCK`/`MAINTENANCE`
  (`OWNER`/`ADMIN`); prevenção de double booking em defesa por camadas real (`pg_advisory_xact_lock`
  por quadra + pré-checagem + `EXCLUDE USING GIST` com função `IMMUTABLE` — Parte 8);
  `Idempotency-Key` persistida (`IdempotencyKey`, estratégia "claim-first"); listagem com privacidade
  em duas camadas (ocupação sem PII vs. administrativa); cancelamento idempotente (dono da reserva ou
  `OWNER`/`ADMIN`); disponibilidade em grade fixa (decisão provisória documentada, Parte 8).
- **Dependências:** Fase 3.
- **Critério de conclusão:** teste de concorrência real via `Promise.all` contra o servidor (não
  simulado) prova: (a) duas requisições para o mesmo horário na mesma quadra resultam em exatamente
  uma confirmada e a outra em erro de negócio claro (`409`), nunca duas confirmadas — repetido 8x sem
  falha; (b) a mesma operação em quadras diferentes sucede nas duas (lock não é global); (c) a mesma
  `Idempotency-Key` disparada duas vezes simultaneamente nunca cria dois `Booking`s. Testes de
  boundary temporal e de buffer entre todas as combinações de tipo (`CUSTOMER`↔`CUSTOMER`,
  `CUSTOMER`↔`BLOCK`, `BLOCK`↔`CUSTOMER`, `MAINTENANCE`↔`CUSTOMER`) passando. Teste de quadra inativa
  (rejeita novos `Booking`s, preserva histórico, reativação funciona). Teste de idempotência
  (repetição exata, payload diferente rejeitado, concorrência). Teste cross-tenant (`OWNER` de uma
  arena não cria `BLOCK`/não vê admin de outra; trocar `courtId` por um de outra arena não vaza
  existência de `Booking`). Migration validada em banco limpo (`DROP SCHEMA public CASCADE` +
  `prisma migrate deploy`, sem intervenção manual). Regressão das fases 1-3 verde (136 testes no
  total entre unitários e e2e, incluindo os das fases anteriores).
- **Deixado para fases futuras** (explicitamente fora do escopo desta fase): `CourtOperatingHours`/
  horário de funcionamento por arena, `Arena.timezone`, calendário visual, reservas recorrentes,
  Payment/checkout/PIX/cartão/reembolso, notificações, WhatsApp, IA, papel `STAFF`, sistema avançado
  de permissões.

### Fase 5 — Horários de Funcionamento, Timezone e Disponibilidade Real ✅ concluída
- **Objetivo:** fazer a disponibilidade deixar de ser uma grade puramente matemática e passar a
  refletir a operação real de cada arena — quando ela está de fato aberta, no timezone correto.
  Ocupa o número que a v0.4 havia reservado para "Fase 5 — Dashboard" (mesmo padrão de consolidação
  já usado pelas Fases 3 e 4) — Dashboard e as fases seguintes foram renumeradas.
- **Funcionalidades entregues:** `Arena.timezone` (IANA, validado contra `Intl.supportedValuesOf`);
  `ArenaOperatingHours`/`Weekday` (horário de funcionamento semanal, múltiplos intervalos por dia,
  pertence à Arena — ver Parte 7); disponibilidade recalculada com timezone real via Luxon (slots
  ancorados na abertura de cada intervalo, nunca fora do horário de funcionamento, buffer respeitando
  também o fechamento); criação de `CUSTOMER` validando horário de funcionamento (`BLOCK`/
  `MAINTENANCE` deliberadamente isentos); `GET`/`PUT /v1/arenas/:arenaId/operating-hours`
  (substituição semanal atômica, só `OWNER`/`ADMIN` escreve, leitura pública); overnight
  explicitamente não suportado nesta fase (Parte 7).
- **Dependências:** Fase 4.
- **Critério de conclusão:** timezone resolvido corretamente com DST (testado com
  `America/New_York`, mesmo o produto hoje só usando `America/Sao_Paulo`); disponibilidade não gera
  slot fora do horário de funcionamento, nem cujo buffer ultrapasse o fechamento; dia sem horário
  configurado não gera slot nenhum; criação de `CUSTOMER` fora do horário rejeitada (`409`), `BLOCK`/
  `MAINTENANCE` continuam funcionando fora dele; alterar horário/timezone nunca apaga ou recalcula
  `Booking` existente, só afeta disponibilidade futura e novas criações (testado explicitamente);
  concorrência real entre `PUT operating-hours` e criação de `Booking` sem estado parcial (via
  `Promise.all` contra servidor real); testes de concorrência/idempotência da Fase 4 continuam
  passando sem alteração. `PUT` rejeita intervalo `opensAt >= closesAt` e intervalos sobrepostos
  (`400`), atômico (tudo ou nada). Cross-tenant testado (`OWNER` de uma arena não altera horário de
  outra). Migration validada em banco limpo, sem intervenção manual. Regressão das fases 1-4 verde
  (192 testes no total entre unitários e e2e, incluindo os das fases anteriores).
- **Deixado para fases futuras** (explicitamente fora do escopo desta fase): overnight
  (intervalo atravessando meia-noite), representação explícita de "24 horas", feriados/exceções de
  calendário, horário por quadra (override de `ArenaOperatingHours`), calendário visual, reservas
  recorrentes, Payment/checkout, notificações, WhatsApp, IA, papel `STAFF`.

### Fase 6 — Experiência de Reserva do Cliente ✅ concluída
- **Objetivo:** primeira jornada completa do cliente no frontend, ponta a ponta, consumindo só
  endpoints já existentes (Fase 4/5) mais dois novos de leitura. Ocupa o número que a v0.5 havia
  reservado para "Fase 6 — Dashboard" (mesmo padrão de consolidação já usado pelas Fases 3, 4 e 5) —
  Dashboard e as fases seguintes foram renumeradas (+1).
- **Funcionalidades entregues:** login (Clerk) → descoberta pública de arenas (`GET
  /arenas/discover...`, Parte 9) → escolha de quadra → escolha de data → disponibilidade real
  (reaproveitando a Fase 5 sem alterá-la) → seleção de horário → resumo → confirmação
  (`Idempotency-Key` gerada no cliente e reaproveitada em retries da mesma tentativa lógica) →
  "minhas reservas" (`GET /users/me/bookings...`, novo, filtrado por `userId` + `type=CUSTOMER`) →
  cancelamento (reaproveita a rota da Fase 4, sem endpoint novo). CORS habilitado na API. Frontend:
  `luxon` + `@tanstack/react-query` adicionados a `apps/web`; componentes shadcn novos no preset
  já configurado; `<input type="date">` nativo para seleção de data (Parte 6).
- **Dependências:** Fase 5.
- **Critério de conclusão:** cliente autenticado (sem ser `ArenaMember` de nenhuma arena) completa o
  fluxo inteiro busca→reserva→cancelamento pela UI, sem precisar da API diretamente. Backend continua
  a única autoridade: frontend nunca decide disponibilidade/preço/dono da reserva, só reflete a
  resposta da API. `409` (horário ficou indisponível entre consulta e confirmação) tratado com
  mensagem amigável e nova consulta forçada de disponibilidade — nunca assume a grade antiga como
  correta. Duplo clique no botão de confirmar nunca cria duas reservas (botão desabilitado durante o
  envio + mesma `Idempotency-Key` no retry). "Minhas reservas" nunca mostra `BLOCK`/`MAINTENANCE` de
  ninguém nem reserva de outro usuário (testado e2e, incluindo um admin que só criou `BLOCK` — lista
  vazia). Nenhuma lógica de negócio do backend duplicada no frontend (`isWithinOperatingHours`,
  cálculo de preço, checagem de conflito continuam só no backend). Regressão das fases 1-5 verde;
  suíte de componentes (Jest + React Testing Library) cobrindo os estados de carregamento/erro/vazio
  de cada tela, o fluxo de confirmação (chave de idempotência estável, proteção contra duplo clique,
  tratamento de `409`) e o particionamento de "minhas reservas" em abas.
- **Deixado para fases futuras** (explicitamente fora do escopo desta fase): pagamento/PIX/cartão/
  checkout, cupons, recorrência/assinaturas, notificações/WhatsApp/IA, papel `STAFF` no frontend,
  feriados/exceções de calendário, overnight, representação 24h, reserva em nome de terceiro, lista
  de espera, avaliação de arena, chat, testes de browser E2E (Playwright — mesma decisão da Fase 2,
  sem conta Clerk real disponível neste ambiente).

### Fase 7 — Dashboard Operacional da Arena ✅ concluída
- **Objetivo:** primeiro painel utilizável por OWNER/ADMIN no dia a dia — "como está minha arena
  hoje?" respondido em poucos segundos, sem precisar da API diretamente. Deliberadamente mais
  enxuto que a visão original do roadmap (sem gestão de funcionários/convite de `ArenaMember`, sem
  faturamento/relatório financeiro, sem papel `STAFF` — nada disso fazia parte do domínio ainda
  nem foi pedido; ver "Decisões revisadas na v0.7").
- **Funcionalidades entregues:** `GET /v1/arenas/:arenaId/dashboard?date=YYYY-MM-DD` (resumo do
  dia — reservas confirmadas/canceladas, bloqueios, manutenções, ocupação por quadra, próximas
  reservas — numa única consulta sem N+1, timezone da arena como autoridade); área `/dashboard`
  separada da experiência do cliente (`/dashboard`, `/dashboard/:arenaId`,
  `/dashboard/:arenaId/quadras[/:courtId]`, `/dashboard/:arenaId/horarios`,
  `/dashboard/:arenaId/configuracoes`); primeiro editor de horário de funcionamento do produto
  (reaproveita `PUT .../operating-hours` da Fase 5, nunca duplicado); CRUD de quadra acessível pelo
  Dashboard (reaproveita a API da Fase 3); configurações básicas da arena incluindo timezone (IANA
  nativo do runtime, reaproveita `PATCH /v1/arenas/:arenaId`).
- **Dependências:** Fase 6.
- **Critério de conclusão:** OWNER/ADMIN acessam o Dashboard da própria arena; um usuário sem
  vínculo (equivalente a CUSTOMER) recebe 403; acesso cross-tenant por URL manual também recebe
  403; nenhuma reserva/quadra de outra arena aparece no Dashboard (testado e2e); timezone da arena
  respeitado (inclusive DST, `America/New_York`) — nunca o timezone do servidor/navegador; arena
  fechada no dia mostra "Arena fechada" sem inventar horário; quadra inativa aparece marcada, nunca
  escondida; mutações (criar/editar quadra, trocar horário, editar configurações) invalidam o cache
  do Dashboard automaticamente. Regressão das fases 1-6 verde (125 testes unitários + 109 e2e no
  backend; 55 testes de componente no frontend).
- **Deixado para fases futuras** (explicitamente fora do escopo desta fase): criação de
  BLOCK/MAINTENANCE pela UI do Dashboard (a visualização entra, a criação continua só via API —
  nenhuma regra nova de conflito foi criada para viabilizar isso agora), criação de arena pela UI,
  gestão de funcionários/convite de `ArenaMember`, faturamento/relatórios financeiros, papel
  `STAFF`, analytics avançado, calendário mensal/drag-and-drop, tempo real (WebSocket/SSE/polling).

### Fase 8 — Hardening, Segurança e Robustez ✅ concluída
- **Objetivo:** auditar e fortalecer o sistema já construído ("tentar quebrar o ArenaHub antes que
  um usuário real consiga") — sem adicionar funcionalidade de negócio nova. Baseline 100% verde
  antes de qualquer alteração (180 unitários + 109 e2e + build), depois auditoria textual/de código
  e um novo ciclo de testes adversariais visando especificamente mass assignment, IDOR sistemático,
  idempotência sob falha genuína, DST/timezone e cache do frontend.
- **2 problemas reais encontrados e corrigidos** (nenhum deles crítico/explorável por um atacante
  externo — ambos eram bugs de correção, não brechas de autorização):
  1. **Cache do TanStack Query nunca era limpo no logout** — o `<UserButton/>` do Clerk desloga sem
     recarregar a página, então o `QueryClient` (uma instância por sessão do app) mantinha em
     memória dados do usuário anterior (ex: `my-bookings`) até o próximo refetch, visíveis por uma
     janela curta se outra conta logasse na mesma aba em seguida. Corrigido: um componente
     (`ClearQueryCacheOnUserChange`) observa `useAuth().userId` e chama `queryClient.clear()`
     sempre que ele muda (logout ou troca de conta). Ver Parte 6.
  2. **Geração de slots em `AvailabilityService.buildSlots` usava `.plus({minutes})` (duração
     absoluta) para construir o instante de cada slot a partir do horário configurado** —
     `.plus()` soma tempo decorrido real, que cruza a transição de DST deslocando o horário de
     parede em 1h no dia da troca (um slot configurado para abrir às 08:00 abria às 09:00 nesse
     dia). Corrigido para `.set({hour, minute})`, que fixa o horário de parede pedido e deixa o
     Luxon resolver o offset correto para aquele instante — mesma técnica já usada (corretamente)
     por `isWithinOperatingHours` desde a Fase 5. Não afeta arenas em `America/Sao_Paulo` hoje (sem
     DST), mas era um bug real para qualquer timezone que observe DST. Ver Parte 8.
- **Nenhuma vulnerabilidade crítica de autorização/multi-tenancy encontrada** — a bateria de 21
  testes novos (`hardening.e2e-spec.ts`) cobrindo mass assignment em todos os endpoints de escrita,
  IDOR sistemático entre Arena A/B em 7 rotas administrativas, semântica de `@RequireArenaRole()`
  vazio, e isolamento de `Idempotency-Key` (entre usuários, entre endpoints, e após falha genuína)
  passou de primeira em todos os casos — confirmando que as proteções construídas nas Fases 3-5
  já estavam corretas. Reforço de cobertura, não correção: webhook duplicado/reenviado (Fase 2),
  DST na própria geração de slots (achou o bug acima), cascades/constraints do schema (auditados,
  todos conforme o esperado, nenhuma mudança necessária).
- **Playwright avaliado e descartado, com a limitação documentada** (item 78 do prompt da fase):
  segue não havendo conta Clerk real disponível neste ambiente para autenticar uma sessão de
  browser ponta a ponta — criar uma suíte Playwright sem essa autenticação real produziria uma
  falsa sensação de cobertura E2E de UI. Cobertura continua via e2e de API (Nest + Postgres real,
  258 testes) + testes de componente no frontend (59 testes, mockando os hooks de dados).
- **Dependências:** Fases 1-7, cada uma já com sua própria suíte.
- **Critério de conclusão:** baseline e regressão final 100% idênticas (nenhuma fase anterior
  quebrou); 2 bugs reais encontrados via teste automatizado (não só inspeção manual) e corrigidos
  com teste de regressão cada; migrations validadas em banco limpo duas vezes (baseline e final);
  testes de concorrência/idempotência/segurança repetidos 3x sem flakiness; nenhum segredo/token em
  log ou versionado; `git status` revisado, nenhum commit feito.

### Fase 9 — Deploy e Infraestrutura ⚠️ preparada, deploy real bloqueado por custo (Railway) e infraestrutura (Vercel/Clerk produção)
- **Objetivo:** deixar o ArenaHub implantável, reproduzível e observável — sem
  adicionar funcionalidade de negócio nova. Diferente das fases anteriores,
  **não pode ser marcada como concluída da forma usual**: o critério real
  ("uma arena de verdade usável em produção") exige deploy real no Railway
  (bloqueado por custo — Hobby plan pago) e contas em Vercel/Clerk produção
  (bloqueadas por infraestrutura, sem acesso neste ambiente). Tudo que podia
  ser preparado e validado *dentro do
  repositório* foi — inclusive construindo e rodando a imagem Docker de
  verdade contra Postgres real (não só inspeção de código). Ver
  `docs/DEPLOYMENT.md` para o detalhamento completo, seção por seção, do que
  é IMPLEMENTADO/TESTADO vs. BLOQUEADO POR INFRAESTRUTURA.
- **Funcionalidades entregues**: `apps/api/Dockerfile` multi-stage (testado —
  5 bugs reais de build/runtime encontrados e corrigidos só ao efetivamente
  rodar a imagem, nenhum visível por inspeção; ver "Decisões revisadas na
  v0.9" e Parte 6); `GET /v1/health` (liveness) e `GET /v1/health/ready`
  (readiness, checagem real de Postgres) — antes só existia um health check
  único sem distinção; graceful shutdown real (`app.enableShutdownHooks()`
  não existia antes — sem ele, `SIGTERM` nunca acionava
  `PrismaService.onModuleDestroy()`); validação de variáveis de ambiente
  obrigatórias no boot; headers de segurança no frontend
  (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Strict-Transport-Security` — testados contra `next start` local real);
  `docs/DEPLOYMENT.md` novo, cobrindo arquitetura de produção, escolha de
  plataforma (Railway, com justificativa), estratégia de migration, Clerk
  produção, observabilidade, backup/rollback e troubleshooting.
- **Decisão explícita sobre Redis**: não usado por nenhum código hoje
  (`Booking`/idempotência continuam 100% PostgreSQL desde a Fase 4) — não
  provisionado pra este deploy, mesmo estando no `docker-compose.yml` desde
  a Fase 1. Ver "Decisões revisadas na v0.9".
- **Dependências:** Fase 8 com CI 100% verde (regressão local, depois confirmada também contra o
  runner real do GitHub Actions — ver abaixo).
- **Critério de conclusão real vs. o que foi possível validar**: o critério
  original ("uma arena real cadastrada e usada em produção; erros no
  Sentry; eventos no PostHog") **não foi atingido** — não há deploy real,
  não há Sentry nem PostHog instalados (avaliados e deliberadamente não
  adicionados sem necessidade imediata comprovada, item 49 do prompt da
  fase). O que foi validado de verdade: build + boot + `health`/`health/
  ready` reais do container contra Postgres real; migrations em banco limpo
  (duas vezes); `next start` local com os novos headers presentes na
  resposta HTTP real; regressão completa (128 unitários + 133 e2e no
  backend, 59 no frontend) sem quebrar nada das Fases 1-8.
- **Bloqueado, documentado explicitamente** (não inventado como feito), por dois motivos
  distintos: **custo** — Railway exige Hobby plan (US$5/mês), decisão consciente de pausar antes
  de gastar; e **infraestrutura** — Vercel, ambiente de produção do Clerk, domínio próprio,
  staging, backup/restore reais, Sentry/PostHog seguem sem conta/acesso criado. **Já destravado
  nesta fase**: o repositório foi publicado no GitHub e o CI passou a rodar de verdade num runner
  real — a primeira execução falhou (bug real no placeholder do `CLERK_WEBHOOK_SIGNING_SECRET` do
  workflow, corrigido e revalidado), a segunda ficou verde. Ver "Decisões revisadas na v0.9",
  itens 7 e 10.

### Fase 10 — Gestão de Membros, Equipe e RBAC Operacional ✅ concluída
- **Objetivo:** dar ao OWNER uma forma real de gerenciar quem administra a arena — listar, adicionar,
  alterar papel e remover membros — consolidando o RBAC (`ArenaMember`/`ArenaRole`) antes de
  expandi-lo. **Renumeração de roadmap**: esta fase não existia no roadmap original (que tinha
  "Fase 10 — IA"); IA/WhatsApp/Pagamentos foram deslocadas para as Fases 11-13 abaixo.
- **Funcionalidades:** `GET/POST/PATCH/DELETE /v1/arenas/:arenaId/members`, reaproveitando
  `ArenaAccessGuard`/`RequireArenaRole` sem modificação — a gestão de equipe vive dentro do próprio
  `ArenaMembersModule` (não um módulo novo, item 60 do prompt da fase). Adicionar membro identifica o
  usuário por e-mail (não por `userId`, que o OWNER nunca teria como conhecer) — um lookup exato
  dentro do próprio `POST`, nunca um endpoint de busca aberto (evita enumeração de contas). Só
  `ADMIN` é um destino válido em criação/alteração de papel — `OWNER` nunca é aceito pelos DTOs
  comuns (`@IsIn(['ADMIN'])`).
- **Regra de único OWNER, agora garantida pelo banco**: um índice único **parcial**
  (`ON "ArenaMember"("arenaId") WHERE role = 'OWNER'`) impede fisicamente uma segunda linha com
  `role=OWNER` na mesma arena — antes só a ordem de chamadas da aplicação evitava isso. Prisma não
  tem sintaxe para índice parcial no schema, então existe só na migration SQL manual (mesma técnica
  já usada pela `EXCLUDE` constraint de `Booking`). **Achado real ao aplicar a migration**: o banco
  de desenvolvimento já tinha dois `OWNER` na mesma arena (efeito colateral de uma concessão manual
  de acesso feita antes desta fase) — a migration falhou de propósito (`P3018`), exatamente o
  comportamento correto de uma constraint real; corrigido nos dados antes de reaplicar.
- **Regra de remoção (OWNER vs. ADMIN), interpretação registrada**: o prompt desta fase pedia
  simultaneamente "`DELETE`: somente OWNER" e "ADMIN pode remover a si próprio" — logicamente
  incompatíveis se `DELETE` fosse OWNER-only no guard. Resolvido como: `@RequireArenaRole()` (vazio,
  "qualquer membro") no guard, com a distinção fina decidida no service — OWNER remove qualquer
  ADMIN, um ADMIN só remove a si mesmo, e o `OWNER` nunca é removível (nem por ele mesmo), o que
  cobre a auto-remoção do proprietário de graça.
- **Autorização**: `GET` — qualquer membro (`@RequireArenaRole()`, equivalente a "OWNER e ADMIN"
  hoje, mesma convenção do resto do código); `POST`/`PATCH` — só `OWNER`; `DELETE` — ver acima.
- **Explicitamente fora de escopo desta fase** (conforme o prompt): `STAFF`/permissões granulares,
  convite por e-mail (`Invitation`/token/magic link), transferência de ownership
  (`POST /transfer-owner` ou equivalente), Payment, WhatsApp, IA, reservas recorrentes.
- **Dependências:** Fase 3 (`ArenaMember`/`ArenaRole` já existiam desde então).
- **Critério de conclusão:** 26 novos testes e2e (`member-management.e2e-spec.ts`) cobrindo IDOR,
  mass assignment, escalação de privilégio, proteção do OWNER e isolamento entre arenas — todos
  passando contra Postgres real, migration validada em banco limpo duas vezes. Ver relatório da
  fase para a lista completa.

### Fase 11 — Convites de Equipe e Transferência Segura de Ownership ✅ concluída
- **Objetivo:** permitir que o OWNER convide alguém por e-mail (mesmo sem conta ainda) para virar
  ADMIN da arena, e transferir a propriedade da arena para um ADMIN existente de forma explícita e
  atômica — sem depender do `POST /members` direto (Fase 10, que exige que a pessoa já tenha conta
  e que o OWNER conheça o e-mail exato de alguém já cadastrado). **Renumeração de roadmap**: esta
  fase não existia no roadmap original (que tinha "Fase 11 — IA"); IA/WhatsApp/Pagamentos foram
  deslocadas para as Fases 12-14 abaixo.
- **Funcionalidades — convites:** `ArenaInvitation` (módulo novo, `InvitationsModule`) com ciclo de
  vida `PENDING → ACCEPTED | REVOKED | EXPIRED`, sempre **derivado** de `acceptedAt`/`revokedAt`/
  `expiresAt` em tempo de leitura, nunca uma coluna de enum própria. `POST/GET
  /v1/arenas/:arenaId/invitations`, `DELETE .../:invitationId` (revogar), `POST
  .../:invitationId/resend` — todos `OWNER`-only, guardados por `ClerkAuthGuard` +
  `ArenaAccessGuard` + `RequireArenaRole(OWNER)`, sem duplicar lógica de autorização já existente.
  Rota pública `GET /v1/invitations/:token` (sem guard — precisa ser vista antes do login) e `POST
  /v1/invitations/:token/accept` (só `ClerkAuthGuard`, sem `ArenaAccessGuard` — quem aceita ainda
  não é membro da arena).
- **Segurança do token**: `crypto.randomBytes(32)` em base64url (256 bits) é o token enviado por
  e-mail; só `sha256(token)` é persistido em `ArenaInvitation.tokenHash` (`@unique`). Nenhuma
  resposta de API jamais devolve o token puro — a única forma de obtê-lo é o e-mail em si (ou, em
  desenvolvimento, o log do `ConsoleInvitationEmailService`). Expiração default de 7 dias, ajustável
  via `INVITATION_EXPIRES_DAYS` (opcional). `GET /v1/invitations/:token` é deliberadamente
  anti-enumeração: token não encontrado devolve sempre o mesmo 404 genérico, nunca distinguindo
  "nunca existiu" de "já foi revogado"; uma vez que o hash bate com um convite real, porém, o status
  completo (inclusive REVOKED/EXPIRED/ACCEPTED) é devolvido, porque posse do token de 256 bits já é
  prova suficiente de legitimidade.
- **Identidade de quem aceita**: lida sempre do `User.email` local, já sincronizado do Clerk via
  webhook (Fase 2) — nunca de um campo enviado pelo cliente no `POST .../accept`. Um convite para
  `joao@x.com` só pode ser aceito por quem estiver autenticado com uma conta Clerk cujo e-mail
  sincronizado seja exatamente esse.
- **Convite duplicado impedido pelo banco**: índice único parcial
  (`ArenaInvitation_open_invite_key`, `ON ("arenaId", "email", "role") WHERE (acceptedAt IS NULL AND
  revokedAt IS NULL)`) — mesma técnica de índice parcial manual da Fase 10 (Prisma não expressa isso
  no schema). Permite reconvidar depois que um convite anterior expira/é revogado/é aceito, mas
  impede dois convites abertos simultâneos para o mesmo e-mail+papel na mesma arena.
- **Aceite é atômico via `updateMany` condicional**: `tx.arenaInvitation.updateMany({ where: { id,
  acceptedAt: null, revokedAt: null }, ... })` seguido de checagem de `count === 1` antes de criar o
  `ArenaMember`, dentro da mesma transação — a segunda tentativa concorrente de aceitar o mesmo
  convite naturalmente vê `count: 0` e falha com 409, sem lock pessimista. **Validado com
  concorrência real**: teste e2e dispara duas requisições `POST .../accept` simultâneas
  (`Promise.all`) contra o mesmo convite e confirma `[204, 409]` e exatamente um `ArenaMember`
  criado.
- **Funcionalidades — transferência de ownership**: adicionada ao `ArenaMembersModule` já
  existente (não um módulo novo — a operação atua diretamente sobre linhas de `ArenaMember`), como
  endpoint explícito `POST /v1/arenas/:arenaId/ownership/transfer` (`OWNER`-only) — nunca implícita
  via `PATCH /members/:userId`. Troca atômica: o ADMIN alvo vira `OWNER`, o `OWNER` anterior vira
  `ADMIN` (nunca removido/rebaixado a ex-membro). Implementada com dois `updateMany` sequenciais,
  cada um condicionado ao papel atual esperado — uma segunda tentativa de transferência concorrente
  falha com `count: 0` assim que a primeira commitou a troca de papel, sem violar o índice único
  parcial de único-OWNER da Fase 10 (que continua sendo a autoridade final). Validado com o mesmo
  padrão de teste de concorrência real (`Promise.all` de duas transferências simultâneas, resultado
  `[201, 403]`, exatamente um `OWNER` no estado final).
- **Envio de e-mail é uma abstração** (`InvitationEmailService`, classe abstrata — não interface,
  porque interfaces TS não existem em runtime e o DI do Nest precisa de um token real de injeção)
  com um único adapter concreto, `ConsoleInvitationEmailService`: loga o link via `Logger` do Nest
  só fora de produção; em produção, loga apenas um aviso genérico (nome da arena, nunca
  link/token) e retorna sem lançar — a ação de domínio (criar/reenviar o convite) sempre acontece
  primeiro, a notificação é um efeito posterior que nunca pode derrubá-la.
- **Explicitamente fora de escopo desta fase** (conforme o prompt): `STAFF`/permissões granulares,
  Payment, WhatsApp, IA, reservas recorrentes, analytics, notificações gerais, provedor de e-mail
  real com credenciais (SendGrid/Postmark/SES — só a abstração + adapter de console).
- **Limitação registrada, não implementada**: rate limiting em criação/reenvio de convite. Um
  contador em memória seria descartado a cada redeploy/restart do processo (falso senso de
  proteção); uma solução real precisaria de estado persistente (Postgres/Redis) fora do escopo desta
  fase — registrado aqui em vez de fingido com uma implementação frágil.
- **Dependências:** Fase 10 (`ArenaMember`/`ArenaRole`, guards de autorização), Fase 2 (sincronização
  Clerk → `User.email`).
- **Critério de conclusão:** 41 novos testes e2e (`invitation-flow.e2e-spec.ts`, 22 testes;
  `ownership-transfer.e2e-spec.ts`, 16 testes; mais os unitários do novo `InvitationsService` e da
  extensão de `ArenaMembersService`) cobrindo criação, listagem, revogação, reenvio, aceite,
  expiração, anti-enumeração, mismatch de identidade, e concorrência real de aceite e de
  transferência — todos contra Postgres real. Migration validada em banco limpo (duas vezes, mesma
  disciplina da Fase 10). Ver relatório da fase para a lista completa.

### Fase 12 — Assistente de IA Operacional ✅ concluída
- **Objetivo:** dar ao OWNER/ADMIN um assistente que responde perguntas sobre a operação real da
  arena (reservas, ocupação, horários de pico, receita estimada) com base só em dados do próprio
  banco — nunca um agente que age. **Escopo redefinido em relação ao roadmap anterior**: a versão
  antiga desta seção ("Fase 12 — IA") previa um agente com tools de `create_booking`/
  `cancel_booking` (a "Visão futura IA/WhatsApp" da Parte 3). O prompt desta fase substituiu esse
  objetivo por um assistente deliberadamente **só leitura/análise** — a capacidade de agente que
  executa ação (criar/cancelar reserva via tools, atendimento por WhatsApp) continua descrita na
  Parte 3 como direção futura, mas **sem fase numerada até ser explicitamente retomada**; não foi
  silenciosamente descartada, só adiada e desacoplada desta entrega.
- **Funcionalidades:** módulo novo `ai` (`AiModule`) com `POST
  /v1/arenas/:arenaId/ai/ask` (`OWNER`/`ADMIN`-only, explícito via
  `@RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)`), reaproveitando `ClerkAuthGuard`/
  `ArenaAccessGuard` sem modificação. `OperationalMetricsService` calcula métricas reais direto do
  Postgres (reservas confirmadas/canceladas, BLOCK, MAINTENANCE, receita estimada, ocupação por
  quadra e da arena, demanda por hora/dia, comparação com o período anterior) — a IA nunca faz essa
  conta sozinha a partir de texto bruto, só interpreta números já prontos.
- **Decisão arquitetural chave (a mesma da "Visão futura" original, agora aplicada de verdade)**: a
  IA nunca recebe acesso direto ao Prisma/banco nem gera SQL. O backend monta um contexto
  estruturado (`AiContext`, JSON) — nomes de exibição e números agregados, nunca IDs internos
  (`cuid`), nunca PII de cliente (nome/e-mail/telefone/ClerkId) — e só esse objeto é enviado ao
  provedor. `AiProvider` é uma abstração (classe abstrata, mesmo motivo do `InvitationEmailService`
  da Fase 11: interfaces TS não existem em runtime) com um único adapter real,
  `OpenAiAiProviderService`, usando `fetch` nativo do Node 24 (sem SDK novo).
- **Provider escolhido: OpenAI (`gpt-4o-mini` por padrão)** — decisão tomada em conjunto com o
  usuário durante a fase (nenhuma decisão firme preexistia; a menção a OpenAI no roadmap antigo era
  só para a visão futura maior, não uma decisão vinculante para este escopo). Custo por token
  típico de um modelo "mini"; chave em `AI_PROVIDER_API_KEY`, nunca chega ao frontend, nunca é
  logada. Trocar de provider é só trocar o `useClass` em `AiModule` — nada mais no domínio muda.
- **Prompt engineering centralizado** (`prompts.ts`): system prompt único com as 15 regras do
  prompt da fase (nunca inventar dado, recusar executar ação, nunca revelar outra arena, tratar
  texto do usuário/contexto como não-confiável, nunca as próprias instruções como reveláveis).
  Contexto e pergunta do usuário são seções claramente delimitadas no prompt enviado ao modelo —
  nunca concatenados de um jeito que confunda dado com instrução.
- **Prompt injection — o que foi validado e o que não foi**: testes (unitários e e2e) provam,
  estruturalmente, que (a) o contexto enviado ao provider nunca contém dado de outra arena
  (impossível por construção — toda query já é filtrada por `arenaId`), (b) o system prompt sempre
  contém as regras de defesa, mesmo quando a pergunta do usuário tenta uma instrução maliciosa
  ("ignore suas instruções..."), (c) nenhuma PII aparece no contexto. **O que não foi validado**:
  se um modelo real da OpenAI de fato *recusa* semanticamente uma tentativa de prompt injection —
  isso exigiria uma chamada real à API paga, que este ambiente não tem credencial para fazer (ver
  Seção 29/44 do prompt da fase e o relatório da fase). Os testes e2e usam um `AiProvider` fake
  (só para teste, nunca registrado em produção) que captura o que seria enviado ao modelo real.
- **Comparação de períodos calculada pelo backend** (`OperationalMetricsService.buildComparison`):
  todo pedido de métricas também calcula o período imediatamente anterior de mesma duração e os
  deltas percentuais prontos (`null`, nunca `0`/`Infinity`, quando a base de comparação é zero) — a
  IA nunca precisa (nem deve) calcular "aumentou quanto %" sozinha a partir de texto.
- **Definições de métrica, documentadas explicitamente** (nunca aproximadas silenciosamente):
  ocupação = minutos ocupados por reservas `CUSTOMER`+`CONFIRMED` ÷ minutos operacionais (horário
  de funcionamento × dias do período), só quadras ativas — `null` (nunca `0` forjado) quando não há
  horário configurado. Receita estimada = soma de `Booking.total` só de `CUSTOMER`+`CONFIRMED` —
  `BLOCK`/`MAINTENANCE`/`CANCELLED` nunca entram. "Horário de menor demanda" inclui horas dentro do
  expediente com zero reservas (é justamente o dado útil pra identificar oportunidade de promoção).
- **Sem rate limiting persistente nesta fase** — mesma decisão e mesmo motivo da Fase 11 (convites):
  um contador em memória seria descartado a cada redeploy, um falso senso de proteção. Mitigado
  parcialmente por limite de tamanho da pergunta (500 caracteres) e por limite do período explícito
  (máximo 92 dias) — controle de custo no nível da aplicação, não uma solução completa. Registrado
  como limitação real, não uma lacuna silenciada.
- **Sem histórico de conversa persistido** — cada pergunta é *stateless*: pergunta → contexto atual
  → resposta. Nenhuma tabela `ChatMessage` foi criada (nenhuma migration nova nesta fase — todas as
  métricas vêm de `Booking`/`Court`/`ArenaOperatingHours`/`Arena`, já existentes).
- **Explicitamente fora de escopo desta fase** (conforme o prompt): qualquer escrita (criar/
  cancelar reserva, alterar horário/preço/permissão), WhatsApp, agente autônomo, RAG/embeddings/
  vector database, voz/imagem, fine-tuning, STAFF, Payment.
- **Dependências:** Fase 4 (`Booking`), Fase 5 (`ArenaOperatingHours`, disciplina de timezone), Fase
  7 (mesmo padrão de agregação do `DashboardService`), Fase 10 (`ArenaAccessGuard`/
  `RequireArenaRole`).
- **Critério de conclusão:** 45 novos testes unitários (`OperationalMetricsService`,
  `buildAiContext`, `AiService`, `OpenAiAiProviderService`) e 20 novos testes e2e
  (`ai.e2e-spec.ts`) contra Postgres real — autorização (OWNER/ADMIN/CUSTOMER/cross-tenant/arena
  inexistente), validação de input (pergunta vazia, acima do limite, mass assignment), isolamento
  multi-tenant do contexto, separação correta de CUSTOMER/BLOCK/MAINTENANCE/CANCELLED, timezone e
  DST (America/New_York, transição real de 2026), tratamento de erro/timeout do provider (503,
  nunca 500 genérico) e concorrência (duas perguntas simultâneas, nenhuma cria/altera `Booking`).
  Ver relatório da fase para a lista completa e para o que NÃO foi validado (chamada real à OpenAI).

### Fase 13 — Customer Booking Lifecycle ✅ concluída
- **Objetivo:** garantir e consolidar o ciclo de vida completo da reserva do CUSTOMER
  (disponibilidade → criação → "minhas reservas" → detalhe → cancelamento quando permitido).
  **Achado da auditoria obrigatória desta fase**: quase todo o escopo pedido já existia desde a Fase
  4 (criação/cancelamento) e a Fase 6 (`GET /v1/users/me/bookings`, `GET
  /v1/users/me/bookings/:bookingId`, frontend completo em `/minhas-reservas`) — corretamente
  implementado, incluindo o modelo de acesso pedido (CUSTOMER nunca precisa ser `ArenaMember`,
  identidade sempre derivada do Clerk/`User` autenticado, nunca de um `userId` no corpo; 404, nunca
  403, pra não vazar a existência da reserva de outra pessoa). Esta fase não reescreveu nada disso —
  auditou, encontrou uma lacuna real de concorrência, corrigiu, e adicionou os testes explícitos que
  o prompt da fase pedia e ainda não existiam.
- **Único ajuste de código**: `BookingsService.cancel` fazia `findFirst` (checagem de dono/papel +
  estado) seguido de um `update` incondicional — sequencialmente idempotente (cancelar duas vezes
  em chamadas separadas já devolvia o mesmo resultado, sem erro), mas com uma janela de corrida real
  sob concorrência genuína: duas requisições de cancelamento simultâneas podiam passar pela leitura
  ANTES de qualquer uma escrever, e as duas então executavam o `update`, a segunda sobrescrevendo
  silenciosamente `cancelledAt`/`cancelledByUserId` da primeira. Corrigido trocando o `update`
  incondicional por um `updateMany` condicionado a `status: CONFIRMED` no `WHERE` (mesmo padrão CAS —
  compare-and-swap — já usado no aceite de convite e na transferência de ownership da Fase 11),
  seguido de uma releitura: a perdedora da corrida nunca produz uma segunda transição de estado, só
  observa o resultado que a vencedora já gravou. Validado com um teste de concorrência real
  (`Promise.all` de dois `POST .../cancel` simultâneos contra a mesma reserva) — as duas respostas
  agora sempre convergem para o mesmo `cancelledByUserId`.
- **Idempotência do cancelamento: decisão registrada.** Diferente da criação (`POST .../bookings`),
  que usa o mecanismo formal de `Idempotency-Key` (Fase 4) porque sem proteção um retry geraria DOIS
  registros distintos, cancelar já converge pro mesmo estado terminal (`CANCELLED`) por natureza da
  máquina de estados — chamar duas, três, N vezes sempre produz o mesmo resultado. Por isso o
  cancelamento **não exige** o header `Idempotency-Key` — decisão explícita, não uma omissão: exigir
  o header aqui adicionaria uma restrição nova sem proteger contra nada que o CAS acima (mais a
  natureza absorvente do estado `CANCELLED`) já não resolvesse.
- **Nenhuma política de janela/prazo de cancelamento existe** — a Fase 6 já havia registrado
  explicitamente essa ausência ("nenhuma política de janela de cancelamento foi inventada — o
  domínio não tem uma ainda"), e o prompt desta fase pedia pra preservar essa decisão em vez de
  inventar uma silenciosamente caso ainda não existisse. Reafirmado aqui: continua não havendo
  prazo mínimo de antecedência — qualquer reserva `CONFIRMED` pode ser cancelada a qualquer momento
  pelo dono ou por OWNER/ADMIN da arena. Se um dia for necessário, é a extensão mínima de adicionar
  uma checagem de janela dentro de `BookingsService.cancel`, sem mudar contrato de API.
- **Integração real com as métricas da Fase 12**: novo teste e2e prova, através dos endpoints reais
  (não seed direto no banco), que cancelar uma reserva `CUSTOMER` a remove da receita estimada e da
  contagem de confirmadas vistas pelo assistente de IA no mesmo instante — a fórmula em si já
  ignorava `CANCELLED` desde a Fase 12 (testado em isolamento), mas nunca havia um teste provando a
  composição ponta a ponta entre o ciclo de vida real da reserva e as métricas.
- **Segurança, tudo já coberto por auditoria + testes novos onde faltava explicitamente**: IDOR
  (404 em vez de 403 pra não vazar existência — já existia, Fase 6), mass assignment no corpo do
  cancelamento (o endpoint nem declara `@Body()`, então nenhum campo do corpo é lido — comprovado
  com um teste novo enviando `userId`/`arenaId`/`courtId`/`status`/`type`/`total` forjados),
  BLOCK/MAINTENANCE nunca canceláveis por um CUSTOMER sem vínculo (já garantido pela checagem de
  dono-ou-papel existente — testes novos tornam isso explícito), isolamento multi-tenant com duas
  arenas e três clientes (A1/A2 na mesma arena, B1 em outra) cobrindo listagem, detalhe e
  cancelamento cruzados, e um teste de timezone/DST (`America/New_York`, transição real de 2026)
  provando que "minhas reservas" nunca confunde o timezone de uma arena com o de outra na mesma
  consulta de um único cliente.
- **Explicitamente fora de escopo** (conforme o prompt): pagamentos, notificações, WhatsApp, novas
  funcionalidades de IA — o assistente operacional continua estritamente somente leitura, sem
  nenhuma tool de escrita (criar/cancelar reserva pela IA nunca foi implementado, nem cogitado).
- **Dependências:** Fase 4 (`Booking`, `EXCLUDE` constraint, `Idempotency-Key`), Fase 5 (timezone),
  Fase 6 ("minhas reservas", frontend), Fase 11 (padrão CAS reaproveitado), Fase 12 (métricas).
- **Critério de conclusão:** 2 novos testes unitários (`bookings.service.spec.ts`) e 13 novos testes
  e2e contra Postgres real (`bookings.e2e-spec.ts` +5, `bookings-concurrency.e2e-spec.ts` +1,
  `customer-experience.e2e-spec.ts` +6, `ai.e2e-spec.ts` +1) cobrindo exatamente as lacunas listadas
  acima — nenhum teste pré-existente foi removido ou reescrito. Frontend sem nenhuma alteração de
  código (auditoria confirmou que `/minhas-reservas` e `/minhas-reservas/:bookingId` já cumpriam
  100% dos requisitos desta fase desde a Fase 6, inclusive o dialog de confirmação de cancelamento e
  a invalidação de `my-bookings`/`availability` via TanStack Query). Ver relatório da fase para a
  lista completa.

### Fase 14 — Customer & Arena Client Management ✅ concluída
- **Objetivo:** dar ao OWNER/ADMIN uma visão operacional dos clientes que possuem ou possuíram
  reservas `CUSTOMER` na arena — listar, buscar, consultar resumo e histórico. **Explicitamente não
  um CRM**: sem lifetime value avançado, churn, cohort analysis, customer score, ranking, segmentação
  automática ou qualquer forma de ML — só métricas simples e diretamente deriváveis de `Booking` já
  existente.
- **Definição de "cliente da arena"**: usuário que possui ou possuiu pelo menos uma `Booking`
  `type=CUSTOMER` numa quadra desta arena. Não é uma entidade nova — é uma visão derivada de
  `User`+`Booking`, calculada em tempo de leitura (mesma técnica de "estado derivado" já usada para
  `ArenaInvitation` na Fase 11 e para as métricas da IA na Fase 12). Um `User` que é OWNER/ADMIN da
  arena mas nunca fez uma reserva `CUSTOMER` nela nunca aparece como cliente; um `BLOCK`/
  `MAINTENANCE` (mesmo com `userId` preenchido, o admin que criou) também nunca conta.
- **Funcionalidades:** módulo novo `CustomersModule` — `GET /v1/arenas/:arenaId/customers` (lista,
  com busca por nome/e-mail e paginação `page`/`limit`, teto de 50), `GET
  /v1/arenas/:arenaId/customers/:userId` (resumo: total/confirmadas/canceladas/receita
  estimada/primeira/última reserva) e `GET /v1/arenas/:arenaId/customers/:userId/bookings`
  (histórico completo das reservas `CUSTOMER` daquele cliente, só nesta arena). Todos
  `OWNER`/`ADMIN`-only, explícito via `@RequireArenaRole(ArenaRole.OWNER, ArenaRole.ADMIN)` (mesma
  convenção do `AiController` da Fase 12), reaproveitando `ClerkAuthGuard`/`ArenaAccessGuard` sem
  nenhuma modificação — nenhum sistema de autorização novo.
- **Isolamento por arena, absoluto**: toda agregação é filtrada por `court: { arenaId }` — um
  mesmo usuário com reservas em arenas diferentes tem métricas calculadas de forma totalmente
  independente em cada uma, nunca somadas. Consultar um cliente que não tem nenhuma `Booking`
  `CUSTOMER` nesta arena (mesmo que exista globalmente, ou seja OWNER de outra arena) devolve `404`
  — o mesmo padrão de "nunca vazar existência" já usado desde a Fase 3/4/6.
- **Receita segue exatamente a regra da Fase 12**: soma de `Booking.total` só de `CUSTOMER`+
  `CONFIRMED`. `CANCELLED` entra no total de reservas, mas nunca na receita. `BLOCK`/`MAINTENANCE`
  nunca entram em nenhum dos dois.
- **Sem N+1**: a listagem usa `groupBy` (agregação feita pelo próprio Postgres) em no máximo duas
  chamadas, sempre delimitadas pela PÁGINA atual — nunca uma query por cliente, nunca todo o
  histórico de reservas da arena carregado em memória.
- **PII minimizada**: só `name`/`email` do `User` são retornados — nunca `clerkId`, nunca telefone
  (existe no schema desde a Fase 2, mas não foi exposto por não haver necessidade operacional
  comprovada nesta fase).
- **Primeira paginação da API** (`page`/`limit`, default 20, máximo 50) — decisão nova, documentada
  aqui por não haver um padrão anterior no projeto para reutilizar.
- **Nenhuma migration nova** — os índices existentes em `Booking` (`courtId`, `userId`) já atendem
  as consultas desta fase (agregação por `court.arenaId` + `userId`, sempre com `type=CUSTOMER` no
  filtro); nenhum índice novo foi criado.
- **Frontend**: `/dashboard/[arenaId]/clientes` (lista com busca com debounce e paginação simples,
  "Anterior"/"Próxima") e `/dashboard/[arenaId]/clientes/:userId` (resumo + histórico), seguindo
  exatamente o padrão visual/estrutural já usado em `/dashboard/[arenaId]/quadras` e `[courtId]`.
  Nenhum design system novo.
- **IA da Fase 12 permanece inalterada** — nenhuma pergunta específica de cliente foi adicionada ao
  assistente (ex: "quanto o João gastou?"); registrado como decisão explícita, não uma omissão —
  misturar PII de cliente individual com o contexto da IA exige uma decisão própria sobre exposição
  de dados pessoais a um LLM, fora do escopo desta fase.
- **Explicitamente fora de escopo** (conforme o prompt): marketing, campanhas, cupons, WhatsApp,
  notificações, pagamentos, CRM avançado.
- **Dependências:** Fase 4 (`Booking`), Fase 2 (`User`), Fase 10 (`ArenaAccessGuard`/
  `RequireArenaRole`), Fase 12 (regra de receita estimada reaproveitada).
- **Critério de conclusão:** 11 novos testes unitários (`CustomersService`) e 28 novos testes e2e
  (`customers.e2e-spec.ts`) contra Postgres real — autorização (OWNER/ADMIN/CUSTOMER/sem vínculo/
  cross-tenant), isolamento multi-arena com um cliente real em duas arenas, exclusão de BLOCK/
  MAINTENANCE, receita/total corretos com reservas canceladas, busca, paginação, timezone/DST,
  IDOR e ausência de PII indevida. Ver relatório da fase para a lista completa.

### Fase 15 — Operational Reports & Analytics ✅ concluída
- **Objetivo:** dar ao OWNER/ADMIN uma área de Relatórios/Analytics no dashboard — responder
  perguntas operacionais (receita, ocupação, reservas confirmadas/canceladas, desempenho por
  quadra, demanda por horário, dias mais movimentados, comparação com o período anterior) sem
  depender de perguntar em linguagem natural à IA (Fase 12), que continua existindo em paralelo,
  não substituída.
- **Fonte única de verdade, literal**: `ReportsModule` importa `AiModule` e reaproveita a MESMA
  instância de `OperationalMetricsService` (exportada de lá especificamente para isso) — não uma
  segunda implementação da fórmula de receita/ocupação/demanda/comparação. `ReportsService` nunca
  recalcula nada: resolve o período, chama `getMetrics()` (atual e anterior) e `buildComparison()`,
  e só reformata o resultado pro formato de resposta da API.
- **Uma capacidade nova em `OperationalMetricsService`, não duplicada em outro lugar**: série
  diária (`dailySeries`) — os mesmos números do `summary` (receita, confirmadas, canceladas,
  ocupação), quebrados por dia civil da arena. `operationalMinutes()` da Fase 12 foi refatorado pra
  reaproveitar um novo `operationalMinutesByDay()` (a soma de por-dia), nunca um segundo cálculo de
  minutos operacionais coexistindo com o original.
- **Dois presets de período novos**: `thisMonth`/`lastMonth`, adicionados ao mesmo `PeriodPreset`/
  `resolvePeriod` central da Fase 12 — os presets já existentes mantêm o mesmo comportamento; a IA
  nem precisa saber que os novos existem (valida contra sua própria lista fixa).
- **Novo campo de comparação**: `cancelledBookingsDeltaPct`, mesma função `percentDelta` dos outros
  três deltas — `null` (nunca `0` ou `Infinity`) quando o período anterior teve zero cancelamentos.
- **Disciplina null vs. zero estendida à série diária**: um dia sem nenhum horário de funcionamento
  configurado tem `occupancyRate: null` só naquele ponto da série — nunca `0%` forjado, mesmo que
  outros dias do mesmo período tenham capacidade real (validado com uma arena aberta só às
  quintas-feiras: 1 dia com ocupação numérica, 6 dias `null` no mesmo período de 7 dias).
- **Um endpoint novo, só leitura**: `GET /v1/arenas/:arenaId/reports` — `preset` OU `from`/`to` via
  query string (nunca os dois juntos), `OWNER`/`ADMIN`-only via `@RequireArenaRole`, reaproveitando
  `ClerkAuthGuard`/`ArenaAccessGuard` sem nenhuma modificação. Resposta inclui período atual e
  anterior, resumo, comparação, série diária, desempenho por quadra (com quadra mais/menos
  ocupada), demanda por horário (com pico e menor demanda) e os 5 dias mais movimentados.
- **Nenhuma migration nova** — a fase não introduz nenhuma query nova: `ReportsService` chama
  literalmente a mesma `OperationalMetricsService.getMetrics()` já auditada nas Fases 12-14 (o
  índice único em `Court(arenaId, name)` cobre o filtro por arena; `Booking(courtId, startsAt)`
  cobre o restante).
- **Frontend**: `/dashboard/[arenaId]/relatorios` — seletor de período (mesmos 8 presets + período
  personalizado, convenção idêntica à página de IA), cards de resumo com delta em relação ao
  período anterior (`null` exibido como "Sem base para comparação", ocupação `null` como "Não
  disponível" — nunca inventando 0%), evolução diária (receita/confirmadas/canceladas/ocupação),
  desempenho por quadra, demanda por horário com pico/menor demanda, dias mais movimentados. Sem lib
  de gráficos nova: visualizações em SVG/CSS simples e decorativas (`aria-hidden`), sempre
  acompanhadas de uma tabela textual equivalente com os mesmos dados — decisão justificada pelo
  baixo volume (no máximo 92 pontos por série, o mesmo teto de 92 dias já existente desde a
  Fase 12) e por evitar uma dependência nova só para poucas barras.
- **Explicitamente fora de escopo** (conforme o prompt): exportação (PDF/CSV/Excel), agendamento de
  envio recorrente, dashboards customizáveis pelo usuário, BI avançado, forecasting/previsão,
  comparação entre arenas diferentes, alertas/notificações automáticas.
- **Dependências:** Fase 12 (`OperationalMetricsService`, reaproveitada por inteiro), Fase 10
  (`ArenaAccessGuard`/`RequireArenaRole`).
- **Critério de conclusão:** 8 novos testes unitários em `operational-metrics.service.spec.ts`
  (presets novos, `dailySeries`, `cancelledBookingsDeltaPct`) + 10 novos testes unitários em
  `reports.service.spec.ts` (reshape correto de cada seção, incluindo uma prova explícita de que a
  comparação usa exatamente os deltas de `OperationalMetricsService.buildComparison`) + 28 novos
  testes e2e (`reports.e2e-spec.ts`) contra Postgres real — autorização (OWNER/ADMIN/sem vínculo/
  cross-tenant/arena inexistente), validação de período (teto de 92 dias, preset+from/to juntos,
  preset inválido, whitelist de query), receita/reservas/ocupação corretas com exclusão de
  CANCELLED/BLOCK/MAINTENANCE, série diária com null vs. zero, comparação com período anterior
  (incluindo base zero → `null`), desempenho por quadra, demanda por horário (incluindo hora de
  menor demanda como um `0` válido), dias mais movimentados, isolamento multi-tenant com duas
  arenas, timezone/DST (`America/New_York`, transição real de 2026), integração real
  criar-reserva→relatório-reflete→cancelar→relatório-reflete (prova que o GET nunca muta
  `Booking`), e duas requisições GET concorrentes devolvendo exatamente o mesmo resultado
  (read-only). Frontend: 11 novos testes (`relatorios/page.test.tsx`) cobrindo carregamento, erro,
  período personalizado incompleto, resumo com comparação e ocupação `null`, nota de "nenhuma
  reserva", desempenho por quadra, dias mais movimentados e troca de período. Nenhum teste
  pré-existente foi removido ou reescrito. Ver relatório da fase para a lista completa.

### Fase 16 — WhatsApp + Assistente de Reservas Controlado ✅ concluída
- **Objetivo:** WhatsApp como novo canal de atendimento pro cliente — consultar disponibilidade,
  quadras, preços e reservas próprias, criar e cancelar reserva, tudo em linguagem natural. A "Visão
  futura (IA/WhatsApp)" da Parte 3, que previa exatamente essa capacidade de tools de escrita, foi
  implementada nesta fase — a metade que falta agora é só a integração real com credenciais de
  produção da Meta/OpenAI (ver `docs/DEPLOYMENT.md`, "Canal de WhatsApp").
- **Princípio arquitetural**: WhatsApp é só mais um canal de ENTRADA pro domínio já existente —
  nunca uma segunda implementação. `WhatsAppModule` reaproveita literalmente `BookingsService`
  (criação e cancelamento, com o mesmo lock por quadra/EXCLUDE constraint/CAS da Fase 4/13),
  `AvailabilityService` (mesma grade de horários da Fase 5/6), `ArenasService.discoverOne` (mesma
  informação pública da Fase 6), e `AiProvider` (mesmo adapter de LLM da Fase 12, exportado de
  `AiModule` especificamente para isso). O fluxo é: webhook → identidade → conversa → (IA só pra
  classificar intenção) → ferramentas de domínio já existentes → Postgres — nunca
  `WhatsApp → LLM → Prisma` direto.
- **IA usada só para classificar intenção, nunca para responder ao cliente**: a única saída do
  modelo (`WhatsAppIntentService`) é um JSON fechado (`{"intent": "..."}`), validado campo a campo
  contra um schema fixo antes de qualquer uso — nunca prosa livre interpolada numa resposta. Todo
  texto que o cliente recebe vem de templates centralizados (`whatsapp/messages.ts`), parametrizados
  só com dados já validados. Isso é a principal defesa contra prompt injection: mesmo um modelo
  totalmente manipulado só consegue produzir `UNKNOWN` (resposta de ajuda genérica) — não existe
  caminho pelo qual a saída do LLM alcance o cliente como texto não filtrado, nem influencie
  `arenaId`/`userId`/preço de qualquer escrita (esses nunca são enviados ao modelo nem lidos da
  resposta dele — o LLM nunca vê nem decide esses três valores).
- **Datas/horários nunca calculados pelo modelo** (item 27 do prompt da fase): o LLM só extrai a
  frase bruta ("amanhã", "19h") — toda a aritmética de data relativa e validação de horário é
  determinística (`nlp.util.ts`), testada sem nenhum mock de IA. Item 40 (evitar chamada de IA
  quando não agrega valor) foi levado a sério: seleção numérica, "sim"/"não" e mensagens de
  confirmação nunca chamam o modelo — só a primeira mensagem de cada intenção nova (estado `IDLE`)
  passa pelo classificador.
- **Identidade do cliente**: reaproveita `User.phone`, já sincronizado do Clerk desde a Fase 2 —
  nenhuma tabela de identidade paralela. Ganhou `@unique` (nova migration) porque a resolução de
  identidade do WhatsApp precisa de um match exato. Um cliente sem telefone vinculado no Clerk
  recebe uma explicação amigável, nunca uma conta "fantasma" criada silenciosamente.
- **Identidade da arena**: `Arena.whatsappPhoneNumberId` (novo campo, único, nova migration) —
  identificador ESTÁVEL da Meta (`phone_number_id`), nunca uma comparação de string de telefone.
  Configurável via `PATCH /v1/arenas/:arenaId` (reaproveita a autorização OWNER/ADMIN já existente)
  e pelo frontend em `/dashboard/[arenaId]/configuracoes`.
- **Estado da conversa é autoridade do backend, nunca do LLM** (item 34): `WhatsAppConversation`
  (nova model, uma linha por par arena+cliente) guarda um estado explícito
  (`IDLE`/`SELECTING_DATE`/`SELECTING_TIME`/`SELECTING_COURT`/`CONFIRMING_BOOKING`/
  `CANCEL_SELECTING`/`CANCEL_CONFIRMATION`/...) e os campos mínimos pra retomar o fluxo — nunca o
  texto das mensagens em si. Toda opção numerada oferecida (`pendingOptions`) é revalidada contra o
  banco antes de qualquer escrita, nunca confiada só por ter sido oferecida há pouco.
- **Confirmação explícita, com TTL** (itens 17, 35): reserva e cancelamento só acontecem depois de
  uma resposta EXATA (`"sim"`, `"confirmo"`, etc. — nunca substring, então `"acho que sim"` ou
  `"19h então"` nunca confirmam), com uma janela de 15 minutos; expirada, o cliente precisa
  recomeçar.
- **Idempotência em duas camadas**: (1) o próprio evento do webhook é deduplicado por
  `providerEventId` (`WhatsAppEvent`, nova model, técnica "claim-first" igual ao `IdempotencyKey` da
  Fase 4); (2) a criação de reserva usa o mecanismo formal de `Idempotency-Key` já existente
  (`IdempotencyService.execute`), com a chave (`pendingActionId`) gerada uma única vez ao entrar em
  `CONFIRMING_BOOKING` — nunca regenerada por retry do webhook.
- **Concorrência real**: nenhum mecanismo de lock novo — a mesma `pg_advisory_xact_lock` +
  `EXCLUDE USING GIST` da Fase 4 protege reservas criadas via WhatsApp. Validado com dois clientes
  confirmando o MESMO horário simultaneamente (`Promise.all` de dois webhooks reais contra Postgres
  real): exatamente uma reserva é confirmada, o outro cliente recebe uma mensagem amigável de
  conflito.
- **Cancelamento reaproveita o CAS da Fase 13** sem modificação — `BookingsService.cancel` já
  garante ownership (dono da reserva OU OWNER/ADMIN) e proteção contra corrida; o cliente via
  WhatsApp só consegue listar e selecionar as PRÓPRIAS reservas confirmadas futuras desta arena,
  então a checagem de ownership de outro cliente nem chega a ser necessária no fluxo (é impossível
  selecionar uma reserva que nunca aparece na lista).
- **PII minimizada no que chega ao LLM**: o modelo nunca recebe telefone, e-mail, nome de cliente,
  ID interno (`cuid`) ou dado de outra arena — só o texto livre da mensagem atual. Logs nunca
  incluem o telefone completo (máscara `***XXXX`) nem o corpo da mensagem.
- **Sem lib de WhatsApp SDK nova**: `fetch` nativo pra chamar a Graph API, mesma filosofia de
  dependências mínimas da Fase 12 (OpenAI também via `fetch`).
- **Nenhuma integração real validada** (sem credenciais de produção da Meta neste ambiente) — ver
  `docs/DEPLOYMENT.md`, "Canal de WhatsApp", para o que falta antes de ativar em produção de
  verdade. Testado com `FakeWhatsAppProvider`/`FakeAiProvider` (nunca fazem requisição HTTP real).
- **Explicitamente fora de escopo** (conforme o prompt): pagamentos, PIX, cartão, marketplace,
  campanhas, CRM, voz, imagem, WhatsApp Group, comandos administrativos pelo WhatsApp (bloqueio de
  quadra, alteração de preço, gestão de equipe — continuam exclusivos do dashboard), rate limiting
  persistente.
- **Dependências:** Fase 2 (`User.phone`, sincronizado do Clerk), Fase 4 (`BookingsService`, lock,
  EXCLUDE constraint, `Idempotency-Key`), Fase 5/6 (`AvailabilityService`, disponibilidade pública),
  Fase 9 (webhook raw body), Fase 12 (`AiProvider`, reaproveitado por inteiro), Fase 13 (CAS do
  cancelamento).
- **Critério de conclusão:** 95 novos testes unitários (`phone.util`, `users.service`,
  `arenas.service`, `nlp.util`, `intent.service`, `conversation.service`, `whatsapp.service`) + 19
  novos testes e2e (`whatsapp.e2e-spec.ts`) contra Postgres real — verificação/assinatura do
  webhook, identidade, criação de reserva ponta a ponta (com preço/idempotência/retry-sem-duplicar),
  confirmação ambígua nunca confirmando, concorrência real (dois clientes, mesmo horário,
  simultâneo), cancelamento real reaproveitando o CAS da Fase 13, isolamento multi-tenant (arena,
  preços, reservas), resistência a prompt injection, e prova de que consultas informativas nunca
  mutam o banco. Nenhum teste pré-existente foi removido ou reescrito. Ver relatório da fase para a
  lista completa.

### Fase 17 — Pagamentos e Ciclo de Vida Financeiro ✅ concluída
- **Objetivo:** dar a uma Booking CUSTOMER um ciclo financeiro próprio (`Payment`), separado do
  ciclo operacional (`Booking.status`) — cliente inicia o pagamento (PIX), o provider confirma via
  webhook, tudo idempotente/multi-tenant/seguro contra concorrência.
- **Desvio deliberado do placeholder original desta seção (registrado explicitamente, não
  silenciosamente)**: a v0.1 previa `BookingStatus` ganhando `PENDING`/`EXPIRED` (um fluxo de
  "hold" — a reserva só existiria de fato depois do pagamento). A Fase 17 real fez o OPOSTO,
  seguindo uma regra explícita do prompt da fase ("nunca transforme Booking.status em status de
  pagamento"): a Booking continua sendo criada e ocupando a quadra exatamente como desde a Fase 4
  (`CONFIRMED` imediato, protegida pelo mesmo lock/EXCLUDE constraint), e o pagamento é um registro
  financeiro BOLT-ON sobre uma Booking que já existe — nunca um portão antes dela existir. Native
  hold-based payment (reserva só é criada depois de aprovado) fica como possível evolução futura,
  não implementada aqui.
- **Fonte única de verdade do valor**: `Payment.amount` é copiado de `Booking.total` (já congelado
  desde a Fase 4) no momento da criação do Payment — o cliente não tem nenhum campo pra enviar
  `amount`/`status`/`currency`/`providerPaymentId` (o endpoint de criação nem declara um corpo
  aceito, a defesa mais forte possível contra mass assignment: não existe nada pra ler).
- **Modelo financeiro** (`Payment`, nova model): `id`, `bookingId`, `userId`, `arenaId` (os dois
  últimos DENORMALIZADOS deliberadamente — nunca só deriváveis via `booking.userId`/
  `booking.court.arenaId` — para que o webhook e consultas administrativas nunca dependam de um
  JOIN até `Booking`→`Court` pra provar isolamento multi-tenant; risco de inconsistência é nulo, os
  dois valores são copiados da mesma Booking na criação e nunca mudam depois), `amount`
  (`Decimal(10,2)`, nunca float — mesmo padrão de `Booking.total`), `currency` (sempre `"BRL"`
  nesta fase), `status`, `provider`, `providerPaymentId` (`@unique` quando não nulo), `idempotencyKey`,
  `failureReason`, `paidAt`, `expiresAt`, `createdAt`/`updatedAt`.
- **Cardinalidade evoluída conscientemente**: a Parte 7 original (pré-implementação) sugeria
  `Booking` 1—1 `Payment` (0 ou 1 no MVP). A Fase 17 real implementa `Booking` 1—N `Payment`
  (tentativas — permite retry após `FAILED`/`EXPIRED` sem duplicar cobrança efetiva), mas no
  MÁXIMO um `PAID` por Booking — garantido por um índice único parcial no Postgres
  (`Payment_bookingId_single_paid`, `WHERE status = 'PAID'`), mesma técnica já usada pro
  único-OWNER de arena (Fase 10) e a EXCLUDE constraint de Booking (Fase 4). Uma tentativa
  `PENDING` ativa (não expirada) pra mesma Booking é reaproveitada — nunca duas cobranças abertas
  em paralelo.
- **Máquina de estados**: `PENDING` é o ÚNICO estado não-terminal.
  `PAID`/`FAILED`/`EXPIRED`/`CANCELLED` são todos terminais e imutáveis — CAS condicionado a
  `status: PENDING` (mesmo padrão do CAS de cancelamento da Fase 13) garante que nenhum evento
  posterior (webhook fora de ordem, reenvio duplicado) reverta um estado já definitivo. Expiração
  (PIX, 30 min) é avaliada em tempo de leitura, mesmo padrão de `ArenaInvitation.expiresAt`
  (Fase 11) — nunca um job/cron.
- **Idempotência sem mecanismo novo**: reaproveita a MESMA técnica "claim-first" já estabelecida em
  `IdempotencyKey` (Fase 4)/`WhatsAppEvent` (Fase 16), aplicada diretamente à própria tabela
  `Payment` (via `@@unique([bookingId, idempotencyKey])`) em vez de uma segunda tabela — decisão
  registrada porque `IdempotencyService.execute()` embrulha tudo numa única transação Prisma, e a
  chamada ao gateway de pagamento é uma chamada HTTP externa que nunca deveria ficar dentro de uma
  transação de banco (ver Seção 24 do prompt da fase). Concorrência na CRIAÇÃO é resolvida por
  `pg_advisory_xact_lock(hashtext(bookingId))`, mesmo padrão já usado por
  `BookingsService.createBooking` pra `courtId` (Fase 4).
- **Webhook nunca confia no próprio corpo**: `POST /v1/webhooks/payments/mercadopago` exige
  assinatura válida (`X-Signature`/`X-Request-Id`, HMAC-SHA256, mesma disciplina do Clerk/WhatsApp)
  e, mesmo depois de aceito, NUNCA aplica o `status` que a notificação alega — sempre busca o
  status real de volta na API do provider pelo `data.id` antes de qualquer mudança de estado
  (`PaymentProvider.getPaymentStatus`). Deduplicado por `PaymentWebhookEvent` (nova model, mesma
  técnica "claim-first").
- **Dois endpoints novos, aninhados sob "minhas reservas" (Fase 6)**:
  `POST /v1/users/me/bookings/:bookingId/payments` (inicia/retoma uma tentativa, Idempotency-Key
  obrigatória, mesmo padrão da criação de Booking) e
  `GET /v1/users/me/bookings/:bookingId/payment` (consulta o estado atual, `null` se nunca houve
  tentativa). Reaproveita `BookingsService.findMyBookingDetail` (já exportado desde a Fase 16) pra
  toda checagem de existência/ownership/tipo — `BLOCK`/`MAINTENANCE` nunca geram Payment porque
  esse método já filtra `type: CUSTOMER`, estruturalmente, sem nenhuma checagem extra.
- **Integração com cancelamento (Fase 13)**: se a Booking for cancelada enquanto um Payment ainda
  está `PENDING`, uma confirmação `PAID` que chegue depois nunca é aplicada — vira `CANCELLED`
  (`failureReason: BOOKING_CANCELLED_BEFORE_PAYMENT`). **Nenhum refund foi implementado** (fora de
  escopo explícito do prompt) — uma Booking já paga e depois cancelada mantém o `Payment` como
  `PAID` (histórico correto de que o dinheiro entrou); qualquer devolução real é limitação
  documentada, não fingida.
- **WhatsApp (Fase 16) e IA (Fase 12) nunca escrevem em `Payment`**: nenhuma intenção de
  pagamento foi adicionada ao classificador do WhatsApp (`WhatsAppIntentService` continua com as
  mesmas 9 intenções da Fase 16); `PaymentsService` é exportado de `PaymentsModule` só para um
  consumidor futuro reaproveitar (nunca importado por `WhatsAppModule` nesta fase) — preparar a
  arquitetura, não implementar pagamento pelo WhatsApp.
- **Gateway escolhido**: Mercado Pago (PIX) — ver auditoria completa na entrada do relatório da
  fase; decisivo foi sandbox acessível sem CNPJ e um esquema de assinatura de webhook que mapeia
  diretamente no mesmo padrão HMAC já usado por Clerk/WhatsApp. Nenhuma integração real foi
  validada nesta fase (sem credenciais no ambiente) — testado inteiramente com
  `FakePaymentProvider`. Ver `docs/DEPLOYMENT.md`, "Pagamentos", para o que falta antes de produção.
- **Explicitamente fora de escopo** (conforme o prompt): marketplace/split, assinatura recorrente,
  cartão armazenado, refund, pagamento completo pelo WhatsApp, cartão de crédito (só PIX nesta
  fase).
- **Dependências:** Fase 4 (`Booking`, `Idempotency-Key`, lock por quadra, EXCLUDE constraint),
  Fase 6 ("minhas reservas", frontend), Fase 10 (índice único parcial, técnica reaproveitada),
  Fase 11 (expiração em tempo de leitura), Fase 13 (CAS de cancelamento), Fase 16
  (`BookingsService.findMyBookingDetail` exportado, convenção de webhook assinado).
- **Critério de conclusão:** testes unitários e e2e novos cobrindo criação (válida, Booking
  inexistente/alheia/cancelada, BLOCK, mass assignment, idempotência), webhook (assinatura
  válida/inválida/ausente, evento desconhecido/duplicado/fora de ordem, `PAID` terminal),
  concorrência real (duas criações simultâneas, duas confirmações `PAID` simultâneas, `PAID`+
  `FAILED` simultâneos, cancelamento durante pagamento), multi-tenant e IDOR. Nenhum teste
  pré-existente foi removido ou reescrito. Ver relatório da fase para os números reais.

---

### Fase 18 — Production Readiness, Observabilidade e Hardening Final ✅ concluída
- **Objetivo:** auditar e endurecer o ArenaHub para um primeiro deploy real (Vercel + Railway +
  Postgres gerenciado), sem adicionar nenhuma funcionalidade de produto nova. Pergunta central:
  "que problema de segurança/observabilidade/configuração/confiabilidade ainda pode quebrar o
  sistema em produção?"
- **Rate limiting pela primeira vez no produto** (`@nestjs/throttler`, registrado globalmente via
  `APP_GUARD`): limite padrão (`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS`, default 300/min por IP+rota)
  para qualquer rota sem override, e limites dedicados fixos no código — não configuráveis por env
  var, decisão de segurança — nos endpoints mais caros/sensíveis a abuso: IA (`ask`, 30/min),
  criação de pagamento (30/min), criação/cancelamento de reserva (100/min cada), criação de convite
  (20/min), resend de convite (10/min), clientes (100/min), relatórios (60/min), disponibilidade
  (200/min). `@SkipThrottle()` explícito nos três webhooks (Clerk/WhatsApp/Mercado Pago) e no health
  check — nunca dependem de limite por IP. Em memória, por instância — decisão deliberada de não
  introduzir Redis só para isto (mesmo raciocínio da não-adoção de Redis desde a Fase 1); limitação
  documentada, não escondida.
- **Correlation ID sem dependência nova**: `requestIdMiddleware` (registrado via
  `AppModule.configure`, não `app.use()` solto em `main.ts` — para ficar ativo também nos testes
  e2e) gera ou ecoa (só se já for seguro para log) um `X-Request-Id`, devolvido no header de
  resposta e propagado a qualquer service via `AsyncLocalStorage` nativo do Node
  (`RequestContext.getRequestId()`). Nunca usado para autenticação.
- **`LoggingInterceptor` global**: uma linha de log por requisição HTTP (método, rota sem query
  string, status, duração, `requestId`); 4xx em nível `log` (tráfego normal do produto), só 5xx em
  `error`.
- **`AllExceptionsFilter` global**: rede de segurança, nunca a primeira linha de defesa. Mapeia
  `Prisma.PrismaClientKnownRequestError` não tratado (`P2025`→404, `P2002`→409, resto→500) e
  qualquer outro erro não previsto para uma mensagem genérica — nunca vaza stack trace/mensagem de
  driver. `HttpException`s já intencionais (a maioria dos erros do app) passam inalteradas.
- **`WEB_APP_URL` obrigatória em produção**: `assertProductionSafety()` (`main.ts`) recusa o boot em
  produção sem essa variável — antes, o default de desenvolvimento (`localhost:3000`) podia
  silenciosamente virar a configuração real de um deploy mal feito.
- **Security headers no backend** (`helmet`, defaults) — registrado duas vezes deliberadamente (ver
  decisão 6 acima) para também cobrir requisições de preflight CORS. CORS em si ganhou
  normalização de origens (`trim`) e métodos declarados explicitamente.
- **`trust proxy` condicional em produção** — necessário para o rate limiting funcionar corretamente
  atrás do proxy da plataforma de deploy.
- **Docker HEALTHCHECK nativo** (Node puro, sem `curl`/`wget`) contra `/v1/health` — validado de
  verdade nesta fase (build real da imagem, container rodando contra Postgres real,
  `docker inspect` confirmando `"Status":"healthy"`).
- **Permissions-Policy no frontend** (`camera=(), microphone=(), geolocation=()`) — não tem o mesmo
  risco de quebrar Clerk/Next que CSP teria, então foi adicionado sem a mesma ressalva.
- **Auditoria transversal sem vulnerabilidade nova**: multi-tenant/IDOR/mass assignment revisados
  nos módulos de Pagamentos/Clientes/Relatórios (Fases 14/15/17) — a cobertura de testes já
  existente (Fase 8 `hardening.e2e-spec.ts` + specs dedicados de cada fase) já exercitava isso
  corretamente; nenhuma correção de segurança foi necessária.
- **Auditoria de segredos**: busca por padrões de chave/token (Clerk, OpenAI, Mercado Pago,
  WhatsApp, AWS, GitHub, chaves privadas) no repositório inteiro — nenhum segredo real versionado
  encontrado.
- **Explicitamente fora de escopo** (conforme o prompt): nenhuma funcionalidade de produto nova,
  nenhum deploy real, nenhuma credencial real criada, nenhuma integração real com OpenAI/Mercado
  Pago/Meta exercitada (permanecem pendentes de credenciais, ver Fases 12/16/17).
- **Dependências novas**: `@nestjs/throttler` e `helmet` (backend) — ambas justificadas por um
  requisito concreto desta fase, nenhuma adicionada preventivamente.
- **Critério de conclusão:** testes novos cobrindo rate limiting (e2e, com concorrência real via
  `Promise.all`), security headers, X-Request-Id (unitário + e2e), e o filtro global de exceções
  (unitário, incluindo o mapeamento de erros do Prisma). Nenhum teste pré-existente foi removido ou
  enfraquecido. Ver relatório da fase para os números reais.

---

## Riscos técnicos identificados

- **Concorrência em reservas** — mitigado pela defesa em profundidade da Parte 8; é o risco mais
  crítico do produto e o único que, se mal resolvido, quebra a confiança da arena no sistema.
  **Validado na Fase 4** com teste de concorrência real (`Promise.all` contra servidor e Postgres
  reais, não simulado) — o risco permanece o mais crítico, mas deixou de ser só teórico.
- **Multi-tenancy mal isolado** — todo bug de "arena A vê dado da arena B" é grave; mitigado por
  guard centralizado que sempre resolve `ArenaMember` a partir do recurso acessado, nunca de claim
  solto. Reservas (Fase 4) seguem o mesmo padrão, com uma exceção deliberada e documentada: criar
  `CUSTOMER` não exige `ArenaMember` (Parte 7).
- **Timezone** — mitigado por UTC no banco + `Arena.timezone` real (Parte 7), toda conversão via
  Luxon (nunca offset manual); é uma classe de bug fácil de introduzir sem querer em qualquer PR
  futuro que formate datas "no jeito rápido" ou compare horários locais sem passar pela biblioteca de
  timezone. **Implementado e testado na Fase 5**, incluindo DST (`America/New_York`). **A Fase 8
  provou que o risco era real, não só teórico**: encontrou um bug genuíno de deslocamento de 1h no
  dia da transição de DST, isolado à direção "hora local configurada → instante" da geração de
  slots (`.plus({minutes})` em vez de `.set({hour,minute})`) — a direção oposta ("instante →
  hora local", usada por `isWithinOperatingHours`) sempre esteve correta. O risco de regressão
  futura permanece o mesmo (reutilizar sempre Luxon com `.set()`, nunca `.plus()` de unidades
  sub-diárias para construir um instante a partir de um horário de parede).
- **Escopo da IA crescendo demais** — a capacidade de escrita via IA (agente com "tools", Parte 3)
  nasceu na Fase 16, mitigada exatamente como este risco previa: confirmação explícita obrigatória
  antes de criar/cancelar qualquer reserva (com TTL), e — reforço além do previsto originalmente —
  o modelo nem escolhe qual tool chamar; ele só classifica intenção num JSON fechado, e código
  determinístico decide toda chamada ao domínio. Revisar esse contrato sempre que uma nova
  intenção/ação for adicionada ao WhatsApp. A Fase 12 (assistente administrativo, só leitura)
  continua sem esse risco, por não ter nenhuma tool de escrita.
- **Contexto da IA vazando dado de outra arena ou PII** — mitigado desde a Fase 12 por construção: o
  contexto (`AiContext`) só é montado a partir de queries já filtradas por `arenaId`, nunca contém
  `cuid` interno nem campo de cliente (nome/e-mail/telefone/ClerkId). Validado por teste estrutural
  (unitário e e2e) — **não** validado semanticamente contra um modelo real (sem credencial de
  produção neste ambiente); resistência real a prompt injection fica como validação pendente antes
  de expor a funcionalidade a usuários reais em produção.
- **WhatsApp: mensagem manipulada tentando prompt injection/vazamento de dado de outra arena** —
  mitigado estruturalmente desde a Fase 16 por construção, não por confiança no modelo: a IA no
  canal de WhatsApp só produz um JSON fechado de classificação de intenção (nunca prosa mostrada ao
  cliente), validado campo a campo contra um schema fixo — mesmo que o modelo fosse completamente
  manipulado, o pior resultado possível é `UNKNOWN`. `arenaId`/`userId`/preço nunca são enviados ao
  nem lidos do modelo. Testado (unitário e e2e) simulando uma resposta de modelo "sequestrado" —
  **não** validado contra uma chamada real à OpenAI (mesma ressalva do risco acima).
- **WhatsApp real (Meta) nunca foi exercitado neste ambiente** — toda a integração foi validada com
  `FakeWhatsAppProvider` (unitário e e2e); antes de produção, validar manualmente o handshake do
  webhook, o envio real de mensagens e o formato exato do payload contra a Cloud API real (ver
  `docs/DEPLOYMENT.md`, "Canal de WhatsApp").
- **Acoplamento a um gateway de pagamento específico** — mitigado desde a Fase 17 por `PaymentProvider`
  (abstração, mesmo padrão de `AiProvider`/`WhatsAppProvider`) — trocar de Mercado Pago para outro
  gateway é implementar uma nova classe e trocar o `useClass` em `PaymentsModule`, sem tocar em
  `PaymentsService`/controllers/frontend. Reescrever o fluxo de reserva nunca foi necessário: a
  Booking continua sendo criada e ocupando a quadra exatamente como desde a Fase 4, o pagamento é
  bolt-on sobre uma Booking que já existe.
- **Pagamento confirmado depois que a reserva foi cancelada** — mitigado desde a Fase 17: o webhook
  sempre rechecha o status atual da Booking antes de aplicar `PAID`, e uma Booking `CANCELLED`
  nunca deixa um Payment virar `PAID` (vira `CANCELLED` em vez disso). Refund não implementado —
  limitação documentada (`docs/DEPLOYMENT.md`, "Pagamentos"), nunca fingida.
- **Webhook de pagamento processado fora de ordem ou duplicado corrompendo o estado financeiro** —
  mitigado desde a Fase 17 por uma máquina de estados com um único estado não-terminal (`PENDING`)
  e CAS condicionado a ele (mesmo padrão do CAS de cancelamento da Fase 13), mais deduplicação de
  evento (`PaymentWebhookEvent`, mesma técnica do `WhatsAppEvent` da Fase 16). Validado com
  concorrência real (`Promise.all` de webhooks simultâneos contra Postgres real).
- **Pagamento real com o Mercado Pago nunca foi exercitado neste ambiente** — toda a integração foi
  validada com `FakePaymentProvider` (unitário e e2e); antes de produção, validar manualmente uma
  cobrança PIX de ponta a ponta com credenciais de sandbox (ver `docs/DEPLOYMENT.md`, "Pagamentos").
- **Rate limiting em memória não é uma garantia distribuída** — introduzido na Fase 18
  (`@nestjs/throttler`); o contador vive no processo, então múltiplas instâncias rodando em paralelo
  multiplicam o limite efetivo por usuário. Aceitável para uma primeira implantação single-instance;
  se o produto crescer para múltiplas réplicas, o storage do throttler precisa migrar para um
  backend compartilhado (Redis, já provisionado no `docker-compose.yml` mas sem uso em produção
  hoje) antes de confiar nesses limites como proteção real — documentado, não escondido (ver
  `docs/DEPLOYMENT.md`, Seção 5.1).
- **Middleware a nível de módulo não cobre requisições de preflight CORS** — achado real na Fase 18:
  o middleware de CORS finaliza sozinho toda requisição `OPTIONS` antes dela alcançar qualquer
  middleware registrado via `NestModule.configure()`, então `helmet` "ativo" ainda deixava
  `X-Powered-By: Express` vazar em respostas de preflight. Corrigido registrando `helmet()` também
  diretamente em `main.ts`, antes de `enableCors()` — relevante para qualquer middleware futuro que
  precise cobrir literalmente toda resposta, inclusive preflight.
- **Endpoints sem limite de taxa até a Fase 18** — de Fase 1 até Fase 17, nenhum endpoint tinha
  qualquer proteção contra abuso por volume além de autenticação/autorização; mitigado na Fase 18
  com `@nestjs/throttler` (ver decisão 1 da v0.18) — risco de abuso por script/scraping
  significativamente reduzido, mas nunca eliminado (rate limiting é mitigação, não prevenção
  absoluta), e a limitação de "em memória" (item acima) permanece.
- **Listagem de clientes virando N+1 conforme a arena cresce** — mitigado desde a Fase 14 por
  agregação via `groupBy` (Postgres), sempre delimitada pela página atual, nunca uma query por
  cliente nem o histórico inteiro de reservas da arena carregado em memória.
- **Cancelamento concorrente sobrescrevendo metadado da vencedora** — mitigado desde a Fase 13 por
  `updateMany` condicionado a `status: CONFIRMED` (mesmo padrão CAS da Fase 11), nunca um `update`
  incondicional; validado com duas requisições HTTP simultâneas reais contra Postgres real.
- **Segundo OWNER na mesma arena** — mitigado desde a Fase 10 por um índice único parcial no banco
  (`ArenaMember_arenaId_single_owner`), não só por validação de aplicação; validado contra um caso
  real encontrado no próprio banco de desenvolvimento durante a implementação (ver Fase 10).
- **Token de convite vazando em log/resposta de API** — mitigado desde a Fase 11 por nunca persistir
  o token em si (só `sha256(token)`) e nunca devolvê-lo em nenhuma resposta administrativa; a única
  forma de obtê-lo é o e-mail de convite (capturado nos testes via mock do `InvitationEmailService`,
  prova de que nenhuma outra rota o expõe).
- **Aceite/transferência concorrentes criando estado inconsistente** (dois OWNER, ou um convite
  aceito duas vezes) — mitigado desde a Fase 11 por `updateMany` condicionado ao estado atual +
  checagem de `count`, com o índice único parcial da Fase 10 como autoridade final; validado com
  requisições HTTP concorrentes reais (`Promise.all`) contra Postgres real, não simulado.
