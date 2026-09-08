// CommonJS deliberado (config do Metro, não código do app) — mesma exceção
// já documentada em jest.config.js.
//
// Achado real ao rodar `expo export`: o Expo Router escaneia TODO arquivo
// dentro de app/ pra descobrir rotas — inclusive os próprios *.test.tsx
// colocados ao lado das telas que testam (mesmo padrão do resto do
// monorepo). Isso tentava empacotar @testing-library/react-native no bundle
// de produção, que importa `console` do Node (inexistente no runtime do
// React Native) e quebrava o build. Corrigido excluindo só arquivos de
// teste do bundle do Metro — Jest e TypeScript continuam enxergando-os
// normalmente (usam resolução de módulo própria, nunca a do Metro); os
// testes nunca saem de onde estão.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList].filter(Boolean)),
  /\.test\.[jt]sx?$/,
];

module.exports = config;
