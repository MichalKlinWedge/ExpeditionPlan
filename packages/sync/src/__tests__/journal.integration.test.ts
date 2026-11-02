import { afterAll, describe, expect, inject, it } from 'vitest';

import { importTrip } from '../import.ts';
import { flushOutbox, removeJournalEntry, saveJournalEntry } from '../outbox.ts';
import { syncTrip } from '../pull.ts';
import { cachedTrip } from '../trip-cache.ts';
import { uuidv7 } from '../uuid.ts';
import { createDevice, createTestUser, loadFixture } from './helpers/harness.ts';

/**
 * Dziennik wyjazdu na prawdziwej bazie: widz zapisuje wpis offline (outbox), wgrywa zdjęcie do
 * bucketu `journal`, a organizator widzi wpis po synchronizacji i otwiera zdjęcie podpisanym URL-em.
 */

const env = inject('supabase');
const devices: Awaited<ReturnType<typeof createDevice>>[] = [];

afterAll(async () => {
  for (const each of devices) await each.client.removeAllChannels();
});

describe('dziennik wyjazdu', () => {
  it('widz: wpis offline ze zdjęciem; organizator widzi go po synchronizacji', async () => {
    const owner = await createDevice(env, await createTestUser(env, 'journal-owner'));
    const viewer = await createDevice(env, await createTestUser(env, 'journal-viewer', { creator: false }));
    devices.push(owner, viewer);
    const { tripId } = await importTrip(owner.client, loadFixture('dinara'));
    const invite = await owner.client.rpc('create_invite', { p_trip: tripId, p_role: 'viewer' });
    expect((await viewer.client.rpc('accept_invite', { p_token: invite.data })).error).toBeNull();
    await syncTrip(viewer.db, viewer.remote, tripId);
    const dayId = (viewer.db.all<{ id: string }>("select id from rows where tbl = 'days' and trip_id = ? limit 1", [tripId])[0]!).id;

    viewer.setOffline(true);
    const id = uuidv7();
    const photoPath = `${tripId}/${id}/zachod.jpg`;
    saveJournalEntry(viewer.db, { id, tripId, dayId, body: 'Zachód słońca nad Dinarą', photoPath });
    expect(cachedTrip(viewer.db, tripId)!.live.journal.map((row) => row.id)).toEqual([id]);
    expect((await flushOutbox(viewer.db, viewer.remote)).remaining).toBe(1);
    viewer.setOffline(false);
    expect((await flushOutbox(viewer.db, viewer.remote)).error).toBeUndefined();
    const upload = await viewer.client.storage.from('journal').upload(photoPath, new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));
    expect(upload.error).toBeNull();

    await syncTrip(owner.db, owner.remote, tripId);
    const seen = cachedTrip(owner.db, tripId)!.live.journal;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id, body: 'Zachód słońca nad Dinarą', day_id: dayId, photo_path: photoPath });
    const signed = await owner.client.storage.from('journal').createSignedUrl(photoPath, 60);
    expect(signed.error).toBeNull();

    // Usunięcie przez autora — miękkie, znika z dziennika po synchronizacji.
    removeJournalEntry(viewer.db, { id, tripId, dayId, body: 'Zachód słońca nad Dinarą', photoPath });
    expect((await flushOutbox(viewer.db, viewer.remote)).error).toBeUndefined();
    await syncTrip(owner.db, owner.remote, tripId);
    expect(cachedTrip(owner.db, tripId)!.live.journal).toEqual([]);
  });
});
