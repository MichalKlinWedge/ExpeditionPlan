import { addEatOutChoices, type Eatery, eatOutGroup, mealEateries, removeEatOutChoice, type TripDocument } from '@expeditionplan/core';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { COLLECTIONS, refIndex, stateFromPayload } from '../document.ts';
import { importTrip } from '../import.ts';
import { saveElements } from '../plan-save.ts';
import { uuidv7 } from '../uuid.ts';
import { createDevice, createTestUser, loadFixture } from './helpers/harness.ts';

/** Knajpy „gdzie jemy” przypięte i odpięte na prawdziwej bazie: po każdym zapisie pobrany dokument = dokument z pamięci. */

const env = inject('supabase');
const devices: Awaited<ReturnType<typeof createDevice>>[] = [];

afterAll(async () => {
  for (const each of devices) await each.client.removeAllChannels();
});

function normalize(doc: TripDocument) {
  const out: Record<string, unknown> = { ...doc };
  for (const collection of COLLECTIONS) out[collection] = [...(doc[collection] as { ref?: string }[])].sort((a, b) => (a.ref ?? '').localeCompare(b.ref ?? ''));
  return out;
}

const eatery = (name: string, dLat: number): Eatery => ({ name, lat: 31.626 + dLat, lng: -7.988, kind: 'restaurant' });

describe('Web — odpinanie knajpy od posiłku', () => {
  it('kopia, własna knajpa posiłku i rozwiązanie grupy zapisują się bez rozjazdu', async () => {
    const owner = await createDevice(env, await createTestUser(env, 'web'));
    devices.push(owner);
    const { tripId } = await importTrip(owner.client, loadFixture('maroko'));
    const pull = async () => {
      const { data, error } = await owner.client.rpc('pull_changes', { p_trip: tripId, p_since: 0 });
      if (error) throw error;
      return { doc: stateFromPayload(data).doc, ids: refIndex(data.tables) };
    };

    let { doc, ids } = await pull();
    const added = addEatOutChoices(doc, 'd2-lunch', [{ eatery: eatery('A', 0) }, { eatery: eatery('B', 0.01) }, { eatery: eatery('C', 0.02) }], () => `id-${uuidv7()}`)!;
    await saveElements(owner.client, tripId, added.doc, added.writes, ids);
    ({ doc, ids } = await pull());
    expect(normalize(doc)).toEqual(normalize(added.doc));
    const refs = Object.fromEntries(mealEateries(doc, 'd2-lunch').map((each) => [each.name, each.placeRef]));

    for (const [name, left] of [
      ['B', ['A', 'C']],
      ['A', ['C']],
    ] as const) {
      const edit = removeEatOutChoice(doc, 'd2-lunch', refs[name]!)!;
      await saveElements(owner.client, tripId, edit.doc, edit.writes, ids);
      ({ doc, ids } = await pull());
      expect(normalize(doc)).toEqual(normalize(edit.doc));
      expect(mealEateries(doc, 'd2-lunch').map((each) => each.name)).toEqual(left);
    }
    expect(eatOutGroup(doc, 'd2-lunch')).toBeUndefined();

    const last = removeEatOutChoice(doc, 'd2-lunch', refs.C!)!;
    await saveElements(owner.client, tripId, last.doc, last.writes, ids);
    ({ doc } = await pull());
    expect(doc.items.find((each) => each.ref === 'd2-lunch')!.placeRef).toBeUndefined();
  });
});
