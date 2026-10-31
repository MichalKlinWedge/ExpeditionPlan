import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, inject, it } from 'vitest';

import { rowsFromDocument, stateFromPayload } from '../document.ts';
import { importTrip } from '../import.ts';
import { uuidv7 } from '../uuid.ts';
import { createDevice, createTestUser, loadFixture } from './helpers/harness.ts';

/**
 * Kryterium odbioru MVP-1 (PLAN_ETAPOWY): druga osoba dołącza z linku jako widz, widzi wyjazd
 * i nie może niczego zmienić; pięć planów referencyjnych jest w bazie — i wraca z niej bez strat.
 */

const env = inject('supabase');
const devices: Awaited<ReturnType<typeof createDevice>>[] = [];

async function device() {
  const created = await createDevice(env, await createTestUser(env, 'mvp1'));
  devices.push(created);
  return created;
}

afterAll(async () => {
  for (const each of devices) await each.client.removeAllChannels();
});

const slugs = readdirSync(fileURLToPath(new URL('../../../../fixtures/plans/', import.meta.url)), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const byRef = <T extends { ref: string }>(list: T[]) => [...list].sort((a, b) => a.ref.localeCompare(b.ref));

describe('MVP-1 — plan w bazie, widz z linku', () => {
  it.each(slugs)('%s: widz z linku dostaje z bazy ten sam plan i nie może go zmienić', async (slug) => {
    const owner = await device();
    const viewer = await device();
    const doc = loadFixture(slug);
    const { tripId, rows } = await importTrip(owner.client, doc);

    const invite = await owner.client.rpc('create_invite', { p_trip: tripId, p_role: 'viewer' });
    expect(invite.error).toBeNull();
    const joined = await viewer.client.rpc('accept_invite', { p_token: invite.data });
    expect(joined.data).toBe(tripId);

    const pulled = await viewer.client.rpc('pull_changes', { p_trip: tripId, p_since: 0 });
    expect(pulled.error).toBeNull();
    const back = stateFromPayload(pulled.data).doc;
    expect({ ...back, items: byRef(back.items) }).toEqual({ ...doc, items: byRef(doc.items) });

    const item = rows.tables.items![0]!;
    const update = await viewer.client.from('items').update({ title: 'Zmienione' }).eq('id', item.id as string).select();
    expect(update.data).toEqual([]);
    const trip = await viewer.client.from('trips').update({ title: 'Zmienione' }).eq('id', tripId).select();
    expect(trip.data).toEqual([]);
    const insert = await viewer.client.from('notes').insert({ id: crypto.randomUUID(), trip_id: tripId, scope: 'trip', kind: 'info', body: 'x' });
    expect(insert.error?.code).toBe('42501');
  });

  it('import jest atomowy: plan z błędem nie zostawia połowy wyjazdu', async () => {
    const owner = await device();
    const rows = rowsFromDocument(loadFixture('dinara'), uuidv7(), uuidv7);
    // Ostatnia tabela importu dostaje wiersz łamiący ograniczenie — wszystko przed nim musi zniknąć.
    rows.tables.weather_snapshots = [{ id: uuidv7(), trip_id: rows.trip.id, lat: 999, lng: 0, forecast: {} }];
    rows.tables.weather_snapshots[0]!.day_id = 'nie-uuid';
    const result = await owner.client.rpc('import_trip', { p_trip: rows.trip, p_tables: rows.tables });
    expect(result.error).not.toBeNull();
    const trips = await owner.client.from('trips').select('id');
    expect(trips.data).toEqual([]);
  });
});
