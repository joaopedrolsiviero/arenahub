// Fase de Branding — identidade oficial da Siviero (empresa por trás do
// ArenaHub). Os dois arquivos em `public/brand/` são os SVGs fornecidos
// pelo dono do projeto, copiados sem nenhuma alteração de desenho, cor ou
// proporção — nunca editados, nunca substituídos por versão gerada. Este
// componente é o ÚNICO ponto de referência a esses arquivos no código
// (item 13: nunca espalhar `/brand/siviero-*.svg` por vários arquivos),
// reaproveitado pelo header público (`SiteHeader`), pela home e pelo
// header do dashboard.
//
// `<img>` (não `next/image`): os SVGs carregam metadata própria (C2PA) e
// não se beneficiam do pipeline de otimização de raster do Next — mesmo
// padrão já aceito neste repositório para o QR Code do PIX
// (`minhas-reservas/[bookingId]/page.tsx`), que também usa `<img>` puro
// pelo mesmo motivo.
const BRAND_SRC = {
  full: '/brand/siviero-logo.svg',
  icon: '/brand/siviero-icon.svg',
} as const;

export function SiteBrand({
  variant = 'full',
  className,
}: {
  variant?: 'full' | 'icon';
  className?: string;
}) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={BRAND_SRC[variant]} alt="Siviero" className={className} />;
}
