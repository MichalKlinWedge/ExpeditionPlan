import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { addEatOutChoices, eateryKindLabel, type Eatery, eatOutOptions, isEateryPlace, isPinnedEatery, mealEateries } from '../eat-out.ts';
import { mealList, mealMap } from '../meals.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import { applyVenueDraft, removeVenue } from '../venue-info.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const eatery = (name: string, extra: Partial<Eatery> = {}): Eatery => ({ name, lat: 31.6262, lng: -7.9891, kind: 'restaurant', ...extra });

let counter = 0;
const newRef = () => `id-00000000-0000-7000-8001-${String(++counter).padStart(12, '0')}`;

const MEAL = 'd2-lunch';
const placeOfMeal = (doc: TripDocument) => doc.items.find((item) => item.ref === MEAL)!.placeRef;

/** Posiłek stoi w miejscu z planu, które nie jest knajpą (jak „Śniadanie w Chatce”). */
function atChatka() {
  const base = load('maroko');
  const chatka = { ref: 'chatka', name: 'Chatka Górzystów', category: 'lodging', provider: 'osm' as const, lat: 31.6262, lng: -7.9891, links: [] };
  return { ...base, places: [...base.places, chatka], items: base.items.map((item) => (item.ref === MEAL ? { ...item, placeRef: 'chatka' } : item)) };
}

describe('przypinanie knajp do posiłku', () => {
  it('knajpa, która już jest w planie, nie tworzy duplikatu: to samo miejsce staje się knajpą i dostaje brakujące dane', () => {
    const doc = atChatka();
    expect(mealEateries(doc, MEAL)).toEqual([]);
    const edit = addEatOutChoices(doc, MEAL, [{ eatery: eatery('Chatka  górzystów', { kind: 'hut', address: 'Sina Droga', website: 'chatka.example', osm: { type: 'node', id: 9 } }) }], newRef)!;
    expect(TripDocument.safeParse(edit.doc).success).toBe(true);
    expect(edit.doc.places).toHaveLength(doc.places.length);
    expect(edit.writes.map((write) => `${write.collection}:${write.op}`)).toEqual(['places:update']);
    expect(edit.pinned).toEqual(['chatka']);
    const place = edit.doc.places.find((each) => each.ref === 'chatka')!;
    expect(place).toMatchObject({ name: 'Chatka Górzystów', category: 'lodging', address: 'Sina Droga', website: 'https://chatka.example', venue: { prices: [] }, links: [{ url: 'https://www.openstreetmap.org/node/9' }] });
    expect(mealEateries(edit.doc, MEAL)).toEqual([{ placeRef: 'chatka', name: 'Chatka Górzystów', active: true }]);
  });

  it('ta sama nazwa daleko to inna knajpa', () => {
    const edit = addEatOutChoices(atChatka(), MEAL, [{ eatery: eatery('Chatka Górzystów', { lat: 32 }) }], newRef)!;
    expect(edit.writes.map((write) => `${write.collection}:${write.op}`)).toEqual(['places:insert', 'items:update']);
    expect(placeOfMeal(edit.doc)).not.toBe('chatka');
  });

  it('pierwsza przypięta knajpa zastępuje miejsce z planu i jest widoczna przy posiłku', () => {
    const edit = addEatOutChoices(atChatka(), MEAL, [{ eatery: eatery('Le Jardin') }], newRef)!;
    const [only] = mealEateries(edit.doc, MEAL);
    expect(only).toMatchObject({ name: 'Le Jardin', active: true });
    expect(only!.placeRef).toBe(placeOfMeal(edit.doc));
    expect(edit.pinned).toEqual([only!.placeRef]);
  });

  it('kolejna knajpa nie kasuje poprzedniej: razem tworzą wybór, a posiłek zostaje przy pierwszej', () => {
    const first = addEatOutChoices(atChatka(), MEAL, [{ eatery: eatery('A') }], newRef)!;
    const second = addEatOutChoices(first.doc, MEAL, [{ eatery: eatery('B', { lat: 31.63 }), summary: 'druga' }], newRef)!;
    expect(TripDocument.safeParse(second.doc).success).toBe(true);
    expect(eatOutOptions(second.doc, MEAL).map((option) => [option.label, option.active])).toEqual([['A', true], ['B', false]]);
    expect(placeOfMeal(second.doc)).toBe(placeOfMeal(first.doc));
    expect(mealEateries(second.doc, MEAL).map((each) => each.name)).toEqual(['A', 'B']);
    expect(mealList(second.doc).filter((meal) => meal.title === second.doc.items.find((item) => item.ref === MEAL)!.title)).toHaveLength(1);
    // Także przy wszystkich wariantach: kolejne knajpy stoją pod posiłkiem, a nie jako osobne posiłki.
    const all = mealList(second.doc, { allVariants: true }).filter((meal) => meal.title === second.doc.items.find((item) => item.ref === MEAL)!.title);
    expect(all).toHaveLength(1);
    expect(all[0]!.variants).toBeUndefined();
    expect(second.writes.map((write) => write.collection)).toEqual(['places', 'variantGroups', 'variants', 'variants', 'items', 'items']);
  });

  it('knajpa już przypięta nic nie zmienia i jest oznaczona w wynikach', () => {
    const first = addEatOutChoices(atChatka(), MEAL, [{ eatery: eatery('A') }], newRef)!;
    expect(isPinnedEatery(first.doc, MEAL, eatery('a'))).toBe(true);
    expect(isPinnedEatery(first.doc, MEAL, eatery('B'))).toBe(false);
    const again = addEatOutChoices(first.doc, MEAL, [{ eatery: eatery('A') }], newRef)!;
    expect(again.writes).toEqual([]);
    expect(again.doc.places).toEqual(first.doc.places);
    expect(again.pinned).toEqual([placeOfMeal(first.doc)]);
  });

  it('dwa razy ta sama knajpa w jednym wyborze to jedna opcja', () => {
    const edit = addEatOutChoices(atChatka(), MEAL, [{ eatery: eatery('A') }, { eatery: eatery('A') }], newRef)!;
    expect(edit.doc.variants.length).toBe(load('maroko').variants.length);
    expect(mealEateries(edit.doc, MEAL)).toHaveLength(1);
  });

  it('knajpą jest miejsce z `venue` i starsze przypięte z wyszukiwania, a nie zwykłe miejsce z planu', () => {
    const plain = { ref: 'x', name: 'X', provider: 'osm' as const, links: [] };
    expect(isEateryPlace(plain)).toBe(false);
    expect(isEateryPlace({ ...plain, category: 'restaurant' })).toBe(false);
    expect(isEateryPlace({ ...plain, provider: 'geoapify', category: 'town' })).toBe(false);
    expect(isEateryPlace({ ...plain, provider: 'geoapify', category: 'hut' })).toBe(true);
    expect(isEateryPlace({ ...plain, venue: { prices: [] } })).toBe(true);
    expect(eateryKindLabel({ ...plain, category: 'hut' })).toBe('schronisko');
    expect(eateryKindLabel({ ...plain, category: 'lodging' })).toBeUndefined();
  });

  it('knajpy do wyboru mają na mapie własne numery, a niewybrana nie liczy się jako posiłek', () => {
    const edit = addEatOutChoices(atChatka(), MEAL, [{ eatery: eatery('A') }, { eatery: eatery('B', { lat: 31.63 }) }], newRef)!;
    const { numbers, map } = mealMap(edit.doc);
    const [a, b] = mealEateries(edit.doc, MEAL);
    expect(numbers[a!.placeRef]).toBeDefined();
    expect(numbers[b!.placeRef]).toBe(numbers[a!.placeRef]! + 1);
    expect(map.pins.filter((pin) => pin.placeRef === b!.placeRef)).toHaveLength(1);
  });

  it('usunięcie opisu i odczyt z tekstu nie odbierają miejscu statusu knajpy', () => {
    const first = addEatOutChoices(atChatka(), MEAL, [{ eatery: eatery('Chatka Górzystów') }], newRef)!;
    const read = applyVenueDraft(first.doc, 'chatka', { isVenue: true, description: 'Opis.', address: null, openingHours: null, website: null, prices: [], rating: null }, ['description'], '2026-11-05')!.doc;
    expect(read.places.find((each) => each.ref === 'chatka')!.venue).toEqual({ description: 'Opis.', prices: [], readOn: '2026-11-05' });
    const cleared = removeVenue(read, 'chatka')!.doc;
    expect(mealEateries(cleared, MEAL)).toHaveLength(1);
    const addressOnly = applyVenueDraft(first.doc, 'chatka', { isVenue: true, description: null, address: 'A', openingHours: null, website: null, prices: [], rating: null }, ['address'], '2026-11-05')!.doc;
    expect(addressOnly.places.find((each) => each.ref === 'chatka')!.venue).toEqual({ prices: [] });
  });
});
