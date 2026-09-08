// Ponto único de leitura de configuração pública — nenhum outro arquivo lê
// `process.env.EXPO_PUBLIC_*` diretamente (mesmo princípio de centralização
// do Web: NEXT_PUBLIC_API_URL só é lido em apps/web/src/lib/api.ts).
//
// Só variáveis EXPO_PUBLIC_* podem estar aqui — são inlined no bundle pelo
// Expo/Metro em tempo de build, então são, por definição, públicas. Nunca
// adicionar CLERK_SECRET_KEY, PAYMENT_API_KEY ou DATABASE_URL aqui: essas
// nunca têm equivalente EXPO_PUBLIC_ e nunca devem existir neste app.
function requirePublicEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Variável de ambiente pública ausente: ${name}. Copie apps/mobile/.env.example para .env.local.`,
    );
  }
  return value;
}

export const env = {
  apiUrl: requirePublicEnv('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL),
  clerkPublishableKey: requirePublicEnv(
    'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY',
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  ),
};
