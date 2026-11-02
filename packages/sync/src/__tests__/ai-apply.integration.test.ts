import { dayItems, type LogisticsCandidates, PlanPatch, type PracticalInfo, TripDocument } from '@expeditionplan/core';
import { applyPatch, mergeLogistics, mergePractical, patchDiff } from '@expeditionplan/planner';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { COLLECTIONS, refIndex, stateFromPayload } from '../document.ts';
import { importTrip } from '../import.ts';
import { type ElementWrite, saveElements, saveMergeEdit } from '../plan-save.ts';
import { uuidv7 } from '../uuid.ts';
import { createDevice, createTestUser, loadFixture } from './helpers/harness.ts';

/**
 * Zapisy z webu po MVP-3 na prawdziwej bazie: akceptacja szkiców AI (etap 5 — informacje
 * praktyczne, etap 4 — kandydaci i wybór, etap 3 — łatka z czatu) i edytor logistyki (budżet,
 * zadania, rezerwacje). Każdy zapis po ponownym pobraniu daje dokładnie dokument z pamięci.
 * Plus dostęp: widz nic nie zapisze, konto bez zaproszenia nie założy wyjazdu.
 */

const env = inject('supabase');
const devices: Awaited<ReturnType<typeof createDevice>>[] = [];

async function device(options?: { creator?: boolean }) {
  const created = await createDevice(env, await createTestUser(env, 'web', options));
  devices.push(created);
  return created;
}

afterAll(async () => {
  for (const each of devices) await each.client.removeAllChannels();
});

/** Kolejność wierszy w kolekcjach to `sort_key`, a nie kolejność w pamięci — porównujemy po kluczach. */
function normalize(doc: TripDocument) {
  const out: Record<string, unknown> = { ...doc };
  for (const collection of COLLECTIONS) out[collection] = [...(doc[collection] as { ref?: string }[])].sort((a, b) => (a.ref ?? '').localeCompare(b.ref ?? ''));
  return out;
}

async function ownTrip(slug = 'maroko') {
  const owner = await device();
  const { tripId } = await importTrip(owner.client, loadFixture(slug));
  const pull = async () => {
    const { data, error } = await owner.client.rpc('pull_changes', { p_trip: tripId, p_since: 0 });
    if (error) throw error;
    return { doc: stateFromPayload(data).doc, ids: refIndex(data.tables), tables: data.tables as Record<string, { ref: string | null; title?: string; user_locked?: boolean; deleted_at: string | null }[]> };
  };
  return { owner, tripId, pull };
}

const inserts = (created: { collection: ElementWrite['collection']; element: unknown }[]): ElementWrite[] =>
  created.map((entry) => ({ collection: entry.collection, element: entry.element as ElementWrite['element'], op: 'insert' }));

describe('Web — szkice AI i edytor logistyki zapisane w bazie', () => {
  it('etap 5: wybrane informacje praktyczne wracają z bazy bez rozjazdu', async () => {
    const { owner, tripId, pull } = await ownTrip();
    const before = await pull();
    const info: PracticalInfo = {
      notes: [
        { topic: 'time', kind: 'warning', title: 'Strefa czasowa (test)', body: 'UTC+0 przez cały wyjazd.', sourceIndexes: [0] },
        { topic: 'money', kind: 'tip', title: 'Gotówka (test)', body: 'Dirhamy z bankomatu.', sourceIndexes: [] },
      ],
      contacts: [{ name: 'Numer alarmowy (test)', role: 'emergency', phone: '112' }],
      packing: [{ category: 'Apteczka', title: 'Plastry (test)', scope: 'shared', quantity: 2 }],
      tasks: [{ kind: 'todo', title: 'Sprawdź paszporty (test)', priority: 'high', daysBefore: 14 }],
      sources: [{ title: 'Serwis rządowy (test)', url: 'https://www.gov.pl/web/dyplomacja/maroko' }],
    };
    const { doc, created } = mergePractical(before.doc, info, { notes: [0, 1], contacts: [0], packing: [0], tasks: [0], sources: [0] }, uuidv7, '2026-11-02');
    expect(created).toHaveLength(6);
    const checked = TripDocument.parse(doc);
    await saveElements(owner.client, tripId, checked, inserts(created), before.ids);

    const back = (await pull()).doc;
    // Notatki mają `ref` opcjonalny: wiersz bez `ref` wraca bez klucza `id-…` (OPTIONAL_REF).
    const expected = { ...checked, notes: checked.notes.map(({ ref, ...note }) => (ref?.startsWith('id-') ? note : { ref, ...note })) };
    expect(normalize(back)).toEqual(normalize(expected));
    expect(back.contacts.find((contact) => contact.role === 'emergency' && contact.phone === '112')).toBeDefined();
  });

  it('etap 4: kandydaci (grupa, warianty, rezerwacje) i „Wybieram” wracają z bazy bez rozjazdu', async () => {
    const { owner, tripId, pull } = await ownTrip();
    const before = await pull();
    const candidate = (label: string, recommended: boolean) => ({
      label,
      priceMinMinor: 40000,
      priceMaxMinor: 60000,
      currency: 'MAD',
      priceBasis: 'per_night' as const,
      refundable: true,
      conditions: ['parking'],
      includes: ['śniadanie'],
      pros: ['blisko'],
      cons: [],
      values: ['400–600 MAD', 'tak'],
      recommended,
      searchQuery: `${label} Essaouira`,
    });
    const info: LogisticsCandidates = {
      groups: [{ kind: 'lodging', title: 'Nocleg w Essaouirze (test)', area: 'Essaouira', start: '2026-12-28', end: '2026-12-30', columns: ['Cena za noc', 'Odwołanie'], candidates: [candidate('Riad w medynie', true), candidate('Apartament przy plaży', false)] }],
      advice: [],
    };
    const merged = mergeLogistics(before.doc, info, [0], uuidv7);
    expect(merged.created.map((entry) => entry.collection)).toEqual(['variantGroups', 'variants', 'variants', 'bookings', 'bookings']);
    const checked = TripDocument.parse(merged.doc);
    let ids = await saveElements(owner.client, tripId, checked, inserts(merged.created), before.ids);
    expect(normalize((await pull()).doc)).toEqual(normalize(checked));

    // „Wybieram” drugi wariant: grupa dostaje chosenRef, jego rezerwacja status „do rezerwacji”.
    const group = checked.variantGroups.find((each) => each.title === 'Nocleg w Essaouirze (test)')!;
    const chosen = checked.variants.filter((each) => each.groupRef === group.ref)[1]!;
    const nextGroup = { ...group, chosenRef: chosen.ref };
    const nextBookings = checked.bookings.filter((each) => each.variantGroupRef === group.ref).map((each) => ({ ...each, status: each.variantRef === chosen.ref ? ('to_book' as const) : each.status }));
    const afterChoice = TripDocument.parse({
      ...checked,
      variantGroups: checked.variantGroups.map((each) => (each.ref === group.ref ? nextGroup : each)),
      bookings: checked.bookings.map((each) => nextBookings.find((other) => other.ref === each.ref) ?? each),
    });
    ids = await saveElements(
      owner.client,
      tripId,
      afterChoice,
      [{ collection: 'variantGroups', element: nextGroup, op: 'update' }, ...nextBookings.map((each) => ({ collection: 'bookings' as const, element: each as ElementWrite['element'], op: 'update' as const }))],
      ids,
    );
    const back = (await pull()).doc;
    expect(normalize(back)).toEqual(normalize(afterChoice));
    expect(back.bookings.find((each) => each.variantRef === chosen.ref)?.status).toBe('to_book');
  });

  it('edytor logistyki: nowa pozycja budżetu, zmiana zadania i rezerwacji, usunięcie', async () => {
    const { owner, tripId, pull } = await ownTrip();
    const { doc, ids } = await pull();
    const line = { ref: `id-${uuidv7()}`, category: 'food' as const, title: 'Kolacje (test)', status: 'estimate' as const, lowMinor: 30000, highMinor: 45000, currency: 'PLN', perPerson: false };
    const task = { ...doc.tasks[0]!, status: 'done' as const };
    const booking = { ...doc.bookings[0]!, status: 'booked' as const, confirmation: 'ABC123' };
    const removed = doc.budgetLines[1]!;
    const next = TripDocument.parse({
      ...doc,
      budgetLines: [...doc.budgetLines.filter((each) => each.ref !== removed.ref), line],
      tasks: doc.tasks.map((each) => (each.ref === task.ref ? task : each)),
      bookings: doc.bookings.map((each) => (each.ref === booking.ref ? booking : each)),
    });
    // Jak w akcjach edytora: jeden element na zapis.
    let known = ids;
    for (const write of [
      { collection: 'budgetLines', element: line, op: 'insert' },
      { collection: 'tasks', element: task, op: 'update' },
      { collection: 'bookings', element: booking, op: 'update' },
      { collection: 'budgetLines', element: removed, op: 'remove' },
    ] as ElementWrite[]) {
      known = await saveElements(owner.client, tripId, next, [write], known);
    }
    expect(normalize((await pull()).doc)).toEqual(normalize(next));
  });

  it('etap 3: łatka z czatu (pula, przeniesienie, nowy punkt z nowym miejscem, zmiana pola, plan B na dzień) — punkt zablokowany nietknięty', async () => {
    const { owner, tripId, pull } = await ownTrip();
    const before = await pull();
    const [d2, d3] = [before.doc.days[1]!.ref, before.doc.days[2]!.ref];
    const day2 = dayItems(before.doc, d2).map((item) => item.ref);
    const lockedRef = day2[0]!;
    const patch = PlanPatch.parse({
      message: 'test',
      ops: [
        { op: 'remove_item', itemRef: day2[1]!, toPool: true },
        { op: 'move_item', itemRef: day2[2]!, toDayRef: d3 },
        { op: 'add_item', dayRef: d2, afterItemRef: lockedRef, item: { title: 'Kawa (test)', kind: 'meal', durationMin: 30, place: 'Kawiarnia testowa', searchName: 'Test Cafe' } },
        { op: 'set_field', itemRef: day2[3]!, field: 'title', value: 'Nowa nazwa (test)' },
        { op: 'set_field', itemRef: lockedRef, field: 'title', value: 'Nie wolno' },
        {
          op: 'add_variant',
          dayRef: d3,
          title: 'Plan na deszcz (test)',
          conditionKind: 'weather',
          mainLabel: 'Słońce',
          label: 'Deszcz',
          replacesItemRefs: [dayItems(before.doc, d3)[0]!.ref],
          items: [{ title: 'Muzeum (test)', kind: 'visit', durationMin: 60 }],
        },
      ],
    });
    const applied = applyPatch(before.doc, patch, new Set([lockedRef]), uuidv7);
    expect(applied.results.map((result) => result.ok)).toEqual([true, true, true, true, false, true]);
    const checked = TripDocument.parse(applied.doc);
    await saveMergeEdit(owner.client, tripId, patchDiff(before.doc, checked), before.ids);

    const back = await pull();
    expect(normalize(back.doc)).toEqual(normalize(checked));
    for (const day of [d2, d3]) expect(dayItems(back.doc, day).map((item) => item.ref)).toEqual(dayItems(checked, day).map((item) => item.ref));
    expect(back.doc.items.find((item) => item.ref === lockedRef)?.title).toBe(before.doc.items.find((item) => item.ref === lockedRef)?.title);
    expect(back.doc.places.some((place) => place.name === 'Kawiarnia testowa')).toBe(true);
    const added = back.tables.items!.find((row) => row.title === 'Kawa (test)');
    expect(added).toMatchObject({ user_locked: false });
    const group = back.doc.variantGroups.find((each) => each.title === 'Plan na deszcz (test)')!;
    expect(back.doc.variants.filter((each) => each.groupRef === group.ref).map((each) => each.label)).toEqual(['Słońce', 'Deszcz']);
  });

  it('widz nie zapisze elementów, a konto bez zaproszenia nie założy wyjazdu', async () => {
    const { owner, tripId, pull } = await ownTrip('dinara');
    const viewer = await device({ creator: false });
    const invite = await owner.client.rpc('create_invite', { p_trip: tripId, p_role: 'viewer' });
    await viewer.client.rpc('accept_invite', { p_token: invite.data });
    const { doc, ids } = await pull();
    const task = { ...doc.tasks[0]!, status: 'done' as const };
    await expect(saveElements(viewer.client, tripId, { ...doc, tasks: doc.tasks.map((each) => (each.ref === task.ref ? task : each)) }, [{ collection: 'tasks', element: task, op: 'update' }], ids)).rejects.toThrow(
      'Brak uprawnień',
    );
    const line = { ref: `id-${uuidv7()}`, category: 'other' as const, title: 'Widz (test)', status: 'estimate' as const, lowMinor: 1, highMinor: 1, currency: 'PLN', perPerson: false };
    await expect(saveElements(viewer.client, tripId, { ...doc, budgetLines: [...doc.budgetLines, line] }, [{ collection: 'budgetLines', element: line, op: 'insert' }], ids)).rejects.toThrow();
    expect((await pull()).doc.tasks.find((each) => each.ref === task.ref)?.status).toBe(doc.tasks[0]!.status);

    // Widz (konto bez flagi trip_creator) nie założy własnego wyjazdu — ani planem, ani pustym.
    await expect(importTrip(viewer.client, loadFixture('dinara'))).rejects.toThrow();
    const { error } = await viewer.client.from('trips').insert({ id: uuidv7(), title: 'Cudzy', start_date: '2026-12-01', end_date: '2026-12-02', primary_tz: 'Europe/Warsaw', base_currency: 'PLN' });
    expect(error?.code).toBe('42501');
  });
});
