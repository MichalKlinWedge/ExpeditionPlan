import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mealDays, mealList, mealMap, mealTime } from '../meals.ts';
import { mergePlaces } from '../place-list.ts';
import { documentProblem } from '../plan-edits.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import { applyVenueDraft, editVenuePoint, editVenuePrice, removeVenue, removeVenueRating, VENUE_FIELD, type VenueDraft, venueDraftRows, venuePoints, venuePriceLabel, venueRatingLabel } from '../venue-info.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const draft: VenueDraft = {
  isVenue: true,
  points: ['Mała pizzeria przy rynku.', 'Płatność tylko gotówką.'],
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
    const edit = applyVenueDraft(doc, place.ref, draft, ['point:0', 'point:1', 'rating', 'price:0', 'price:1'], '2026-11-05')!;
    expect(documentProblem(edit.doc)).toBeNull();
    const saved = edit.doc.places[0]!;
    expect(saved.venue).toEqual({ points: draft.points, prices: draft.prices, rating: { value: 4.6, scale: 5, count: 1240, source: 'Google Maps' }, readOn: '2026-11-05' });
    expect(saved.address).toBe(place.address);
    expect(edit.writes).toEqual([{ collection: 'places', element: saved, op: 'update' }]);
    expect(applyVenueDraft(doc, 'nie-ma', draft, ['point:0'], '2026-11-05')).toBeNull();
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

  it('podgląd: każdy punkt i cena osobno, inna wartość pokazuje obecną, a ta sama znika', () => {
    const doc = load('maroko');
    const ref = doc.places[0]!.ref;
    const everything = ['point:0', 'point:1', 'rating', 'price:0', 'price:1', 'address', 'openingHours', 'website'];
    const clean = { ...doc.places[0]!, address: undefined, openingHours: undefined, website: undefined };
    expect(venueDraftRows(clean, draft).map((row) => row.key)).toEqual(everything);
    for (const row of venueDraftRows(clean, draft)) expect(row.key).toMatch(VENUE_FIELD);
    const saved = applyVenueDraft(doc, ref, draft, everything, '2026-11-05')!.doc.places[0]!;
    expect(venueDraftRows(saved, draft)).toEqual([]);
    const rows = venueDraftRows(saved, { ...draft, rating: { value: 4.2, scale: 5, count: null, source: null } });
    expect(rows).toEqual([{ key: 'rating', label: 'Średnia ocena', value: '4,2/5', current: '4,6/5 · opinie: 1240 · Google Maps' }]);
    expect(venueDraftRows(saved, { ...draft, points: ['MAŁA pizzeria przy rynku', 'Nowość.'] }).map((row) => row.value)).toEqual(['Nowość.']);
  });

  it('kolejny odczyt dopisuje: punkty i ceny zostają, niezaznaczone nie wchodzą, a ta sama nazwa ceny się aktualizuje', () => {
    const doc = load('maroko');
    const ref = doc.places[0]!.ref;
    const first = applyVenueDraft(doc, ref, draft, ['point:0', 'point:1', 'price:0', 'price:1'], '2026-11-05')!.doc;
    const next: VenueDraft = { ...draft, points: ['Ogródek latem.', 'Nie to.'], prices: [{ name: 'Margherita', currency: 'PLN', minMinor: 3500, maxMinor: 3500 }, { name: 'Lemoniada', currency: 'PLN', minMinor: 1200, maxMinor: 1200 }], rating: null };
    const rows = venueDraftRows(first.places[0]!, next);
    expect(rows.find((row) => row.key === 'price:0')?.current).toMatch(/^Margherita: 32/);
    const after = applyVenueDraft(first, ref, next, ['point:0', 'price:0', 'price:1'], '2026-12-01')!.doc.places[0]!.venue!;
    expect(after.points).toEqual([...draft.points, 'Ogródek latem.']);
    expect(after.prices.map((price) => [price.name, price.minMinor])).toEqual([['Margherita', 3500], ['Zupa', 1800], ['Lemoniada', 1200]]);
    expect(after.readOn).toBe('2026-12-01');
  });

  it('dawny opis jednym tekstem nie ginie: jest pierwszym punktem i przy zmianie przechodzi do punktów', () => {
    const doc = load('maroko');
    const ref = doc.places[0]!.ref;
    const old = { ...doc, places: doc.places.map((place) => (place.ref === ref ? { ...place, venue: { description: 'Stary opis.', prices: [], readOn: '2026-01-01' } } : place)) };
    expect(venuePoints(old.places[0]!.venue)).toEqual(['Stary opis.']);
    expect(venueDraftRows(old.places[0]!, { ...draft, points: ['Stary opis.'], prices: [], rating: null, address: null, openingHours: null, website: null })).toEqual([]);
    const added = applyVenueDraft(old, ref, draft, ['point:0'], '2026-11-05')!.doc.places[0]!.venue!;
    expect(added).toEqual({ points: ['Stary opis.', draft.points[0]], prices: [], readOn: '2026-11-05' });
    const edited = editVenuePoint(old, ref, 'Stary opis.', 'Nowy opis.')!.doc.places[0]!.venue!;
    expect(edited).toEqual({ points: ['Nowy opis.'], prices: [], readOn: '2026-01-01' });
  });

  it('edycja punktów: dodanie, zmiana, usunięcie, bez powtórzeń i po treści', () => {
    const doc = load('maroko');
    const ref = doc.places[0]!.ref;
    const read = applyVenueDraft(doc, ref, draft, ['point:0', 'point:1'], '2026-11-05')!.doc;
    const points = (edit: ReturnType<typeof editVenuePoint>) => edit!.doc.places[0]!.venue!.points;
    expect(points(editVenuePoint(read, ref, null, '  Trzeci.  '))).toEqual([...draft.points, 'Trzeci.']);
    expect(points(editVenuePoint(read, ref, draft.points[0]!, 'Zmieniony.'))).toEqual(['Zmieniony.', draft.points[1]]);
    expect(points(editVenuePoint(read, ref, draft.points[0]!, null))).toEqual([draft.points[1]]);
    expect(points(editVenuePoint(read, ref, draft.points[0]!, '   '))).toEqual([draft.points[1]]);
    expect(editVenuePoint(read, ref, null, 'mała pizzeria przy rynku')).toBeNull();
    expect(editVenuePoint(read, ref, draft.points[0]!, draft.points[1]!)).toBeNull();
    expect(editVenuePoint(read, ref, 'Nie ma takiego.', 'X')).toBeNull();
    expect(editVenuePoint(read, ref, null, '')).toBeNull();
    expect(editVenuePoint(read, 'nie-ma', null, 'X')).toBeNull();
    expect(documentProblem(editVenuePoint(read, ref, null, 'Trzeci.')!.doc)).toBeNull();
  });

  it('edycja cen i usunięcie oceny', () => {
    const doc = load('maroko');
    const ref = doc.places[0]!.ref;
    const read = applyVenueDraft(doc, ref, draft, ['price:0', 'price:1', 'rating'], '2026-11-05')!.doc;
    const tea = { name: 'Herbata', currency: 'PLN', minMinor: 900, maxMinor: 900 };
    const names = (edit: ReturnType<typeof editVenuePrice>) => edit!.doc.places[0]!.venue!.prices.map((price) => price.name);
    expect(names(editVenuePrice(read, ref, null, tea))).toEqual(['Margherita', 'Zupa', 'Herbata']);
    expect(names(editVenuePrice(read, ref, 'Zupa', tea))).toEqual(['Margherita', 'Herbata']);
    expect(names(editVenuePrice(read, ref, 'Zupa', null))).toEqual(['Margherita']);
    expect(editVenuePrice(read, ref, 'Nie ma', tea)).toBeNull();
    const noRating = removeVenueRating(read, ref)!.doc;
    expect(noRating.places[0]!.venue?.rating).toBeUndefined();
    expect(noRating.places[0]!.venue?.prices).toHaveLength(2);
    expect(removeVenueRating(noRating, ref)).toBeNull();
  });

  it('usunięcie czyści punkty, ceny i ocenę, ale miejsce zostaje knajpą; scalenie przenosi opis lokalu', () => {
    const doc = load('maroko');
    const [first, second] = [doc.places[0]!.ref, doc.places[1]!.ref];
    const read = applyVenueDraft(doc, second, draft, ['point:0', 'address'], '2026-11-05')!.doc;
    expect(mergePlaces(read, first, second)!.doc.places.find((place) => place.ref === first)?.venue?.points).toEqual([draft.points[0]]);
    const gone = removeVenue(read, second)!.doc.places.find((place) => place.ref === second)!;
    expect(gone.venue).toEqual({ prices: [] });
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
