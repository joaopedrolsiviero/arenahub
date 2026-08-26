import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

// Aceita um X-Request-Id externo (ex: de um load balancer ou de outro
// serviço encadeando a mesma requisição) SOMENTE se ele já parecer seguro
// pra virar uma linha de log — nunca ecoa de volta um valor arbitrário do
// cliente sem validar (poderia ser usado pra injetar caracteres de controle
// em log, ou um valor gigante). Fora desse formato, um novo ID é sempre
// gerado — o cliente nunca fica sem um X-Request-Id na resposta.
const SAFE_EXTERNAL_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

// Fase 18 (item 9): correlacionar requisição -> logs -> (quando aplicável)
// chamada a provider externo. Deliberadamente um middleware funcional do
// Express (não uma classe NestMiddleware injetável) — não depende de nada
// do container de DI, e precisa rodar antes de qualquer outra coisa, então
// é registrado direto via `app.use()` em main.ts, antes de CORS/Helmet.
// Nunca usado para autenticação/autorização (item 9 do prompt) — é só um
// rótulo de correlação.
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const incomingId = typeof incoming === 'string' ? incoming : undefined;
  const requestId =
    incomingId && SAFE_EXTERNAL_ID_PATTERN.test(incomingId) ? incomingId : randomUUID();

  res.setHeader('X-Request-Id', requestId);
  RequestContext.run(requestId, next);
}
