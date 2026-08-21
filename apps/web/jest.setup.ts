import '@testing-library/jest-dom';

// jsdom não implementa crypto.randomUUID (usado pela geração de
// Idempotency-Key no fluxo de reserva) — polyfill mínimo só para os testes.
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', { value: {} });
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto.randomUUID = (() =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    })) as Crypto['randomUUID'];
}
