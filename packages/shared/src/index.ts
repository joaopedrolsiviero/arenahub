// Ver docs/ARCHITECTURE.md, Parte 6 — "Regra de escopo do packages/shared".
//
// Este pacote pode conter apenas tipos TypeScript e schemas Zod
// compartilhados entre apps/web e apps/api. Nenhuma regra de negócio, acesso
// a banco ou código específico do NestJS deve viver aqui.
//
// Vazio de propósito na Fase 1 — os primeiros tipos/schemas compartilhados
// (ex: shape de Booking, payload de "criar reserva") entram a partir da
// Fase 2, junto com as features que precisam deles.
export {};
