import { forgetLocal, type LocalDb, migrateLocal, supabaseRemote } from '@expeditionplan/sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import { openDatabaseSync } from 'expo-sqlite';

import { supabase } from '@/lib/supabase';

/**
 * Baza wyjazdów na telefonie (plan offline): expo-sqlite za synchronicznym interfejsem `LocalDb`
 * z packages/sync — te same zapytania co w testach na `node:sqlite`. Osobny plik bazy niż sesja
 * (`localStorage`), więc wyczyszczenie danych wyjazdów nie wylogowuje.
 */
const sqlite = openDatabaseSync('expeditionplan.db');

export const localDb: LocalDb = {
  exec: (sql) => sqlite.execSync(sql),
  run: (sql, params = []) => {
    sqlite.runSync(sql, params);
  },
  all: <T>(sql: string, params: (string | number | null)[] = []) => sqlite.getAllSync<T>(sql, params),
  transaction: <T>(fn: () => T) => {
    let result: T | undefined;
    sqlite.withTransactionSync(() => {
      result = fn();
    });
    return result as T;
  },
};

migrateLocal(localDb);

export const remote = supabaseRemote(supabase as unknown as SupabaseClient);

export const TRIPS_KEY = 'my_trips';
const OWNER_KEY = 'local_owner';

/**
 * Wylogowanie (także wygaśnięcie sesji) nie rusza planów — na wyjeździe muszą zostać. Dane
 * znikają dopiero, gdy zaloguje się inne konto niż to, którego plany leżą na telefonie.
 */
supabase.auth.onAuthStateChange((_event, session) => {
  const userId = session?.user.id;
  if (userId === undefined) return;
  const owner = localStorage.getItem(OWNER_KEY);
  if (owner !== null && owner !== userId) {
    forgetLocal(localDb);
    localStorage.removeItem(TRIPS_KEY);
  }
  if (owner !== userId) localStorage.setItem(OWNER_KEY, userId);
});
