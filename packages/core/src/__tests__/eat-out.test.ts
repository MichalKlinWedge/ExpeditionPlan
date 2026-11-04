import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { addEatOutChoices, cuisineLabel, type Eatery, eaterySummary, eatOutOptions, mealSearchCenter, mealSlot, openAtMeal } from '../eat-out.ts';
import { itemsForDay } from '../engine/schedule.ts';
import { mealList } from '../meals.ts';
import { dayItems } from '../plan-edits.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const eatery = (name: string, extra: Partial<Eatery> = {}): Eatery => ({ name, lat: 31.6262, lng: -7.9891, kind: 'restaurant', ...extra });

let counter = 0;
const newRef = () => `id-00000000-0000-7000-8000-${String(++counter).padStart(12, '0')}`;

describe('knajpy w pobliżu posiłku', () => {
  it('środek: miejsce posiłku, a bez niego najbliższy wcześniejszy punkt dnia ze współrzędnymi', () => {
    const maroko = load('maroko');
    expect(mealSearchCenter(maroko, 'd1-kolacja')).toMatchObject({ near: 'Dżami al-Fna' });
    const lunch = mealSearchCenter(maroko, 'd2-lunch');
    expect(lunch).not.toBeNull();
    const day = dayItems(maroko, 'd2');
    const before = day.slice(0, day.findIndex((item) => item.ref === 'd2-lunch')).map((item) => item.placeRef ?? item.leg?.toPlaceRef);
    const names = maroko.places.filter((place) => before.includes(place.ref)).map((place) => place.name);
    expect(names).toContain(lunch!.near);
  });

  it('pora posiłku i godziny otwarcia z OSM', () => {
    const maroko = load('maroko');
    const slot = mealSlot(maroko, 'd1-kolacja');
    expect(slot).toMatchObject({ date: maroko.days[0]!.date });
    expect(slot!.start).toBeGreaterThanOrEqual(19 * 60 + 30);
    expect(openAtMeal('Mo-Su 12:00-23:00', slot).state).toBe('open');
    expect(openAtMeal('Mo-Su 08:00-16:00', slot)).toMatchObject({ state: 'closed', hours: '08:00–16:00' });
    expect(openAtMeal('Mo-Su 12:00-20:00', slot).state).toBe('partly');
    expect(openAtMeal(undefined, slot).state).toBe('unknown');
  });

  it('kuchnia po polsku i opis z odległością', () => {
    expect(cuisineLabel('pizza;italian;some_thing')).toBe('pizza, włoska, some thing');
    expect(eaterySummary(eatery('Café', { cuisine: 'moroccan', vegetarian: true }), { lat: 31.6258, lng: -7.9891 })).toBe('marokańska · wege · 40 m');
  });

  it('jedna knajpa = nowe miejsce posiłku', () => {
    const maroko = load('maroko');
    const edit = addEatOutChoices(maroko, 'd2-lunch', [{ eatery: eatery('Le Jardin', { website: 'lejardin.ma', osm: { type: 'node', id: 7 } }) }], newRef)!;
    expect(TripDocument.safeParse(edit.doc).success).toBe(true);
    expect(edit.writes.map((write) => `${write.collection}:${write.op}`)).toEqual(['places:insert', 'items:update']);
    const place = edit.doc.places.find((each) => each.ref === edit.doc.items.find((item) => item.ref === 'd2-lunch')!.placeRef)!;
    expect(place).toMatchObject({ name: 'Le Jardin', provider: 'geoapify', website: 'https://lejardin.ma', links: [{ url: 'https://www.openstreetmap.org/node/7' }] });
  });

  it('kilka knajp = „gdzie jemy?”: posiłek w pierwszej, kopie za nim, liczy się raz; kolejne dochodzą do grupy', () => {
    const maroko = load('maroko');
    const before = mealList(maroko).length;
    const edit = addEatOutChoices(maroko, 'd2-lunch', [{ eatery: eatery('A'), summary: 'pierwsza' }, { eatery: eatery('B') }], newRef)!;
    expect(TripDocument.safeParse(edit.doc).success).toBe(true);
    expect(edit.writes.map((write) => `${write.collection}:${write.op}`)).toEqual(['places:insert', 'places:insert', 'variantGroups:insert', 'variants:insert', 'variants:insert', 'items:update', 'items:insert']);
    expect(eatOutOptions(edit.doc, 'd2-lunch').map((option) => [option.label, option.place, option.active])).toEqual([
      ['A', 'A', true],
      ['B', 'B', false],
    ]);
    expect(mealList(edit.doc)).toHaveLength(before);
    // W dniu jest jedna wersja lunchu, a kopia stoi zaraz za oryginałem.
    const day = dayItems(edit.doc, 'd2');
    const at = day.findIndex((item) => item.ref === 'd2-lunch');
    expect(day[at + 1]!.title).toBe(day[at]!.title);
    expect(itemsForDay(edit.doc, 'd2').filter((item) => item.title === day[at]!.title)).toHaveLength(1);
    const copy = day[at + 1]!;
    const group = edit.doc.variantGroups.at(-1)!;
    expect(itemsForDay(edit.doc, 'd2', { activeVariants: { [group.ref]: copy.variantRefs[0]! } }).map((item) => item.ref)).toContain(copy.ref);

    const more = addEatOutChoices(edit.doc, copy.ref, [{ eatery: eatery('C') }], newRef)!;
    expect(TripDocument.safeParse(more.doc).success).toBe(true);
    expect(more.writes.map((write) => write.collection)).toEqual(['places', 'variants', 'items']);
    expect(eatOutOptions(more.doc, 'd2-lunch').map((option) => option.label)).toEqual(['A', 'B', 'C']);
    const keys = dayItems(more.doc, 'd2').map((item) => item.sortKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
