import * as SecureStore from 'expo-secure-store';
import type { TokenCache } from '@clerk/clerk-expo';

// Persiste a sessão do Clerk entre reaberturas do app via SecureStore
// (Keychain/Keystore nativo) — sem isso, `@clerk/clerk-expo` guarda a sessão
// só em memória e o usuário precisaria logar de novo toda vez que o app
// fosse fechado. Nenhum JWT é armazenado "à mão" fora deste cache: é
// exatamente o mecanismo de sessão oficial do Clerk, nunca uma
// implementação própria (item 14 do prompt desta fase).
export const clerkTokenCache: TokenCache = {
  async getToken(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key, value) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // SecureStore pode falhar (ex: dispositivo sem Keychain configurado)
      // — a sessão simplesmente não persiste entre aberturas, nunca uma
      // exceção que derruba o app.
    }
  },
};
