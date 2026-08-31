// Fase 32 — origem pública canônica do produto, usada por `metadataBase`
// (layout raiz), `sitemap.ts` e `robots.ts`. Sem env var nova: não há
// domínio próprio ainda (Fase 19 — Clerk roda em modo Development por
// causa disso, ver docs/ARCHITECTURE.md, "Riscos técnicos identificados"),
// então o próprio domínio `.vercel.app` de produção É o domínio real hoje.
// `NEXT_PUBLIC_SITE_URL` fica como escape hatch pra quando isso mudar, sem
// exigir alterar código.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub-xi.vercel.app';
