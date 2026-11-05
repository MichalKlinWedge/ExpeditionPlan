import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mealDays, mealList, mealMap, mealTime } from '../meals.ts';
import { mergePlaces } from '../place-list.ts';
import { documentProblem } from '../plan-edits.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import { applyVenueDraft, removeVenue, type VenueDraft, venueDraftRows, venuePriceLabel, venueRatingLabel } from '../venue-info.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const draft: VenueDraft = {
  isVenue: true,
  description: 'Mała pizzeria przy rynku.',
  address: 'Rynek 1, Wrocław',
  openingHours: '12:00–22:00',
  website: 'https://example.com/',
  prices: [
    { name: 'Margherita', currency: 'PLN', minMinor: 3200, maxMinor: 3200 },
    { name: 'Zupa', currency: 'PLN', minMinor: 1800, maxMinor: 2400 },
  ],
  rating: { value: 4.6, scale: 5, count: 1240, source: 'Google Maps' },
};

/** Plan z posiłkami: każdy w jednym z dwóch miejsc na mapie albo bez miejsca. */
function withMeals() {
  const doc = load('maroko');
  const meals = doc.items.filter((item) => item.kind === 'meal');
  expect(meals.length).toBeGreaterThan(2);
  return doc;
}

describe('lokal z wklejonego tekstu', () => {
  it('etykiety oceny i cen', () => {
    expect(venueRatingLabel(draft.rating!)).toBe('4,6/5 · opinie: 1240 · Google Maps');
    expect(venueRatingLabel({ value: 8, scale: 10 })).toBe('8/10');
    expect(venuePriceLabel(draft.prices[0]!)).toMatch(/^Margherita: 32\s*zł$/);
    expect(venuePriceLabel(draft.prices[1]!)).toMatch(/^Zupa: 18\s*zł – 24\s*zł$/);
  });

  it('zapis zaznaczonych pól: dokument przechodzi walidację, reszta miejsca bez zmian', () => {
    const doc = load('maroko');
    const place = doc.places[0]!;
    const edit = applyVenueDraft(doc, place.ref, draft, ['description', 'rating', 'prices'], '2026-11-05')!;
    expect(documentProblem(edit.doc)).toBeNull();
    const saved = edit.doc.places[0]!;
    expect(saved.venue).toEqual({ description: draft.description, prices: draft.prices, rating: { value: 4.6, scale: 5, count: 1240, source: 'Google Maps' }, readOn: '2026-11-05' });
    expect(saved.address).toBe(place.address);
    expect(edit.writes).toEqual([{ collection: 'places', element: saved, op: 'update' }]);
    expect(applyVenueDraft(doc, 'nie-ma', draft, ['description'], '2026-11-05')).toBeNull();
  });

  it('adres bez danych lokalu nie tworzy pustego opisu ani nie przesuwa daty odczytu', () => {
    const doc = load('maroko');
    const ref = doc.places[0]!.ref;
    const onlyAddress = applyVenueDraft(doc, ref, draft, ['address'], '2026-11-05')!.doc;
    expect(onlyAddress.places[0]!.venue).toBeUndefined();
    expect(onlyAddress.places[0]!.address).toBe('Rynek 1, Wrocław');
    const read = applyVenueDraft(doc, ref, draft, ['rating'], '2026-11-05')!.doc;
    const later = applyVenueDraft(read, ref, draft, ['website'], '2026-12-01')!.doc;
    expect(later.places[0]!.venue?.readOn).toBe('2026-11-05');
  });

  it('podgląd: inna wartość pokazuje obecną, a ta sama znika', () => {
    const doc = load('maroko');
    const ref = doc.places[0]!.ref;
    const saved = applyVenueDraft(doc, ref, draft, ['description', 'rating', 'prices', 'address', 'openingHours', 'website'], '2026-11-05')!.doc.places[0]!;
    expect(venueDraftRows(saved, draft)).toEqual([]);
    const rows = venueDraftRows(saved, { ...draft, rating: { value: 4.2, scale: 5, count: null, source: null } });
    expect(rows).toEqual([{ key: 'rating', label: 'Średnia ocena', value: '4,2/5', current: '4,6/5 · opinie: 1240 · Google Maps' }]);
    expect(venueDraftRows({ ...saved, venue: undefined }, { ...draft, prices: [], rating: null }).map((row) => row.key)).toEqual(['description']);
  });

  it('usunięcie zostawia dane miejsca, a scalenie przenosi opis lokalu', () => {
    const doc = load('maroko');
    const [first, second] = [doc.places[0]!.ref, doc.places[1]!.ref];
    const read = applyVenueDraft(doc, second, draft, ['description', 'address'], '2026-11-05')!.doc;
    expect(mergePlaces(read, first, second)!.doc.places.find((place) => place.ref === first)?.venue?.description).toBe(draft.description);
    const gone = removeVenue(read, second)!.doc.places.find((place) => place.ref === second)!;
    expect(gone.venue).toBeUndefined();
    expect(gone.address).toBe('Rynek 1, Wrocław');
    expect(removeVenue(doc, second)).toBeNull();
  });
});

describe('posiłki dzień po dniu z mapą', () => {
  it('każdy dzień ma sekcję, a posiłki trafiają do swojego dnia', () => {
    const doc = withMeals();
    const days = mealDays(doc);
    expect(days.map((day) => day.dayRef)).toEqual(doc.days.map((day) => day.ref));
    expect(days.flatMap((day) => day.meals)).toHaveLength(mealList(doc).length);
    for (const day of days) for (const meal of day.meals) expect(meal.dayRef).toBe(day.dayRef);
  });

  it('numer na miejsce: posiłki w tym samym lokalu mają jeden numer, a miejsce bez współrzędnych żadnego', () => {
    const base = withMeals();
    const [one, two, three, four] = base.items.filter((item) => item.kind === 'meal' && item.planStatus === 'scheduled' && item.variantRefs.length === 0);
    const on = { ref: 'lokal-a', name: 'Lokal A', provider: 'user' as const, links: [], lat: 31.6, lng: -8 };
    const other = { ref: 'lokal-b', name: 'Lokal B', provider: 'user' as const, links: [], lat: 31.7, lng: -8.1 };
    const off = { ref: 'lokal-c', name: 'Lokal C', provider: 'unknown' as const, links: [] };
    const target = new Map([[one!.ref, on.ref], [two!.ref, other.ref], [three!.ref, on.ref], [four!.ref, off.ref]]);
    const doc = {
      ...base,
      places: [...base.places, on, other, off],
      items: base.items.map((item) => (item.kind !== 'meal' ? item : target.has(item.ref) ? { ...item, placeRef: target.get(item.ref)! } : { ...item, placeRef: undefined })),
    };
    const { numbers, map } = mealMap(doc);
    expect(numbers).toEqual({ 'lokal-a': 1, 'lokal-b': 2 });
    expect(map.pins.map((pin) => [pin.placeRef, pin.stops.length])).toEqual([['lokal-a', 1], ['lokal-b', 1]]);
    expect(map.pins[0]!.stops[0]!.ref).toBe('lokal-a');
    expect(map.pins[0]!.stops[0]!.title).toContain(one!.title);
    expect(map.pins[0]!.stops[0]!.title).toContain(three!.title);
  });

  it('godzina: własna z „ok.”, bez godziny nic', () => {
    const doc = withMeals();
    const meals = mealList(doc);
    const meal = meals[0]!;
    const set = (time: TripDocument['items'][number]['time']) => ({ ...doc, items: doc.items.map((item) => (item.ref === meal.itemRef ? { ...item, time } : item)) });
    expect(mealTime(set({ precision: 'approx', start: '13:00' }), { ...meal, at: undefined })).toBe('ok. 13:00');
    expect(mealTime(set({ precision: 'exact', start: '19:30' }), { ...meal, at: undefined })).toBe('19:30');
    expect(mealTime(set(undefined), { ...meal, at: undefined })).toBeNull();
    expect(mealTime(set(undefined), { ...meal, at: { ref: 'x', title: 'Przejazd', stop: true } })).toBeNull();
  });
});
