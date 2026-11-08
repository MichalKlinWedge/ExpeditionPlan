import { afterAll, describe, expect, inject, it } from 'vitest';

import { saveExpense, setCarrying, setPacked, setVote } from '../outbox.ts';
import { cachedTrip, refreshTrip, setTaskDone } from '../trip-cache.ts';
import { uuidv7 } from '../uuid.ts';
import { createDevice, createTestUser, loadFixture, seedTrip } from './helpers/harness.ts';

/**
 * Portfel, pakowanie i zadania z telefonu na prawdziwej bazie: zapisy z outboxa przechodzą przez RLS,
 * a widz odhacza tylko rzeczy i zadania przypisanego do siebie uczestnika.
 */

const env = inject('supabase');
const devices: Awaited<ReturnType<typeof createDevice>>[] = [];

async function device(label: string) {
  const user = await createTestUser(env, label);
  const created = await createDevice(env, user);
  devices.push(created);
  return { ...created, user };
}

afterAll(async () => {
  for (const each of devices) await each.client.removeAllChannels();
});

describe('portfel i pakowanie z telefonu', () => {
  it('wydatek zapisany offline trafia do bazy po powrocie sieci', async () => {
    const owner = await device('wallet');
    const { tripId } = await seedTrip(owner.client, loadFixture('maroko'));
    await refreshTrip(owner.db, owner.remote, tripId);

    owner.setOffline(true);
    saveExpense(owner.db, { tripId, amountMinor: 12_000, currency: 'MAD', category: 'food', note: 'tajine' });
    await expect(refreshTrip(owner.db, owner.remote, tripId)).rejects.toThrow();
    expect(cachedTrip(owner.db, tripId)!.live.expenses).toHaveLength(1);

    owner.setOffline(false);
    const synced = await refreshTrip(owner.db, owner.remote, tripId);
    expect(synced.pending).toBe(0);
    const { data } = await owner.client.from('expenses').select('amount_minor, note').eq('trip_id', tripId);
    expect(data).toEqual([{ amount_minor: 12_000, note: 'tajine' }]);
  });

  it('widz odhacza swoje rzeczy, cudzych nie (RLS), a organizator widzi odhaczenie', async () => {
    const owner = await device('packing-owner');
    const viewer = await device('packing-viewer');
    const { tripId, rows } = await seedTrip(owner.client, loadFixture('dinara'));
    const [mine, other] = rows.travelers!;
    await owner.client.from('travelers').update({ user_id: viewer.user.id }).eq('id', mine!.id);
    const itemId = uuidv7();
    expect((await owner.client.from('packing_items').insert({ id: itemId, trip_id: tripId, title: 'Czołówka', category: 'sprzęt', scope: 'personal' })).error).toBeNull();
    const invite = await owner.client.rpc('create_invite', { p_trip: tripId, p_role: 'viewer' });
    await viewer.client.rpc('accept_invite', { p_token: invite.data });

    await refreshTrip(viewer.db, viewer.remote, tripId);
    setPacked(viewer.db, tripId, itemId, mine!.id, true);
    expect((await refreshTrip(viewer.db, viewer.remote, tripId)).pending).toBe(0);

    const ownerView = await refreshTrip(owner.db, owner.remote, tripId);
    expect(ownerView.live.packingChecks).toEqual([expect.objectContaining({ packing_item_id: itemId, traveler_id: mine!.id, packed: true })]);
    expect(ownerView.state.doc.packing.map((item) => item.title)).toContain('Czołówka');

    // Cudza rzecz: RLS odrzuca, zapis znika z telefonu, a kolejka się nie blokuje.
    const otherCheck = setPacked(viewer.db, tripId, itemId, other!.id, true);
    const after = await refreshTrip(viewer.db, viewer.remote, tripId);
    expect(after.rejected.map((each) => each.id)).toEqual([otherCheck]);
    expect(after.pending).toBe(0);
    expect(after.live.packingChecks.map((row) => row.traveler_id)).toEqual([mine!.id]);
  });

  it('sprzęt: widz bierze rzecz wspólną offline za siebie, cudzej osoby nie przypisze, organizator widzi podział', async () => {
    const owner = await device('gear-owner');
    const viewer = await device('gear-viewer');
    const { tripId, rows } = await seedTrip(owner.client, loadFixture('dinara'));
    const [mine, other] = rows.travelers!;
    await owner.client.from('travelers').update({ user_id: viewer.user.id }).eq('id', mine!.id);
    const itemId = uuidv7();
    expect((await owner.client.from('packing_items').insert({ id: itemId, trip_id: tripId, title: 'Namiot', category: 'biwak', scope: 'shared', quantity: 3, weight_g: 2500 })).error).toBeNull();
    const invite = await owner.client.rpc('create_invite', { p_trip: tripId, p_role: 'viewer' });
    await viewer.client.rpc('accept_invite', { p_token: invite.data });

    await refreshTrip(viewer.db, viewer.remote, tripId);
    setCarrying(viewer.db, tripId, itemId, mine!.id, 2);
    const rejected = setCarrying(viewer.db, tripId, itemId, other!.id, 1);
    const after = await refreshTrip(viewer.db, viewer.remote, tripId);
    expect(after.rejected.map((each) => each.id)).toEqual([rejected]);
    expect(after.live.packingCarriers.map((row) => row.traveler_id)).toEqual([mine!.id]);

    const ownerView = await refreshTrip(owner.db, owner.remote, tripId);
    expect(ownerView.live.packingCarriers).toEqual([expect.objectContaining({ packing_item_id: itemId, traveler_id: mine!.id, quantity: 2 })]);
    expect(ownerView.state.doc.packing.find((item) => item.title === 'Namiot')).toMatchObject({ quantity: 3, weightG: 2500 });

    // Rezygnacja to ten sam wiersz z zerem: rzecz wraca do ustalenia.
    setCarrying(viewer.db, tripId, itemId, mine!.id, 0);
    await refreshTrip(viewer.db, viewer.remote, tripId);
    expect((await refreshTrip(owner.db, owner.remote, tripId)).live.packingCarriers).toEqual([expect.objectContaining({ traveler_id: mine!.id, quantity: 0 })]);
  });

  it('głosowanie: widz głosuje offline za siebie, za innych nie (RLS), organizator widzi głos, wycofanie go zdejmuje', async () => {
    const owner = await device('vote-owner');
    const viewer = await device('vote-viewer');
    const { tripId, rows } = await seedTrip(owner.client, loadFixture('barcelona'));
    const [mine, other] = rows.travelers!;
    await owner.client.from('travelers').update({ user_id: viewer.user.id }).eq('id', mine!.id);
    const group = rows.variant_groups!.find((row) => row.ref === 'vg-niedziela-rano')!;
    const variant = rows.variants!.find((row) => row.ref === 'v-opcja-b')!;
    const invite = await owner.client.rpc('create_invite', { p_trip: tripId, p_role: 'viewer' });
    await viewer.client.rpc('accept_invite', { p_token: invite.data });

    await refreshTrip(viewer.db, viewer.remote, tripId);
    viewer.setOffline(true);
    setVote(viewer.db, tripId, mine!.id, { groupId: group.id, variantId: variant.id });
    setVote(viewer.db, tripId, mine!.id, { day: '2027-01-15', answer: 'maybe' });
    expect(cachedTrip(viewer.db, tripId)!.live.votes).toHaveLength(2);
    viewer.setOffline(false);
    const rejected = setVote(viewer.db, tripId, other!.id, { groupId: group.id, variantId: null });
    const after = await refreshTrip(viewer.db, viewer.remote, tripId);
    expect(after.rejected.map((each) => each.id)).toEqual([rejected]);

    const ownerView = await refreshTrip(owner.db, owner.remote, tripId);
    expect(ownerView.live.votes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ traveler_id: mine!.id, variant_group_id: group.id, variant_id: variant.id }),
        expect.objectContaining({ traveler_id: mine!.id, day: '2027-01-15', answer: 'maybe' }),
      ]),
    );

    setVote(viewer.db, tripId, mine!.id, { groupId: group.id, variantId: variant.id }, true);
    await refreshTrip(viewer.db, viewer.remote, tripId);
    expect((await refreshTrip(owner.db, owner.remote, tripId)).live.votes.map((row) => row.day)).toEqual(['2027-01-15']);
  });

  it('zadania: widz odhacza przypisane do siebie offline, cudzego nie (RLS), organizator widzi status', async () => {
    const owner = await device('tasks-owner');
    const viewer = await device('tasks-viewer');
    const { tripId, rows } = await seedTrip(owner.client, loadFixture('dinara'));
    const [mine] = rows.travelers!;
    await owner.client.from('travelers').update({ user_id: viewer.user.id }).eq('id', mine!.id);
    const own = uuidv7();
    const foreign = uuidv7();
    const inserted = await owner.client.from('tasks').insert([
      { id: own, trip_id: tripId, ref: 't-moje', kind: 'todo', title: 'Kup mapę', status: 'open', assignee_ids: [mine!.id] },
      { id: foreign, trip_id: tripId, ref: 't-cudze', kind: 'todo', title: 'Zarezerwuj schronisko', status: 'open', assignee_ids: [] },
    ]);
    expect(inserted.error).toBeNull();
    const invite = await owner.client.rpc('create_invite', { p_trip: tripId, p_role: 'viewer' });
    await viewer.client.rpc('accept_invite', { p_token: invite.data });

    const first = await refreshTrip(viewer.db, viewer.remote, tripId);
    viewer.setOffline(true);
    setTaskDone(viewer.db, tripId, first, 't-moje', true);
    expect(cachedTrip(viewer.db, tripId)!.state.doc.tasks.find((task) => task.ref === 't-moje')?.status).toBe('done');
    viewer.setOffline(false);
    expect((await refreshTrip(viewer.db, viewer.remote, tripId)).pending).toBe(0);
    const ownerView = await refreshTrip(owner.db, owner.remote, tripId);
    expect(ownerView.state.doc.tasks.find((task) => task.ref === 't-moje')?.status).toBe('done');

    // Zadanie bez przypisania: RLS odrzuca, status wraca do „open”, kolejka się nie blokuje.
    setTaskDone(viewer.db, tripId, cachedTrip(viewer.db, tripId)!, 't-cudze', true);
    const after = await refreshTrip(viewer.db, viewer.remote, tripId);
    expect(after.rejected.map((each) => each.id)).toEqual([foreign]);
    expect(after.pending).toBe(0);
    expect(after.state.doc.tasks.find((task) => task.ref === 't-cudze')?.status).toBe('open');
    expect((await owner.client.from('tasks').select('status').eq('id', foreign).single()).data?.status).toBe('open');
  });
});
