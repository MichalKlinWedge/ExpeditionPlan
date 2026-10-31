import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testy z prawdziwym Supabase: npm run test:integration (wymaga `npm run supabase -- start`).
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
  },
});
