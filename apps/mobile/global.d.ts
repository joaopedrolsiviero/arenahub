// Declaração de módulo para assets estáticos (Metro resolve o import em
// runtime; o TypeScript precisa de um tipo para ele em tempo de checagem —
// nem expo/types nem os tipos do próprio react-native declaram isso nesta
// versão do SDK). Só os formatos usados no projeto.
declare module '*.png' {
  const value: number;
  export default value;
}
