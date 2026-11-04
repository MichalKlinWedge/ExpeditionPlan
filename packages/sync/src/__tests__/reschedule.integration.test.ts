import { addDays, shiftTripDates, TripDocument } from '@expeditionplan/core';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { COLLECTIONS, refIndex, stateFromPayload } from '../document.ts';
import { importTrip } from '../import.ts';
import { rescheduleTrip } from '../reschedule.ts';
import { uuidv7 } from '../uuid.ts';
import { createDevice, createTestUser, loadFixture } from './helpers/harness.ts';

/** Zmiana terminu na prawdziwej bazie: po ponownym pobraniu dokument to dokładnie wynik `shiftTripDates`. */

const env = inject('supabase');
const devices: Awaited<ReturnType<typeof createDevice>>[] = [];

async function device() {
  const created = await createDevice(env, await createTestUser(env, 'termin'));
  devices.push(created);
  return created;
}

afterAll(async () => {
  for (const each of devices) await each.client.removeAllChannels();
});

function normalize(doc: TripDocument) {
  const out: Record<string, unknown> = { ...doc };
  for (const collection of COLLECTIONS) out[collection] = [...(doc[collection] as { ref?: string }[])].sort((a, b) => (a.ref ?? '').localeCompare(b.ref ?? ''));
  return out;
}

async function ownTrip(slug: string) {
  const owner = await device();
  const { tripId } = await importTrip(owner.client, loadFixture(slug));
  const pull = async () => {
    const { data, error } = await owner.client.rpc('pull_changes', { p_trip: tripId, p_since: 0 });
    if (error) throw error;
    return data;
  };
  return { owner, tripId, pull };
}

describe('Zmiana terminu w bazie', () => {
  it.each(['maroko', 'gruzja', 'barcelona', 'chatka', 'dinara'])('%s: dokument z bazy równa się wynikowi z pamięci', async (slug) => {
    const { owner, tripId, pull } = await ownTrip(slug);
    const before = await pull();
    const shift = shiftTripDates(stateFromPayload(before).doc, addDays(stateFromPayload(before).doc.trip.startDate, 45));

    await rescheduleTrip(owner.client, tripId, { version: before.version, shift, ids: refIndex(before.tables) });

    expect(normalize(stateFromPayload(await pull()).doc)).toEqual(normalize(shift.doc));
  });

  it('brief „fixed” idzie za planem, a wyjazd można przy okazji przywrócić', async () => {
    const { owner, tripId, pull } = await ownTrip('chatka');
    const briefId = uuidv7();
    const inserted = await owner.client.from('trip_brief').insert({ id: briefId, trip_id: tripId, brief: { goal: 'x', dates: { kind: 'fixed', start: '2026-10-24', end: '2026-10-25' } } });
    expect(inserted.error).toBeNull();
    expect((await owner.client.from('trips').update({ status: 'postponed' }).eq('id', tripId)).error).toBeNull();
    const before = await pull();
    const shift = shiftTripDates(stateFromPayload(before).doc, '2027-10-23');

    await rescheduleTrip(owner.client, tripId, { version: before.version, shift, ids: refIndex(before.tables), briefs: before.tables.trip_brief, restore: true });

    const after = await pull();
    expect(after.tables.trip_brief[0].brief.dates).toEqual({ kind: 'fixed', start: '2027-10-23', end: '2027-10-24' });
    expect(after.trip.status).toBe('planning');
    expect(after.trip.start_date).toBe('2027-10-23');
  });

  it('nieaktualna migawka jest odrzucona i nic się nie zmienia', async () => {
    const { owner, tripId, pull } = await ownTrip('chatka');
    const before = await pull();
    const shift = shiftTripDates(stateFromPayload(before).doc, '2027-10-23');
    expect((await owner.client.from('tasks').update({ title: 'Zmiana z boku' }).eq('trip_id', tripId)).error).toBeNull();

    await expect(rescheduleTrip(owner.client, tripId, { version: before.version, shift, ids: refIndex(before.tables) })).rejects.toMatchObject({ code: 'EP001' });

    expect(stateFromPayload(await pull()).doc.trip.startDate).toBe('2026-10-24');
  });
});
