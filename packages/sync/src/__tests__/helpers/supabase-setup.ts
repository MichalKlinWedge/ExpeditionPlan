import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { TestProject } from 'vitest/node';

export type LocalSupabase = { url: string; publishableKey: string; secretKey: string };

declare module 'vitest' {
  export interface ProvidedContext {
    supabase: LocalSupabase;
  }
}

/** Adres i klucze lokalnego Supabase z `supabase status` (wartości deweloperskie, nie sekrety). */
export default function setup(project: TestProject) {
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  let raw: string;
  try {
    raw = execSync('npx --yes supabase@2.122.0 status -o json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error('Lokalne Supabase nie działa — uruchom `npm run supabase -- start` (wymaga Dockera).');
  }
  const status = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, string>;
  project.provide('supabase', {
    url: status.API_URL!,
    publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY!,
    secretKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY!,
  });
}
