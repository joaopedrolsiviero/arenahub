// CommonJS deliberado (carregador de config do Jest, não código do app) —
// mesma exceção já documentada no eslint.config.mjs do Web para
// jest.config.js.
// transformIgnorePatterns deliberadamente NÃO sobrescrito aqui — o preset
// jest-expo já vem com o padrão correto para a versão do SDK instalada
// (cobre @react-native/*, expo-*, etc.); um valor próprio aqui substituiria
// (nunca mescla) o do preset e quebrava a transformação de pacotes nativos.
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
