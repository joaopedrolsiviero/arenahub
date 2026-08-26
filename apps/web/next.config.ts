import type { NextConfig } from "next";

// Fase 9, item 101: só o subconjunto de headers seguro por padrão, que não
// depende de listar domínios do Clerk (frame-ancestors/CSP quebraria o
// widget do Clerk se a lista de origens permitidas estivesse incompleta, e
// isso só pode ser validado com testes reais contra o domínio de produção,
// que este ambiente não tem — ver docs/DEPLOYMENT.md). HSTS é ignorado pelo
// navegador em HTTP puro, então é seguro declarar mesmo em dev.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Fase 18, item 5: desliga só as APIs de navegador que o produto nunca usa
  // (câmera/microfone/geolocalização) — ao contrário de CSP, não depende de
  // conhecer domínios externos do Clerk/Next, então não tem o mesmo risco de
  // quebrar a integração; seguro habilitar sem validação contra produção.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
