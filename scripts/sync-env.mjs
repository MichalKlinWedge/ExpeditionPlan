#!/usr/bin/env node
/**
 * Jeden `.env.local` w katalogu głównym → `.env.local` aplikacji. Next i Expo czytają pliki env
 * tylko ze swojego katalogu (apps/web, apps/mobile), a trzymanie trzech kopii kończy się
 * rozjazdem. Do aplikacji trafiają zmienne publiczne (`NEXT_PUBLIC_` / `EXPO_PUBLIC_`), a do weba
 * także klucze serwerowe („Zaplanuj z AI”: Gemini, Geoapify, ORS; SMTP; `FRIENDS_APK_URL`) — bez przedrostka `NEXT_PUBLIC_`
 * Next nie wpuszcza ich do przeglądarki. `SUPABASE_SERVICE_ROLE_KEY` zostaje w katalogu głównym,
 * a do telefonu nie idzie żaden klucz.
 *
 *   node scripts/sync-env.mjs           — wartości z .env.local (projekt w chmurze)
 *   node scripts/sync-env.mjs --local   — web na lokalnym Supabase (`npm run supabase -- start`)
 *
 * Wartości nie są wypisywane. Pliki wynikowe są w .gitignore (`.env*.local`).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = process.argv.includes('--local');

function parse(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && match[2] !== '') vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

const source = existsSync(`${root}.env.local`) ? parse(readFileSync(`${root}.env.local`, 'utf8')) : {};

if (local) {
  const raw = execSync('npx --yes supabase@2.122.0 status -o json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  source.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
  source.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
}

const SERVER_KEYS = ['GEMINI_API_KEY', 'AI_MODEL_GEMINI', 'GEOAPIFY_API_KEY', 'OPENROUTESERVICE_API_KEY', 'AI_ALLOWED_EMAILS', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'FRIENDS_APK_URL'];

const targets = [
  { file: 'apps/web/.env.local', prefix: 'NEXT_PUBLIC_', server: SERVER_KEYS },
  // Telefon nie widzi 127.0.0.1 komputera — aplikacja mobilna zawsze idzie do chmury.
  { file: 'apps/mobile/.env.local', prefix: 'EXPO_PUBLIC_', server: [] },
];

for (const { file, prefix, server } of targets) {
  const entries = Object.entries(source).filter(([key]) => key.startsWith(prefix) || server.includes(key));
  const body = [
    `# Wygenerowane przez scripts/sync-env.mjs${local && prefix === 'NEXT_PUBLIC_' ? ' --local' : ''} — edytuj główny .env.local.`,
    ...entries.map(([key, value]) => `${key}=${value}`),
    '',
  ].join('\n');
  writeFileSync(`${root}${file}`, body);
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].map((name) => prefix + name).filter((name) => !source[name]);
  console.log(`${file}: ${entries.length} zmiennych${missing.length ? ` (brak: ${missing.join(', ')})` : ''}`);
}
