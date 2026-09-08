import { Image, type ImageStyle } from 'react-native';
import logoFull from '../../assets/images/logo-horizontal.png';
import logoIcon from '../../assets/images/icon.png';

// Equivalente mobile de apps/web/src/components/site-brand.tsx — mesmo
// papel (único ponto de referência aos assets de marca, nunca espalhado por
// vários arquivos) e mesma regra: os PNGs em assets/images/ são gerados
// diretamente dos SVGs oficiais da Siviero (apps/web/public/brand/), sem
// nenhuma alteração de desenho, cor ou proporção — nunca redesenhados.
const BRAND_SRC = { full: logoFull, icon: logoIcon } as const;

const ASPECT_RATIO = { full: 1316 / 572, icon: 1 } as const;

export function Brand({
  variant = 'full',
  height = 32,
  style,
}: {
  variant?: 'full' | 'icon';
  height?: number;
  style?: ImageStyle;
}) {
  return (
    <Image
      source={BRAND_SRC[variant]}
      accessibilityLabel="Siviero"
      resizeMode="contain"
      style={[{ height, width: height * ASPECT_RATIO[variant] }, style]}
    />
  );
}
