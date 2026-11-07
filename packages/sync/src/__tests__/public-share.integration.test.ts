import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import { stateFromPayload } from '../document.ts';
import { importTrip } from '../import.ts';
import { createDevice, createTestUser, loadFixture } from './helpers/harness.ts';

/**
 * Publiczny link „tylko do podglądu” (`public_trip`): bez logowania, dokument przechodzi walidację
 * (te same `stateFromPayload` co telefon), a dane prywatne nie wychodzą z bazy nawet przez RPC.
 */

const env = inject('supabase');
const devices: Awaited<ReturnType<typeof createDevice>>[] = [];
const anon = () => createClient(env.url, env.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });

afterAll(async () => {
  for (const each of devices) await each.client.removeAllChannels();
});

describe('publiczny link do planu', () => {
  for (const slug of ['maroko', 'dinara', 'chatka', 'barcelona', 'gruzja']) {
    it(`${slug}: plan bez logowania, bez danych prywatnych`, async () => {
      const owner = await createDevice(env, await createTestUser(env, 'share'));
      devices.push(owner);
      const doc = loadFixture(slug);
      const { tripId } = await importTrip(owner.client, doc);
      const { data: token, error } = await owner.client.rpc('create_public_share', { p_trip: tripId, p_hide: { costs: true, names: true, lodgingAddress: true } });
      expect(error).toBeNull();

      const { data: payload, error: readError } = await anon().rpc('public_trip', { p_token: token });
      expect(readError).toBeNull();
      const shared = stateFromPayload(payload).doc;
      expect(shared.days).toHaveLength(doc.days.length);
      expect(shared.items).toHaveLength(doc.items.length);
      expect(shared.contacts).toEqual([]);
      expect(shared.budgetLines).toEqual([]);
      expect(shared.tasks).toEqual([]);
      expect(shared.bookings.every((booking) => booking.confirmationCode === undefined && booking.price === undefined && booking.paid === undefined)).toBe(true);
      expect(shared.travelers.every((traveler, i) => traveler.name === `Osoba ${i + 1}` && traveler.notes === undefined)).toBe(true);
      expect(JSON.stringify((payload as { tables: { travelers: unknown } }).tables.travelers)).not.toMatch(/"(tentative|from_date|to_date)"/);
      expect(JSON.stringify((payload as { tables: { travelers: unknown } }).tables.travelers)).not.toMatch(/"(start_place_id|end_place_id)"/);
      // Imiona znikają z listy osób; w opisach punktów zostaje tekst taki, jak go napisano.
      const raw = JSON.stringify(payload);
      for (const secret of [...doc.contacts.filter((contact) => contact.role !== 'emergency').flatMap((contact) => [contact.phone, contact.email]), ...doc.bookings.map((booking) => booking.confirmationCode), ...doc.travelers.map((traveler) => traveler.notes)]) {
        if (secret) expect(raw).not.toContain(secret);
      }
      expect(raw).not.toContain('owner_id');
      expect(raw).not.toContain('created_by');

      await owner.client.rpc('disable_public_share', { p_trip: tripId });
      expect((await anon().rpc('public_trip', { p_token: token })).data).toBeNull();
    });
  }

  it('opis miejsca jest w linku, ale bez wskazówki organizatora dla AI', async () => {
    const owner = await createDevice(env, await createTestUser(env, 'share'));
    devices.push(owner);
    const { tripId } = await importTrip(owner.client, loadFixture('barcelona'));
    const { data: place } = await owner.client.from('places').select('id').eq('trip_id', tripId).limit(1).single();
    const content = { summary: 'Opis miejsca', facts: [], tips: [], images: [], article: { title: 'A', url: 'https://pl.wikipedia.org/wiki/A', lang: 'pl', site: 'wikipedia' }, hint: 'tajna wskazówka' };
    const { error: guideError } = await owner.client.from('audio_guides').insert({ id: crypto.randomUUID(), trip_id: tripId, place_id: place!.id, title: 'A', text: 'tekst do czytania', content });
    expect(guideError).toBeNull();
    const { data: token } = await owner.client.rpc('create_public_share', { p_trip: tripId, p_hide: {} });

    const { data: payload } = await anon().rpc('public_trip', { p_token: token });
    const rows = (payload as { tables: { audio_guides: { place_id: string; content: { summary: string } }[] } }).tables.audio_guides;
    expect(rows.map((row) => [row.place_id, row.content.summary])).toEqual([[place!.id, 'Opis miejsca']]);
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain('tajna wskazówka');
    expect(raw).not.toContain('tekst do czytania');
    expect(stateFromPayload(payload).doc.days.length).toBeGreaterThan(0);
  });

  it('link tworzy tylko właściciel; zły token nic nie zwraca', async () => {
    const owner = await createDevice(env, await createTestUser(env, 'share-owner'));
    const viewer = await createDevice(env, await createTestUser(env, 'share-viewer', { creator: false }));
    devices.push(owner, viewer);
    const { tripId } = await importTrip(owner.client, loadFixture('dinara'));
    const invite = await owner.client.rpc('create_invite', { p_trip: tripId, p_role: 'viewer' });
    await viewer.client.rpc('accept_invite', { p_token: invite.data });
    expect((await viewer.client.rpc('create_public_share', { p_trip: tripId })).error?.code).toBe('42501');
    expect((await anon().rpc('public_trip', { p_token: 'zly-token' })).data).toBeNull();
  });
});
