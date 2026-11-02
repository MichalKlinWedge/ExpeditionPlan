import { addItem, addItemAtPin, copyFromDraft, dayItems, moveToDay, movePlace, moveWithinDay, type PlanEdit, removeItem, replaceDayFromDraft, TripDocument, updateItem } from '@expeditionplan/core';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { refIndex, stateFromPayload } from '../document.ts';
import { importTrip } from '../import.ts';
import { saveMergeEdit, savePlanEdit } from '../plan-save.ts';
import { uuidv7 } from '../uuid.ts';
import { createDevice, createTestUser, loadFixture } from './helpers/harness.ts';

/**
 * Edytor planu (MVP-3) na prawdziwej bazie: każda zmiana z `plan-edits` zapisana przez
 * `savePlanEdit` daje po ponownym pobraniu dokładnie ten dokument, który edytor ma w pamięci.
 */

const env = inject('supabase');
const devices: Awaited<ReturnType<typeof createDevice>>[] = [];

async function device() {
  const created = await createDevice(env, await createTestUser(env, 'mvp3'));
  devices.push(created);
  return created;
}

afterAll(async () => {
  for (const each of devices) await each.client.removeAllChannels();
});

const byRef = <T extends { ref: string }>(list: T[]) => [...list].sort((a, b) => a.ref.localeCompare(b.ref));
const normalize = (doc: TripDocument) => ({ ...doc, items: byRef(doc.items), places: byRef(doc.places) });

describe('MVP-3 — edycja planu zapisana w bazie', () => {
  it('przesunięcia, edycja, nowy punkt, pula i usunięcie wracają z bazy bez rozjazdu', async () => {
    const owner = await device();
    const { tripId } = await importTrip(owner.client, loadFixture('maroko'));
    const pull = async () => {
      const { data, error } = await owner.client.rpc('pull_changes', { p_trip: tripId, p_since: 0 });
      if (error) throw error;
      return { state: stateFromPayload(data), ids: refIndex(data.tables) };
    };

    let { state, ids } = await pull();
    let doc = state.doc;
    const step = async (edit: PlanEdit | null) => {
      expect(edit).not.toBeNull();
      ids = await savePlanEdit(owner.client, tripId, edit!, ids);
      doc = edit!.doc;
    };

    const d2 = dayItems(doc, 'd2').map((item) => item.ref);
    await step(moveWithinDay(doc, d2[2]!, -1));
    await step(updateItem(doc, d2[1]!, { title: 'Zmieniona nazwa', durationMin: 75, time: undefined }));
    await step(addItem(doc, 'd2', uuidv7(), { title: 'Herbata miętowa', kind: 'meal', durationMin: 20 }));
    await step(moveToDay(doc, d2[3]!, null));
    await step(moveToDay(doc, d2[3]!, 'd3'));
    await step(removeItem(doc, 'd1-suki'));
    const pin = addItemAtPin(doc, 'd2', { itemId: uuidv7(), placeId: uuidv7() }, { lat: 31.6258, lng: -7.9892 }, { title: 'Ogród z pinezki', kind: 'visit', durationMin: 30 });
    await step(pin);
    await step(movePlace(doc, pin.places![0]!.place.ref, { lat: 31.63, lng: -7.99 }));

    const back = (await pull()).state.doc;
    expect(normalize(back)).toEqual(normalize(doc));
    expect(back.items.some((item) => item.ref === 'd1-suki')).toBe(false);
    expect(back.items.find((item) => item.title === 'Herbata miętowa')?.dayRef).toBe('d2');
    const garden = back.items.find((item) => item.title === 'Ogród z pinezki')!;
    expect(back.places.find((place) => place.ref === garden.placeRef)).toMatchObject({ provider: 'user', lat: 31.63, lng: -7.99, name: 'Ogród z pinezki' });

    const { data: locked } = await owner.client.from('items').select('user_locked').eq('trip_id', tripId).eq('title', 'Zmieniona nazwa').single();
    expect(locked?.user_locked).toBe(true);
  });

  it('przeniesienie ze szkicu AI (nowe miejsce, nowy dzień, zastąpiony dzień) wraca z bazy bez rozjazdu', async () => {
    const owner = await device();
    const { tripId } = await importTrip(owner.client, loadFixture('maroko'));
    const pull = async () => {
      const { data, error } = await owner.client.rpc('pull_changes', { p_trip: tripId, p_since: 0 });
      if (error) throw error;
      return { state: stateFromPayload(data), ids: refIndex(data.tables), rows: data.tables.items as { ref: string | null; title: string; source: string; user_locked: boolean }[] };
    };
    let { state, ids } = await pull();
    const plan = state.doc;
    const draft = TripDocument.parse({
      ...plan,
      days: [...plan.days, { ref: 'd-extra', date: '2099-01-01', tz: plan.days[0]!.tz }],
      places: [...plan.places, { ref: 'p-nowe', name: 'Miejsce tylko ze szkicu', lat: 31.6, lng: -8 }],
      items: [...plan.items, { ref: 'x-1', dayRef: 'd-extra', sortKey: '0010', kind: 'visit', title: 'Punkt ze szkicu', placeRef: 'p-nowe', durationMin: 45 }],
    });

    const copy = copyFromDraft(plan, draft, ['x-1'], '2099-01-01', uuidv7);
    ids = await saveMergeEdit(owner.client, tripId, copy, ids);
    const replace = replaceDayFromDraft(copy.doc, draft, plan.days.find((day) => day.ref === 'd2')!.date, new Set(), uuidv7);
    ids = await saveMergeEdit(owner.client, tripId, replace, ids);

    const back = await pull();
    expect(normalize(back.state.doc)).toEqual(normalize(replace.doc));
    expect(back.state.doc.places.some((place) => place.name === 'Miejsce tylko ze szkicu')).toBe(true);
    expect(back.rows.find((row) => row.title === 'Punkt ze szkicu')).toMatchObject({ source: 'ai', user_locked: false });
  });

  it('widz nie zapisze zmiany planu', async () => {
    const owner = await device();
    const viewer = await device();
    const { tripId } = await importTrip(owner.client, loadFixture('dinara'));
    const invite = await owner.client.rpc('create_invite', { p_trip: tripId, p_role: 'viewer' });
    await viewer.client.rpc('accept_invite', { p_token: invite.data });
    const { data } = await viewer.client.rpc('pull_changes', { p_trip: tripId, p_since: 0 });
    const doc = stateFromPayload(data).doc;
    const first = doc.items.find((item) => item.dayRef !== undefined)!;
    // RLS odrzuca UPDATE bez błędu (0 wierszy) — sprawdzamy, że w bazie nic się nie zmieniło.
    await savePlanEdit(viewer.client, tripId, updateItem(doc, first.ref, { title: 'Widz był tu' })!, refIndex(data.tables)).catch(() => undefined);
    const after = stateFromPayload((await owner.client.rpc('pull_changes', { p_trip: tripId, p_since: 0 })).data).doc;
    expect(after.items.find((item) => item.ref === first.ref)?.title).toBe(first.title);
    await expect(
      savePlanEdit(viewer.client, tripId, addItem(doc, first.dayRef!, uuidv7(), { title: 'Nie wejdzie', kind: 'free' }), refIndex(data.tables)),
    ).rejects.toThrow('Brak uprawnień');
  });
});
