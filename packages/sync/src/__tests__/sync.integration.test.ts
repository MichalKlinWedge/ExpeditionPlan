import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scheduleDay } from '@expeditionplan/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { stateFromLocal, stateFromPayload, type TripState } from '../document.ts';
import { flushOutbox, pendingCount, recordDelay, saveExpense } from '../outbox.ts';
import { pullChanges, serialPuller, syncTrip } from '../pull.ts';
import { watchTrip } from '../remote.ts';
import { createDevice, createTestUser, loadFixture, seedTrip, type TestUser, waitFor } from './helpers/harness.ts';

/**
 * PoC-4 na prawdziwym (lokalnym) Supabase: web = organizator przy laptopie, telefon = ten sam
 * organizator z bazą SQLite. Scenariusze z PLAN_ETAPOWY, PoC-4.
 */

const env = inject('supabase');
let owner: TestUser;

beforeAll(async () => {
  owner = await createTestUser(env, 'owner');
});

type Device = Awaited<ReturnType<typeof createDevice>>;
const devices: Device[] = [];
const device = async (options: { dbPath?: string } = {}) => {
  const created = await createDevice(env, owner, options);
  devices.push(created);
  return created;
};

afterAll(async () => {
  for (const each of devices) {
    each.db.close();
    await each.client.removeAllChannels();
  }
});

const ids = (rows: Record<string, unknown>[]) => new Map(rows.map((row) => [row.ref as string, row.id as string]));

async function updateItem(client: SupabaseClient, itemId: string, patch: Record<string, unknown>) {
  const result = await client.from('items').update(patch).eq('id', itemId);
  if (result.error) throw result.error;
}

/** Harmonogram całego wyjazdu w obu scenariuszach — porównywany między urządzeniami. */
function fullSchedule({ doc, inputs }: TripState) {
  return doc.days.flatMap((day) =>
    (['optimistic', 'pessimistic'] as const).map((scenario) => scheduleDay(doc, day.ref, { ...inputs, scenario })),
  );
}

async function webState(client: SupabaseClient, tripId: string): Promise<TripState> {
  const { data, error } = await client.rpc('pull_changes', { p_trip: tripId, p_since: 0 });
  if (error) throw error;
  return stateFromPayload(data);
}

describe('PoC-4 — synchronizacja Supabase ↔ SQLite', () => {
  it('scenariusz 1: zmiana na webie jest na telefonie w < 3 s', async () => {
    const web = await device();
    const phone = await device();
    const { tripId, rows } = await seedTrip(web.client, loadFixture('maroko'));
    await pullChanges(phone.db, phone.remote, tripId);

    const errors: unknown[] = [];
    const pull = serialPuller(() => pullChanges(phone.db, phone.remote, tripId), (error) => errors.push(error));
    let ready = false;
    const stop = watchTrip(phone.client, tripId, () => void pull(), (status) => {
      if (status === 'READY') ready = true;
    });
    await waitFor(() => ready, 10_000);

    const bahia = ids(rows.items!).get('d2-bahia')!;
    const localDuration = () =>
      JSON.parse(phone.db.all<{ data: string }>("select data from rows where tbl = 'items' and id = ?", [bahia])[0]!.data)
        .duration_min as number;

    const latencies: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const start = performance.now();
      await updateItem(web.client, bahia, { duration_min: 60 + i * 10 });
      await waitFor(() => localDuration() === 60 + i * 10, 3_000);
      latencies.push(Math.round(performance.now() - start));
    }
    await stop();

    expect(errors).toEqual([]);
    console.info(`[PoC-4] web → telefon (ms): ${latencies.join(', ')}`);
    expect(Math.max(...latencies)).toBeLessThan(3_000);
  });

  it('scenariusz 2: telefon offline, web zmienia plan — po powrocie sieci nic nie ginie, harmonogram ten sam', async () => {
    const web = await device();
    const phone = await device();
    const { tripId, rows } = await seedTrip(web.client, loadFixture('maroko'));
    const item = ids(rows.items!);
    const day2 = ids(rows.days!).get('d2')!;
    await pullChanges(phone.db, phone.remote, tripId);

    phone.setOffline(true);
    recordDelay(phone.db, tripId, day2, item.get('d2-medersa')!, 20);
    recordDelay(phone.db, tripId, day2, item.get('d2-bahia')!, 30);
    saveExpense(phone.db, { tripId, amountMinor: 45_000, currency: 'MAD', category: 'tickets', itemId: item.get('d2-bahia')! });
    recordDelay(phone.db, tripId, day2, item.get('d2-quady')!, 15);
    saveExpense(phone.db, { tripId, amountMinor: 12_000, currency: 'MAD', category: 'food', note: 'lunch' });

    const offlineTry = await syncTrip(phone.db, phone.remote, tripId);
    expect(offlineTry.flush.error).toContain('Brak połączenia');
    expect(pendingCount(phone.db)).toBe(5);

    // W tym czasie organizator zmienia plan na webie.
    await updateItem(web.client, item.get('d2-bahia')!, { duration_min: 90 });
    await web.client.from('items').update({ deleted_at: new Date().toISOString() }).eq('id', item.get('d2-suki-dzien')!);
    const added = await web.client.from('items').insert({
      id: crypto.randomUUID(),
      trip_id: tripId,
      ref: 'd2-herbata',
      day_id: day2,
      sort_key: '0055',
      kind: 'meal',
      title: 'Herbata miętowa',
      duration_min: 20,
    });
    expect(added.error).toBeNull();

    phone.setOffline(false);
    const online = await syncTrip(phone.db, phone.remote, tripId);
    expect(online.flush).toEqual({ sent: 5, remaining: 0 });

    const events = await web.client.from('schedule_events').select('id').eq('trip_id', tripId);
    const expenses = await web.client.from('expenses').select('amount_minor').eq('trip_id', tripId);
    expect(events.data).toHaveLength(3);
    expect(expenses.data?.map((row) => row.amount_minor).sort()).toEqual([12_000, 45_000]);

    const onPhone = stateFromLocal(phone.db, tripId);
    const onWeb = await webState(web.client, tripId);
    const refs = onPhone.doc.items.map((each) => each.ref);
    expect(refs).toContain('d2-herbata');
    expect(refs).not.toContain('d2-suki-dzien');
    expect(onPhone.doc.items.find((each) => each.ref === 'd2-bahia')?.durationMin).toBe(90);
    expect(onPhone.inputs.delays).toHaveLength(3);

    expect(fullSchedule(onPhone)).toEqual(fullSchedule(onWeb));
    // Opóźnienia naprawdę przesuwają dzień, więc porównanie nie jest puste.
    const plain = scheduleDay(onWeb.doc, 'd2', {});
    const delayed = scheduleDay(onWeb.doc, 'd2', onWeb.inputs);
    const end = (schedule: typeof plain, ref: string) => schedule.items.find((each) => each.ref === ref)!.end;
    expect(end(delayed, 'd2-quady') - end(plain, 'd2-quady')).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it('scenariusz 3a: awaria po wysłaniu, a przed potwierdzeniem — bez duplikatów (3 powtórzenia)', async () => {
    const web = await device();
    const phone = await device();
    const { tripId, rows } = await seedTrip(web.client, loadFixture('dinara'));
    const firstItem = rows.items!.find((each) => each.day_id !== undefined) as { id: string; day_id: string };
    await pullChanges(phone.db, phone.remote, tripId);

    for (let round = 1; round <= 3; round++) {
      for (let i = 0; i < 5; i++) recordDelay(phone.db, tripId, firstItem.day_id, firstItem.id, 5);
      saveExpense(phone.db, { tripId, amountMinor: 100 * round, currency: 'EUR' });

      await expect(
        flushOutbox(phone.db, phone.remote, {
          batchSize: 2,
          afterSend: (sent) => {
            if (sent >= 2) throw new Error('zabita aplikacja');
          },
        }),
      ).rejects.toThrow('zabita aplikacja');
      expect(pendingCount(phone.db)).toBe(6);

      await syncTrip(phone.db, phone.remote, tripId);
      expect(pendingCount(phone.db)).toBe(0);

      const events = await web.client.from('schedule_events').select('id').eq('trip_id', tripId);
      const expenses = await web.client.from('expenses').select('id').eq('trip_id', tripId);
      expect(events.data).toHaveLength(5 * round);
      expect(expenses.data).toHaveLength(round);
    }
  });

  it('scenariusz 3b: zabity proces w trakcie wysyłki outboxa — bez duplikatów i bez strat', async () => {
    const web = await device();
    const dir = mkdtempSync(join(tmpdir(), 'poc4-'));
    const dbPath = join(dir, 'phone.db');
    const phone = await device({ dbPath });
    const { tripId, rows } = await seedTrip(web.client, loadFixture('chatka'));
    const target = rows.items!.find((each) => each.day_id !== undefined) as { id: string; day_id: string };
    await pullChanges(phone.db, phone.remote, tripId);

    const TOTAL = 30;
    for (let i = 0; i < TOTAL; i++) recordDelay(phone.db, tripId, target.day_id!, target.id, 1);

    const script = fileURLToPath(new URL('./helpers/child-flush.ts', import.meta.url));
    const kills: number[] = [];
    // Zabicie po wysłaniu, a przed potwierdzeniem w SQLite: serwer ma więcej, niż telefon uważa za wysłane.
    let unacked = 0;
    for (let round = 0; round < 10 && pendingCount(phone.db) > 0; round++) {
      const killAfter = 1 + Math.floor(Math.random() * 4);
      const child = spawn(process.execPath, [script], {
        env: { ...process.env, POC4_URL: env.url, POC4_KEY: env.publishableKey, POC4_EMAIL: owner.email, POC4_PASSWORD: owner.password, POC4_DB: dbPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      let seen = 0;
      let killed = false;
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      const exit = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
      child.stdout.on('data', (chunk: Buffer) => {
        seen += String(chunk).match(/sent \d+/g)?.length ?? 0;
        if (!killed && seen >= killAfter) killed = child.kill('SIGKILL');
      });
      const code = await exit;
      if (!killed && code !== 0) throw new Error(`Proces wysyłki padł sam: ${stderr}`);
      kills.push(pendingCount(phone.db));
      const onServer = await web.client.from('schedule_events').select('id', { count: 'exact', head: true }).eq('trip_id', tripId);
      if ((onServer.count ?? 0) > TOTAL - pendingCount(phone.db)) unacked++;
    }
    console.info(`[PoC-4] outbox po kolejnych zabiciach: ${kills.join(' → ')}; zabicia przed potwierdzeniem: ${unacked}`);

    await syncTrip(phone.db, phone.remote, tripId);
    const events = await web.client.from('schedule_events').select('id').eq('trip_id', tripId);
    const local = phone.db.all<{ id: string }>("select id from rows where tbl = 'schedule_events' and trip_id = ?", [tripId]);
    expect(pendingCount(phone.db)).toBe(0);
    expect(events.data).toHaveLength(TOTAL);
    expect(new Set(events.data?.map((row) => row.id))).toEqual(new Set(local.map((row) => row.id)));
  });
});
