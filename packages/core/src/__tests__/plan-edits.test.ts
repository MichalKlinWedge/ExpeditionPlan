import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scheduleDay } from '../engine/schedule.ts';
import { addItem, addItemAtPin, addPoolItem, dayItems, documentProblem, dropItem, ItemInUseError, moveToDay, movePlace, moveWithinDay, placeUses, removeItem, setLegRoute, removeItemClosingGap, renamePlace, replacePlace, setItemPlace, updateItem } from '../plan-edits.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')),
);
const refs = (doc: TripDocument, day: string) => dayItems(doc, day).map((item) => item.ref);

describe('edycja planu (MVP-3)', () => {
  it('w górę i w dół zmienia jeden punkt, a dokument zostaje poprawny', () => {
    const [first, second] = refs(maroko, 'd2');
    const edit = moveWithinDay(maroko, second!, -1)!;
    expect(edit.changed).toHaveLength(1);
    expect(refs(edit.doc, 'd2').slice(0, 2)).toEqual([second, first]);
    expect(documentProblem(edit.doc)).toBeNull();
    expect(moveWithinDay(maroko, first!, -1)).toBeNull();
  });

  it('w dół o jedno miejsce', () => {
    const [first, second, third] = refs(maroko, 'd2');
    const edit = moveWithinDay(maroko, first!, 1)!;
    expect(refs(edit.doc, 'd2').slice(0, 3)).toEqual([second, first, third]);
  });

  it('do puli i z powrotem: status i godzina względna pilnowane', () => {
    const ref = refs(maroko, 'd2')[1]!;
    const pooled = moveToDay(maroko, ref, null)!;
    const item = pooled.doc.items.find((each) => each.ref === ref)!;
    expect(item.dayRef).toBeUndefined();
    expect(item.planStatus).not.toBe('scheduled');
    expect(documentProblem(pooled.doc)).toBeNull();
    const back = moveToDay(pooled.doc, ref, 'd3')!;
    expect(refs(back.doc, 'd3').at(-1)).toBe(ref);
    expect(back.doc.items.find((each) => each.ref === ref)!.planStatus).toBe('scheduled');
    expect(documentProblem(back.doc)).toBeNull();
  });

  it('przeciąganie: przed punkt, na koniec dnia, do innego dnia i do puli', () => {
    const [first, second, third] = refs(maroko, 'd2');
    const up = dropItem(maroko, third!, 'd2', first)!;
    expect(up.changed).toHaveLength(1);
    expect(refs(up.doc, 'd2').slice(0, 3)).toEqual([third, first, second]);
    expect(refs(dropItem(maroko, first!, 'd2')!.doc, 'd2').at(-1)).toBe(first);
    expect(documentProblem(up.doc)).toBeNull();

    const [target] = refs(maroko, 'd3');
    const other = dropItem(maroko, second!, 'd3', target)!;
    expect(refs(other.doc, 'd3')[0]).toBe(second);
    expect(refs(other.doc, 'd2')).not.toContain(second);
    expect(documentProblem(other.doc)).toBeNull();

    const pooled = dropItem(maroko, second!, null)!;
    expect(pooled.doc.items.find((each) => each.ref === second)!.dayRef).toBeUndefined();
    const back = dropItem(pooled.doc, second!, 'd2', first)!;
    expect(refs(back.doc, 'd2')[0]).toBe(second);
    expect(back.doc.items.find((each) => each.ref === second)!.planStatus).toBe('scheduled');
  });

  it('przeciąganie bez zmiany kolejności nic nie zapisuje', () => {
    const [first, second] = refs(maroko, 'd2');
    expect(dropItem(maroko, first!, 'd2', second)).toBeNull();
    expect(dropItem(maroko, first!, 'd2', first)).toBeNull();
    expect(dropItem(maroko, refs(maroko, 'd2').at(-1)!, 'd2')).toBeNull();
    expect(dropItem(maroko, first!, 'd2', 'nie-ma')).toBeNull();
  });

  it('zmiana czasu trwania przelicza dzień', () => {
    const ref = refs(maroko, 'd2')[1]!;
    const end = (doc: TripDocument) => scheduleDay(doc, 'd2').items.find((each) => each.ref === ref)!.end;
    const edit = updateItem(maroko, ref, { durationMin: (maroko.items.find((each) => each.ref === ref)!.durationMin ?? 0) + 60, durationMaxMin: undefined })!;
    expect(end(edit.doc) - end(maroko)).toBe(60 * 60_000);
  });

  it('nowy punkt na końcu dnia i usunięcie', () => {
    const added = addItem(maroko, 'd2', '01a19366-0000-7000-8000-000000000001', { title: 'Herbata', kind: 'meal', durationMin: 20 });
    expect(added.created!.ref).toBe('id-01a19366-0000-7000-8000-000000000001');
    expect(refs(added.doc, 'd2').at(-1)).toBe(added.created!.ref);
    expect(documentProblem(added.doc)).toBeNull();
    const removed = removeItem(added.doc, added.created!.ref)!;
    expect(removed.doc.items.some((each) => each.ref === added.created!.ref)).toBe(false);
  });

  it('pula: nowy pomysł bez dnia, kandydat, na końcu puli; z nazwą miejsca — nowe miejsce bez współrzędnych', () => {
    const ids = { itemId: '01a19366-0000-7000-8000-000000000004', placeId: '01a19366-0000-7000-8000-000000000005' };
    const added = addPoolItem(maroko, ids, { title: 'Ogrody Majorelle', kind: 'visit', area: 'Marrakesz', description: 'Jeśli zostanie czas' }, ' Jardin Majorelle ');
    expect(added.created).toMatchObject({ ref: `id-${ids.itemId}`, planStatus: 'candidate', placeRef: `id-${ids.placeId}`, area: 'Marrakesz' });
    expect(added.created!.dayRef).toBeUndefined();
    expect(added.places).toEqual([{ created: true, place: { ref: `id-${ids.placeId}`, name: 'Jardin Majorelle', provider: 'unknown', links: [] } }]);
    const pool = added.doc.items.filter((item) => item.dayRef === undefined && item.sortKey !== undefined).sort((a, b) => a.sortKey!.localeCompare(b.sortKey!));
    expect(pool.at(-1)!.ref).toBe(added.created!.ref);
    expect(documentProblem(added.doc)).toBeNull();
    const bare = addPoolItem(maroko, { itemId: '01a19366-0000-7000-8000-000000000006' }, { title: 'Hammam', kind: 'activity' });
    expect(bare.places).toBeUndefined();
    expect(bare.created!.placeRef).toBeUndefined();
    // Telefon: „tu, gdzie jestem” — własna pinezka z nazwą punktu.
    const here = addPoolItem(maroko, ids, { title: 'Kawiarnia z widokiem', kind: 'meal' }, '', { lat: 31.6258123456, lng: -7.9891987654 });
    expect(here.places).toEqual([{ created: true, place: { ref: `id-${ids.placeId}`, name: 'Kawiarnia z widokiem', lat: 31.625812, lng: -7.989199, provider: 'user', links: [] } }]);
    expect(documentProblem(here.doc)).toBeNull();
  });

  it('własna pinezka: nowe miejsce provider: user i punkt w nim; przesunięcie tylko własnych pinezek', () => {
    const ids = { itemId: '01a19366-0000-7000-8000-000000000002', placeId: '01a19366-0000-7000-8000-000000000003' };
    const added = addItemAtPin(maroko, 'd2', ids, { lat: 31.6258123456, lng: -7.9891987654 }, { title: 'Ogród', kind: 'visit', durationMin: 30 });
    expect(added.places).toEqual([{ created: true, place: { ref: `id-${ids.placeId}`, name: 'Ogród', lat: 31.625812, lng: -7.989199, provider: 'user', links: [] } }]);
    expect(added.created).toMatchObject({ ref: `id-${ids.itemId}`, placeRef: `id-${ids.placeId}`, dayRef: 'd2' });
    expect(refs(added.doc, 'd2').at(-1)).toBe(added.created!.ref);
    expect(documentProblem(added.doc)).toBeNull();

    const moved = movePlace(added.doc, `id-${ids.placeId}`, { lat: 31.63, lng: -7.99 })!;
    expect(moved.changed).toEqual([]);
    expect(moved.places).toEqual([{ place: expect.objectContaining({ lat: 31.63, lng: -7.99, provider: 'user' }) }]);
    expect(moved.doc.places.find((place) => place.ref === `id-${ids.placeId}`)).toMatchObject({ lat: 31.63, lng: -7.99 });
    expect(movePlace(maroko, 'p-bahia', { lat: 0, lng: 0 })).toBeNull();
  });

  it('miejsce bez współrzędnych dostaje własną pinezkę', () => {
    const pinned = movePlace(maroko, 'p-warsztaty-tui', { lat: 31.5149, lng: -9.7701 })!;
    expect(pinned.places).toEqual([{ place: expect.objectContaining({ ref: 'p-warsztaty-tui', lat: 31.5149, lng: -9.7701, provider: 'user' }) }]);
    expect(documentProblem(pinned.doc)).toBeNull();
  });

  it('usunięcie punktu wyrzucanego przez wariant: wariant przestaje go wyrzucać', () => {
    const edit = removeItem(maroko, 'd1-suki')!;
    const variant = edit.others?.find((each) => each.collection === 'variants');
    expect(variant?.element.excludesRefs).not.toContain('d1-suki');
    expect(documentProblem(edit.doc)).toBeNull();
  });

  it('usunięcie bloku: podpunkty zostają bez bloku', () => {
    const chatka = TripDocument.parse(
      JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/chatka/plan.json', import.meta.url)), 'utf8')),
    );
    const block = chatka.items.find((item) => chatka.items.some((other) => other.parentRef === item.ref))!;
    // Ograniczenie przy bloku najpierw znika (w planie wzorcowym blok PRACA je ma).
    const free = { ...chatka, constraints: chatka.constraints.filter((each) => each.itemRef !== block.ref) };
    const edit = removeItem(free, block.ref)!;
    expect(edit.changed.length).toBeGreaterThan(0);
    expect(edit.changed.every((item) => item.parentRef === undefined)).toBe(true);
    expect(documentProblem(edit.doc)).toBeNull();
  });

  it('punkt wskazany przez ograniczenie albo budżet nie da się usunąć', () => {
    const constrained = maroko.constraints.find((each) => each.itemRef !== undefined) ?? maroko.budgetLines.find((each) => each.itemRef !== undefined);
    expect(constrained).toBeDefined();
    expect(() => removeItem(maroko, constrained!.itemRef!)).toThrow(ItemInUseError);
  });
});

describe('skąd i dokąd przejazdu', () => {
  const gruzja = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/gruzja/plan.json', import.meta.url)), 'utf8')));
  const ref = 'd2-dojazd-mestia';
  const routedDoc = TripDocument.parse({ ...gruzja, items: gruzja.items.map((item) => (item.ref === ref ? { ...item, leg: { ...item.leg, durationMin: 224, durationMaxMin: 291, distanceKm: 144, routed: true, geometry: 'abc' } } : item)) });
  const name = (doc: TripDocument, placeRef: string | undefined) => doc.places.find((place) => place.ref === placeRef)?.name;
  const ids = { fromId: 'f', toId: 't' };
  const leg = (doc: TripDocument) => doc.items.find((item) => item.ref === ref)!.leg!;
  const start = name(routedDoc, leg(routedDoc).fromPlaceRef)!;
  const end = name(routedDoc, leg(routedDoc).toPlaceRef)!;

  it('nowy start ze znanej nazwy unieważnia trasę, a czas zostaje jako szacunek', () => {
    const edit = setLegRoute(routedDoc, ref, ids, { from: 'lotnisko kutaisi', to: end, routeUrl: '' })!;
    expect(edit.placesChanged).toBe(true);
    expect(leg(edit.doc).fromPlaceRef).toBe('lotnisko-kutaisi');
    expect(leg(edit.doc)).toMatchObject({ durationMin: 224, mode: 'rental_car' });
    expect(leg(edit.doc).routed).toBeUndefined();
    expect(leg(edit.doc).geometry).toBeUndefined();
    expect(leg(edit.doc).distanceKm).toBeUndefined();
    expect(edit.places).toBeUndefined();
    expect(documentProblem(edit.doc)).toBeNull();
  });

  it('nowa nazwa tworzy miejsce, a punkt wskazuje cel', () => {
    const edit = setLegRoute(routedDoc, ref, ids, { from: start, to: 'Nowa wioska', routeUrl: '' })!;
    expect(edit.places?.[0]?.place).toMatchObject({ ref: 'id-t', name: 'Nowa wioska', provider: 'unknown' });
    expect(leg(edit.doc).toPlaceRef).toBe('id-t');
    expect(edit.doc.items.find((item) => item.ref === ref)?.placeRef).toBe('id-t');
    expect(documentProblem(edit.doc)).toBeNull();
  });

  it('sam własny link nie rusza trasy, a pusty go usuwa', () => {
    const edit = setLegRoute(routedDoc, ref, ids, { from: start, to: end, routeUrl: 'https://maps.app.goo.gl/AbC' })!;
    expect(edit.placesChanged).toBe(false);
    expect(leg(edit.doc)).toMatchObject({ routeUrl: 'https://maps.app.goo.gl/AbC', routed: true, distanceKm: 144, geometry: 'abc' });
    expect(documentProblem(edit.doc)).toBeNull();
    expect(leg(setLegRoute(edit.doc, ref, ids, { from: start, to: end, routeUrl: '' })!.doc).routeUrl).toBeUndefined();
  });

  it('bez zmian nic nie zapisuje, a link spoza http(s) nie przechodzi walidacji', () => {
    expect(setLegRoute(routedDoc, ref, ids, { from: start, to: end, routeUrl: '' })).toBeNull();
    expect(documentProblem(setLegRoute(routedDoc, ref, ids, { from: start, to: end, routeUrl: 'javascript:alert(1)' })!.doc)).not.toBeNull();
  });
});

describe('godzina przenoszonego punktu', () => {
  const gruzja = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/gruzja/plan.json', import.meta.url)), 'utf8')));
  const carPickup = (doc: TripDocument) => doc.items.find((item) => item.ref === 'd1-odbior-auta')!;
  const toTop = (doc: TripDocument, ref: string, dayRef: string) => dropItem(doc, ref, dayRef, dayItems(doc, dayRef).find((item) => item.ref !== ref)!.ref)!;

  it('wieczorny odbiór auta przeniesiony na początek innego dnia nie rozjeżdża godzin', () => {
    const edit = toTop(gruzja, 'd1-odbior-auta', 'd2');
    expect(carPickup(edit.doc).time).toBeUndefined();
    expect(edit.changed.find((item) => item.ref === 'd1-odbior-auta')?.time).toBeUndefined();
    const after = scheduleDay(edit.doc, 'd2').items;
    expect(after[0]?.ref).toBe('d1-odbior-auta');
    expect(after.every((item) => item.endDate === gruzja.days.find((day) => day.ref === 'd2')!.date)).toBe(true);
    expect(documentProblem(edit.doc)).toBeNull();
  });

  it('na końcu dnia godzina pasuje i zostaje, a strzałka w górę ją zdejmuje, gdy zaczyna przeszkadzać', () => {
    const moved = moveToDay(gruzja, 'd1-odbior-auta', 'd2')!;
    expect(carPickup(moved.doc).time).toMatchObject({ start: '21:45' });
    let doc = moved.doc;
    for (let step = dayItems(doc, 'd2').length; step > 0; step -= 1) doc = moveWithinDay(doc, 'd1-odbior-auta', -1)?.doc ?? doc;
    expect(dayItems(doc, 'd2')[0]?.ref).toBe('d1-odbior-auta');
    expect(carPickup(doc).time).toBeUndefined();
  });

  it('stała godzina i dokładna godzina rezerwacji zostają mimo konfliktu', () => {
    const pinned = (patch: object) => TripDocument.parse({ ...gruzja, items: gruzja.items.map((item) => (item.ref === 'd1-odbior-auta' ? { ...item, ...patch } : item)) });
    expect(carPickup(toTop(pinned({ isFixed: true }), 'd1-odbior-auta', 'd2').doc).time).toMatchObject({ start: '21:45' });
    expect(carPickup(toTop(pinned({ time: { precision: 'exact', start: '21:45' } }), 'd1-odbior-auta', 'd2').doc).time).toMatchObject({ start: '21:45' });
  });

  it('dokładna godzina bez rezerwacji też ustępuje, gdy przesuwa cały dzień', () => {
    const plain = TripDocument.parse({ ...gruzja, items: gruzja.items.map((item) => (item.ref === 'd1-odbior-auta' ? { ...item, bookingRef: undefined, time: { precision: 'exact', start: '21:45' } } : item)) });
    expect(carPickup(toTop(plain, 'd1-odbior-auta', 'd2').doc).time).toBeUndefined();
  });

  it('godzina pasująca do nowego miejsca zostaje', () => {
    const [first, second] = refs(maroko, 'd2');
    const edit = moveWithinDay(maroko, second!, -1)!;
    const before = maroko.items.find((item) => item.ref === first)!;
    expect(edit.doc.items.find((item) => item.ref === first)?.time).toEqual(before.time);
  });
});

describe('usunięcie z zamknięciem luki', () => {
  const doc = (times: Record<string, [precision: 'exact' | 'approx', start: string, duration: number]>) =>
    TripDocument.parse({
      schemaVersion: 1,
      trip: { title: 'Test', startDate: '2027-06-22', endDate: '2027-06-22', primaryTz: 'Europe/Rome', baseCurrency: 'EUR' },
      days: [{ ref: 'd1', date: '2027-06-22', tz: 'Europe/Rome' }],
      items: Object.entries(times).map(([ref, [precision, start, durationMin]], i) => ({
        ref,
        dayRef: 'd1',
        sortKey: String((i + 1) * 10).padStart(4, '0'),
        kind: 'visit',
        title: ref,
        time: { precision, start },
        durationMin,
      })),
    });
  const starts = (edit: ReturnType<typeof removeItemClosingGap>) =>
    Object.fromEntries(scheduleDay(edit!.doc, 'd1').items.map((item) => [item.ref, item.startLocal]));

  it('kolejne punkty z godziną przybliżoną idą wcześniej, do pierwszej stałej godziny', () => {
    const edit = removeItemClosingGap(doc({ a: ['exact', '08:00', 60], b: ['approx', '09:00', 60], c: ['approx', '10:00', 30], d: ['approx', '11:00', 60], e: ['exact', '13:00', 60], f: ['approx', '14:00', 60] }), 'b')!;
    expect(edit.shiftedMin).toBe(60);
    expect(starts(edit)).toEqual({ a: '08:00', c: '09:00', d: '10:00', e: '13:00', f: '14:00' });
    expect(edit.changed.map((item) => item.ref)).toEqual(['c', 'd']);
    expect(documentProblem(edit.doc)).toBeNull();
  });

  it('nie wcześniej niż koniec poprzedniego punktu; luka sprzed usunięcia zostaje', () => {
    const edit = removeItemClosingGap(doc({ a: ['exact', '08:00', 60], b: ['approx', '09:30', 30], c: ['approx', '10:30', 30] }), 'b')!;
    // Zwolnione 30 min (trwanie b); c mogłoby zacząć się o 09:00, ale przesuwa się tylko o 30.
    expect(edit.shiftedMin).toBe(30);
    expect(starts(edit)).toEqual({ a: '08:00', c: '10:00' });
  });

  it('stała godzina zaraz po usuniętym — nic się nie przesuwa', () => {
    const edit = removeItemClosingGap(doc({ a: ['exact', '08:00', 60], b: ['approx', '09:00', 60], c: ['exact', '10:00', 30] }), 'b')!;
    expect(edit.shiftedMin).toBeUndefined();
    expect(edit.changed).toEqual([]);
  });
});

describe('miejsce punktu', () => {
  const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));
  const located = (doc: TripDocument) => doc.places.find((place) => place.lat !== undefined && placeUses(doc, place.ref) > 0)!;

  it('poprawa nazwy zostawia lokalizację i działa wszędzie, gdzie miejsce występuje', () => {
    const doc = load('maroko');
    const place = located(doc);
    const edit = renamePlace(doc, place.ref, '  Nowa nazwa ')!;
    expect(edit.doc.places.find((each) => each.ref === place.ref)).toEqual({ ...place, name: 'Nowa nazwa' });
    expect(edit.places).toEqual([{ place: { ...place, name: 'Nowa nazwa' } }]);
    expect(documentProblem(edit.doc)).toBeNull();
    expect(renamePlace(doc, place.ref, place.name)).toBeNull();
    expect(renamePlace(doc, place.ref, '   ')).toBeNull();
  });

  it('„inny lokal” czyści współrzędne i adres, a odwołania zostają', () => {
    const doc = load('maroko');
    const place = located(doc);
    const edit = replacePlace(doc, place.ref, 'Inny lokal')!;
    expect(edit.places![0]!.place).toEqual({ ref: place.ref, name: 'Inny lokal', provider: 'unknown', links: [] });
    expect(placeUses(edit.doc, place.ref)).toBe(placeUses(doc, place.ref));
    expect(documentProblem(edit.doc)).toBeNull();
  });

  it('tylko ten punkt: miejsce z listy po nazwie albo nowe', () => {
    const doc = load('maroko');
    const item = doc.items.find((each) => each.placeRef !== undefined)!;
    const other = doc.places.find((place) => place.ref !== item.placeRef)!;

    const existing = setItemPlace(doc, item.ref, 'x', other.name.toUpperCase())!;
    expect(existing.places).toBeUndefined();
    expect(existing.changed.find((each) => each.ref === item.ref)?.placeRef).toBe(other.ref);

    const created = setItemPlace(doc, item.ref, 'nowe', 'Całkiem nowe miejsce')!;
    expect(created.places).toEqual([{ place: { ref: 'id-nowe', name: 'Całkiem nowe miejsce', provider: 'unknown', links: [] }, created: true }]);
    expect(created.changed.find((each) => each.ref === item.ref)?.placeRef).toBe('id-nowe');
    expect(documentProblem(created.doc)).toBeNull();
  });
});
