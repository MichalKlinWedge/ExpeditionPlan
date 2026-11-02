import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TripDocument } from '@expeditionplan/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { importTrip } from '../../import.ts';
import { supabaseRemote } from '../../remote.ts';
import { uuidv7 } from '../../uuid.ts';
import { nodeDb } from './node-db.ts';
import type { LocalSupabase } from './supabase-setup.ts';

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export type TestUser = { id: string; email: string; password: string };

/**
 * Konto testowe w lokalnym Supabase, z losowym adresem i hasłem na każde uruchomienie. Domyślnie
 * może zakładać wyjazdy (`trip_creator`); `creator: false` = konto bez zaproszenia.
 */
export async function createTestUser(env: LocalSupabase, label: string, { creator = true } = {}): Promise<TestUser> {
  const admin = createClient(env.url, env.secretKey, NO_SESSION);
  const email = `${label}-${uuidv7()}@test.local`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { trip_creator: creator } });
  if (error) throw error;
  return { id: data.user.id, email, password };
}

/**
 * Urządzenie = własny klient z własną sesją. Telefon ma przełącznik sieci: „offline” zrywa
 * każde żądanie HTTP tak, jak robi to brak zasięgu (TypeError z fetch).
 */
export async function createDevice(env: LocalSupabase, user: TestUser, options: { dbPath?: string } = {}) {
  let offline = false;
  const client: SupabaseClient = createClient(env.url, env.publishableKey, {
    ...NO_SESSION,
    global: {
      fetch: (input, init) => (offline ? Promise.reject(new TypeError('fetch failed')) : fetch(input, init)),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return {
    client,
    remote: supabaseRemote(client),
    db: nodeDb(options.dbPath),
    setOffline: (value: boolean) => {
      offline = value;
    },
  };
}

export function loadFixture(slug: string): TripDocument {
  const path = fileURLToPath(new URL(`../../../../../fixtures/plans/${slug}/plan.json`, import.meta.url));
  return TripDocument.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Organizator zakłada wyjazd z wzorcowego planu (jak skrypt seed z MVP-1). */
export async function seedTrip(client: SupabaseClient, doc: TripDocument) {
  const { tripId, rows } = await importTrip(client, doc);
  return { tripId, rows: rows.tables as Record<string, ({ id: string } & Record<string, unknown>)[]> };
}

export async function waitFor(condition: () => boolean, timeoutMs: number, stepMs = 10): Promise<number> {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > timeoutMs) throw new Error(`Nie doczekano się w ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return performance.now() - start;
}
