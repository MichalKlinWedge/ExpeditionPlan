import { GUIDE_LICENSE, type GuideContent, type GuideRow, guideFor, guideText } from '@expeditionplan/core';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { refIndex } from '../document.ts';
import { importTrip } from '../import.ts';
import { syncTrip } from '../pull.ts';
import { cachedTrip } from '../trip-cache.ts';
import { stableUuid } from '../uuid.ts';
import { createDevice, createTestUser, loadFixture } from './helpers/harness.ts';

/**
 * Przewodnik po punkcie (`audio_guides.content`) na prawdziwej bazie: zapis organizatora jak w akcji
 * webu (`describeItem`), widz dostaje go na telefon razem z planem i czyta offline (`guideFor`),
 * ale sam opisu nie zapisze (RLS tabel planu).
 */

const env = inject('supabase');
const devices: Awaited<ReturnType<typeof createDevice>>[] = [];

afterAll(async () => {
  for (const each of devices) await each.client.removeAllChannels();
});

const content: GuideContent = {
  summary: 'Twierdza nad zatoką.',
  facts: ['Mury mają kilkaset lat.', 'Z wieży widać wyspy.'],
  history: 'Zbudowana dla obrony portu.',
  tips: [],
  images: [
    {
      url: 'https://upload.wikimedia.org/a.jpg',
      thumbUrl: 'https://upload.wikimedia.org/a-960.jpg',
      title: 'Twierdza',
      author: 'Jan Kowalski',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
    },
  ],
  article: { title: 'Twierdza', url: 'https://pl.wikipedia.org/wiki/Twierdza', lang: 'pl', site: 'wikipedia' },
};

describe('przewodnik po punkcie', () => {
  it('organizator zapisuje, widz czyta offline, ale nie zapisze', async () => {
    const owner = await createDevice(env, await createTestUser(env, 'guide-owner'));
    const viewer = await createDevice(env, await createTestUser(env, 'guide-viewer', { creator: false }));
    devices.push(owner, viewer);
    const doc = loadFixture('dinara');
    const { tripId } = await importTrip(owner.client, doc);
    const invite = await owner.client.rpc('create_invite', { p_trip: tripId, p_role: 'viewer' });
    expect((await viewer.client.rpc('accept_invite', { p_token: invite.data })).error).toBeNull();

    const { data: pulled } = await owner.client.rpc('pull_changes', { p_trip: tripId, p_since: 0 });
    const ids = refIndex((pulled as { tables: Parameters<typeof refIndex>[0] }).tables);
    const item = doc.items.find((each) => each.placeRef !== undefined && doc.places.find((place) => place.ref === each.placeRef)?.lat !== undefined)!;
    const placeId = ids[item.placeRef!]!;
    const row = {
      id: stableUuid('guide', tripId, placeId, 'adult', 'pl'),
      trip_id: tripId,
      item_id: ids[item.ref] ?? null,
      place_id: placeId,
      lang: 'pl',
      audience: 'adult',
      title: 'Twierdza',
      text: guideText(content),
      content,
      sources: [{ title: 'Wikipedia: Twierdza', url: content.article.url }],
      license: GUIDE_LICENSE,
      status: 'ready',
    };
    expect((await owner.client.from('audio_guides').upsert(row)).error).toBeNull();
    // Ponowny zapis (Odśwież opis) — ten sam wiersz, nie drugi.
    expect((await owner.client.from('audio_guides').upsert({ ...row, title: 'Twierdza (nowy opis)' })).error).toBeNull();

    await syncTrip(viewer.db, viewer.remote, tripId);
    const trip = cachedTrip(viewer.db, tripId)!;
    expect(trip.live.guides).toHaveLength(1);
    const guide = guideFor(trip.live.guides as unknown as GuideRow[], trip.ids[item.ref], trip.ids[item.placeRef!]);
    expect(guide).toMatchObject({ title: 'Twierdza (nowy opis)', summary: 'Twierdza nad zatoką.', images: [{ license: 'CC BY-SA 4.0' }] });

    const denied = await viewer.client.from('audio_guides').upsert({ ...row, id: stableUuid('guide', tripId, 'widz'), title: 'od widza' });
    expect(denied.error?.code).toBe('42501');
  });
});
