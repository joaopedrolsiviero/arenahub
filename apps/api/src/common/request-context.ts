import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

// Fase 18 (item 9): correlação requisição -> serviço -> logs sem precisar
// injetar o request em toda cadeia de chamadas (AiService, PaymentsService,
// etc. nunca recebem o objeto Request do Express — continuam puros). Um
// AsyncLocalStorage (nativo do Node, nenhuma dependência nova) carrega o
// requestId implicitamente por toda a árvore de chamadas assíncronas
// disparadas dentro de RequestIdMiddleware.run(). Nunca usado para
// autorização — é só um rótulo de correlação em log.
export const RequestContext = {
  run<T>(requestId: string, fn: () => T): T {
    return storage.run({ requestId }, fn);
  },
  getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
