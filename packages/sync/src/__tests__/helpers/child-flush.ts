/**
 * Proces „telefonu” do scenariusza 3b: wysyła outbox z pliku SQLite po jednym wierszu i melduje
 * każdą udaną wysyłkę, a test zabija go w losowym momencie. Uruchamiany wprost przez Node
 * (usuwanie typów), więc importuje tylko moduły bez zależności od `@expeditionplan/core`.
 */
import { createClient } from '@supabase/supabase-js';

import { flushOutbox } from '../../outbox.ts';
import { supabaseRemote } from '../../remote.ts';
import { nodeDb } from './node-db.ts';

const env = (name: string) => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`Brak ${name}`);
  return value;
};

const client = createClient(env('POC4_URL'), env('POC4_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
const { error } = await client.auth.signInWithPassword({ email: env('POC4_EMAIL'), password: env('POC4_PASSWORD') });
if (error) throw error;

const db = nodeDb(env('POC4_DB'));
const result = await flushOutbox(db, supabaseRemote(client), {
  batchSize: 1,
  afterSend: (sent) => process.stdout.write(`sent ${sent}\n`),
});
if (result.error !== undefined) throw new Error(result.error);
db.close();
process.exit(0);
