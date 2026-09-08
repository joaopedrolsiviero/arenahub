import { defineConfig, globalIgnores } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';

export default defineConfig([
  ...expoConfig,
  // Jest config must stay CommonJS (Jest's own config loader), not app
  // source — same exception already applied in apps/web/eslint.config.mjs.
  globalIgnores(['jest.config.js', 'metro.config.js', 'expo-env.d.ts']),
]);
