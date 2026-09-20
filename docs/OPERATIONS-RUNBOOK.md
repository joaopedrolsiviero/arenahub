# ArenaHub — Runbook operacional (suporte da primeira arena)

Guia curto para quem opera o ArenaHub no dia a dia. Só descreve o que **existe hoje** no produto;
o "porquê" técnico está em `ARCHITECTURE.md` e o "como fazer deploy" em `DEPLOYMENT.md`.

- **Painel da arena:** `https://app.sivierotech.com.br/dashboard/<arenaId>` (OWNER e ADMIN).
- **API:** `https://api.sivierotech.com.br/v1`.
- **Quem pode o quê:** OWNER e ADMIN veem a agenda, o status de pagamento e cancelam reservas de
  cliente. Só o OWNER convida/remove membros (aba **Equipe**).

---

## 1. Pagamento PIX — como ler o status na agenda

Cada reserva de cliente, na agenda do **Dashboard** ("Ocupação por quadra" e "Próximas reservas") e
no histórico do cliente (**Clientes → cliente**), mostra o status do pagamento:

| Badge | Significado | O que fazer |
|---|---|---|
| **Sem pagamento online** | Não existe PIX para a reserva: arena presencial, ou o cliente ainda não gerou o PIX. | Nada, se a arena cobra no local. Numa arena ONLINE, ver "PIX expirado/abandonado" abaixo. |
| **Aguardando pagamento** (`PENDING`) | PIX gerado, dentro do prazo (**30 min**). | Esperar. O Mercado Pago pode demorar alguns instantes para confirmar. |
| **Pago** (`PAID`) | PIX confirmado; a reserva está garantida. | Nada. |
| **Expirado** (`EXPIRED`) | Passaram 30 min sem pagamento. | Ver seção 2. |
| **Pagamento recusado** (`FAILED`) | O provedor recusou/falhou (ex.: erro ao criar o PIX). | O cliente pode gerar um novo PIX na tela da reserva. Se não for pagar, cancele a reserva. |
| **Reembolso em processamento** (`REFUNDING`) | Cancelamento de reserva paga: reembolso solicitado, ainda não confirmado. | Ver seção 4. |
| **Reembolsado** (`REFUNDED`) | Reembolso integral confirmado. | Nada. |

Regras que valem sempre:

- A reserva nasce **confirmada** assim que o cliente escolhe o horário — o pagamento é um passo
  separado. Por isso um PIX não pago **não** cancela a reserva sozinho.
- Se a mesma reserva teve mais de um PIX, o painel mostra o que vale: um pagamento **Pago** (ou em
  reembolso) sempre prevalece sobre uma tentativa mais nova.
- O badge **Expirado** é calculado na hora da consulta. O cliente ainda pode pagar um PIX antigo:
  se o Mercado Pago aprovar depois, o pagamento é reconhecido automaticamente (seção 3).

## 2. PIX expirado ou abandonado

`EXPIRED` **não** significa que a reserva foi cancelada — o horário continua ocupado.

1. Abra o **Dashboard** no dia da reserva e localize o badge **Expirado** (ou **Aguardando
   pagamento** por muito tempo).
2. Se quiser liberar o horário: clique em **Cancelar reserva** e confirme. A ação é irreversível; o
   horário volta a ficar disponível na hora.
3. Se o cliente pagar **depois** do cancelamento (PIX antigo ainda aberto): o sistema registra o
   pagamento e **reembolsa sozinho** o valor integral. A reserva continua cancelada.

O botão **Cancelar reserva** só aparece para reserva de cliente confirmada que ainda **não começou**.
Depois do início do horário o sistema não permite cancelar (nem para OWNER/ADMIN).

## 3. Pagamento confirmado

- `PAID` + reserva **confirmada** = tudo certo; o cliente recebe a notificação de pagamento.
- Pagamento que chega **depois de 30 min** também vira `PAID` (reconciliação automática).
- Pagamento aprovado para uma reserva **já cancelada** vira `PAID` e o reembolso é disparado
  automaticamente; a reserva não é reaberta.

## 4. Cancelamento com pagamento e reembolso

Cancelar uma reserva **paga** (pelo painel, pelo cliente ou pelo WhatsApp) faz o sistema pedir o
reembolso **integral** ao Mercado Pago (mesma regra para cliente, OWNER e ADMIN). O painel não faz
nenhuma conta de reembolso — só pede o cancelamento.

- Fluxo normal: `PAID` → `REFUNDING` → `REFUNDED`. O PIX pode levar um tempo para confirmar; o status
  se atualiza quando alguém abre a reserva/pagamento.
- Reserva que já começou: **não** pode ser cancelada pelo sistema. Se for preciso devolver o dinheiro,
  o estorno é feito manualmente no painel do Mercado Pago.
- Consulte os **logs** (Railway → serviço da API → Logs) quando o status não avançar. Busque por
  `refund`, pelo `paymentId` ou pelo `bookingId`.

## 5. Reembolso que não concluiu

| Situação | O que significa | Procedimento existente |
|---|---|---|
| `REFUNDING` **com** reembolso já registrado no provedor | O Mercado Pago ainda está processando. | Aguardar. Reabrir a reserva/pagamento reconcilia sozinho para `REFUNDED`. |
| `REFUNDING` **sem** reembolso registrado | A chamada ao Mercado Pago falhou (indisponibilidade). O dinheiro **não** foi devolvido. | Repetir o cancelamento da reserva: `POST /v1/arenas/:arenaId/courts/:courtId/bookings/:bookingId/cancel` (é idempotente — numa reserva já cancelada responde 200 e tenta o reembolso de novo, com a mesma chave, sem duplicar). **Não há botão na UI para isso hoje**; alternativa: estornar manualmente no painel do Mercado Pago e avisar o desenvolvedor. |
| Pagamento `FAILED` com motivo `PROVIDER_ERROR` | O PIX não chegou a ser criado no Mercado Pago. Nenhum dinheiro envolvido. | O cliente gera um novo PIX; ou cancele a reserva. |
| Aprovação tardia sobre reserva cancelada | Pagamento chegou depois do cancelamento. | Automático (seção 3). Se o log mostrar `[late-approval][ACAO-OPERACIONAL]` e o pagamento não chegar a `REFUNDED`, siga a linha "`REFUNDING` sem reembolso" acima. |
| Log `DUPLICATE_PAYMENT_FOR_BOOKING` | Um segundo PIX da mesma reserva foi pago depois de outro já ter sido confirmado. Possível cobrança em duplicidade. | **Estorno manual** no painel do Mercado Pago (o sistema não estorna esse caso). |

Logs úteis para investigação (Railway): `[late-approval][ACAO-OPERACIONAL]`,
`DUPLICATE_PAYMENT_FOR_BOOKING`, `refund`. Toda requisição tem `requestId` (header `X-Request-Id`),
que aparece nas linhas de log da mesma chamada. Para achar o pagamento de uma reserva, consulte a
tabela `Payment` pelo `bookingId` (guarda também o id do pagamento no Mercado Pago).

> Não existe hoje alerta automático: os logs acima só são vistos se alguém os consultar.

## 6. Convites de administrador (aba Equipe, só OWNER)

| Situação | O que fazer |
|---|---|
| Convite **expirado** (validade de 7 dias; badge "Expirado") | Clique em **Reenviar**. Gera link novo no mesmo convite; o link antigo deixa de valer. |
| Convite **revogado** | Não dá para reenviar. Crie um convite novo. |
| **E-mail errado** | **Revogar** o convite e criar um novo com o e-mail correto. O convite só vale para o e-mail convidado. |
| Convidado **não recebeu** o e-mail | Peça para olhar o spam; clique em **Reenviar**. Se persistir, veja o log da API (`Falha ao enviar e-mail do convite`) e o painel do Resend. |
| Convidado entra com **outra conta** (e-mail diferente) | Ele vê "convite enviado para outro endereço". Deve entrar com o e-mail convidado. |
| Já é membro da arena | O sistema recusa criar/aceitar convite duplicado. |

## 7. Saúde da API

- `GET https://api.sivierotech.com.br/v1/health` — a API está no ar.
- `GET https://api.sivierotech.com.br/v1/health/ready` — a API consegue falar com o banco. `503` =
  banco inacessível.

Se a API estiver indisponível:

1. Abra os endpoints acima. 2. No **Railway**, veja o status do deploy e os **Logs** da API e do
Postgres. 3. Se começou logo após um deploy, siga **Rollback** (`DEPLOYMENT.md`, seção 14).
4. Consulte a tabela **Troubleshooting** do `DEPLOYMENT.md` (variáveis ausentes, banco, Clerk).

## 8. Backup

Backup diário do banco (`pg_dump` → Cloudflare R2) via GitHub Actions. Procedimento, retenção e
restauração: `DEPLOYMENT.md`, **seção 13 (Backup e restore)**. Não duplicado aqui.

---

## O que este runbook NÃO cobre (limites atuais)

- Não há botão no painel para repetir um reembolso que falhou (seção 5).
- OWNER/ADMIN não recebem notificação de reserva nova, cancelamento ou falha de reembolso.
- Não há alertas automáticos nem Sentry: problemas só aparecem em quem consultar logs.
- Como o dinheiro do PIX chega à arena (repasse) é decisão de negócio fora do sistema.
