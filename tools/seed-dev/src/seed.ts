/**
 * Seed bazy deweloperskiej (MVP-1): pięć planów z `fixtures/plans/` jako wyjazdy testowe.
 *
 *   npm run seed:dev              — lokalne Supabase (`npm run supabase -- start`)
 *
 * Tworzy (albo bierze istniejące) dwa konta testowe: organizatora, który dostaje wyjazdy, i widza,
 * zaproszonego do nich linkiem — tak sprawdza się kryterium odbioru MVP-1 ręcznie. Hasła są
 * tylko dla lokalnej bazy; skrypt odmawia pracy na adresie innym niż localhost.
 * Ponowne uruchomienie pomija wyjazdy, które organizator już ma (po tytule).
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TripDocument } from '@expeditionplan/core';
import { importTrip } from '@expeditionplan/sync';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export const DEV_USERS = {
  organizer: { email: 'organizator@expeditionplan.test', password: 'expeditionplan-dev', name: 'Organizator', creator: true },
  viewer: { email: 'widz@expeditionplan.test', password: 'expeditionplan-dev', name: 'Widz', creator: false },
};

function localSupabase() {
  const raw = execSync('npx --yes supabase@2.122.0 status -o json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const status = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, string>;
  const url = status.API_URL!;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error(`Seed tylko na lokalnej bazie, a nie na ${url}`);
  return { url, publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY!, secretKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY! };
}

async function signIn(env: ReturnType<typeof localSupabase>, user: (typeof DEV_USERS)[keyof typeof DEV_USERS]): Promise<SupabaseClient> {
  const admin = createClient(env.url, env.secretKey, NO_SESSION);
  const created = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { full_name: user.name },
    // Zakładać wyjazdy może tylko konto z flagą (migracja trip_creators); widz tylko ogląda.
    app_metadata: { trip_creator: user.creator },
  });
  if (created.error && created.error.code !== 'email_exists') throw created.error;
  const client = createClient(env.url, env.publishableKey, NO_SESSION);
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}

const env = localSupabase();
const organizer = await signIn(env, DEV_USERS.organizer);
const viewer = await signIn(env, DEV_USERS.viewer);

const { data: existing, error: listError } = await organizer.from('trips').select('id, title').is('deleted_at', null);
if (listError) throw listError;
const titles = new Set(existing.map((trip) => trip.title as string));

const plansDir = `${ROOT}fixtures/plans/`;
for (const slug of readdirSync(plansDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
  const doc = TripDocument.parse(JSON.parse(readFileSync(`${plansDir}${slug}/plan.json`, 'utf8')));
  if (titles.has(doc.trip.title)) {
    console.log(`${slug}: już jest — pomijam`);
    continue;
  }
  const started = performance.now();
  const { tripId, rows } = await importTrip(organizer, doc);
  const count = Object.values(rows.tables).reduce((sum, list) => sum + list.length, 0);
  // Widz dołącza tak, jak dołączy prawdziwa osoba: przez link z jednorazowym tokenem.
  const invite = await organizer.rpc('create_invite', { p_trip: tripId, p_role: 'viewer', p_days: 1, p_max_uses: 1 });
  if (invite.error) throw invite.error;
  const joined = await viewer.rpc('accept_invite', { p_token: invite.data });
  if (joined.error) throw joined.error;
  console.log(`${slug}: ${doc.trip.title} — ${count} wierszy, ${Math.round(performance.now() - started)} ms, widz dołączył`);
}

console.log(`\nKonta (tylko lokalnie): ${DEV_USERS.organizer.email}, ${DEV_USERS.viewer.email} — hasło w tools/seed-dev/src/seed.ts`);
