import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  addEatOutChoices,
  cuisineOptions,
  DEFAULT_EATERY_FILTER,
  distanceToRouteM,
  eateryResultsMap,
  type EateryResult,
  eaterySummary,
  filterEateries,
  googleMapsSearchUrl,
  mealRoute,
  rankEateries,
  routeSearchArea,
} from '../eat-out.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));

const result = (name: string, extra: Partial<EateryResult> = {}): EateryResult => ({ name, lat: 31.6262, lng: -7.9891, kind: 'restaurant', distanceM: 100, open: { state: 'unknown' }, summary: '', ...extra });

describe('wybór knajpy: trasa, filtry, polecenia', () => {
  it('posiłek bez miejsca między dwoma punktami blisko siebie = droga między nimi; daleki przejazd — nie', () => {
    expect(mealRoute(maroko, 'd2-lunch')).toBeNull(); // dalej jedzie się na pustynię Agafay (brak współrzędnych)
    const near = { ...maroko, places: maroko.places.map((place) => (place.ref === 'p-agafay' ? { ...place, lat: 31.632, lng: -7.986 } : place)) };
    const route = mealRoute(near, 'd2-lunch')!;
    expect(route.from.near).toBe('Dżami al-Fna');
    expect(route.to).toMatchObject({ lat: 31.632, lng: -7.986 });
    expect(mealRoute(near, 'd2-kolacja')).toBeNull(); // posiłek z własnym miejscem
    const back = { ...maroko, places: maroko.places.map((place) => (place.ref === 'p-agafay' ? { ...place, lat: 31.62583, lng: -7.98892 } : place)) };
    expect(mealRoute(back, 'd2-lunch')).toBeNull(); // ten sam punkt przed i po posiłku
    const far = { ...maroko, places: maroko.places.map((place) => (place.ref === 'p-agafay' ? { ...place, lat: 31.5, lng: -8.2 } : place)) };
    expect(mealRoute(far, 'd2-lunch')).toBeNull();
  });

  it('odległość od odcinka i koło obejmujące drogę z zapasem', () => {
    const route = { from: { lat: 50, lng: 20, near: 'A' }, to: { lat: 50, lng: 20.02, near: 'B' } };
    expect(distanceToRouteM(route, { lat: 50, lng: 20.01 })).toBe(0);
    expect(distanceToRouteM(route, { lat: 50.001, lng: 20.01 })).toBe(111);
    expect(distanceToRouteM(route, { lat: 50, lng: 20.03 })).toBe(715); // za końcem — od końca
    expect(routeSearchArea(route, 500)).toMatchObject({ lat: 50, near: 'A → B', radiusM: 1215 });
    expect(routeSearchArea(route, 500).lng).toBeCloseTo(20.01);
    expect(eaterySummary({ name: 'X', lat: 50, lng: 20, kind: 'restaurant', tip: { source: 'wikivoyage', article: 'A', url: 'https://en.wikivoyage.org/wiki/A', tier: 'budget' } }, null, undefined, 120)).toBe(
      'restauracja · polecane w Wikivoyage (tanio) · 120 m od trasy',
    );
  });

  it('filtry: zamknięte i sieciówki domyślnie precz, kuchnia, tylko polecane (Wikivoyage albo nasze „warto”)', () => {
    const tip = { source: 'wikivoyage' as const, article: 'A', url: 'https://en.wikivoyage.org/wiki/A' };
    const all = [
      result('Zamknięta', { open: { state: 'closed' } }),
      result('Sieć', { chain: true, cuisine: 'burger' }),
      result('Pizzeria', { cuisine: 'pizza;italian' }),
      result('Z przewodnika', { tip, cuisine: 'italian' }),
      result('Nasza', { memory: { worth: 2, notWorth: 0, notes: [] } }),
      result('Nie warto', { memory: { worth: 0, notWorth: 1, notes: [] } }),
    ];
    expect(filterEateries(all, DEFAULT_EATERY_FILTER).map((each) => each.name)).toEqual(['Pizzeria', 'Z przewodnika', 'Nasza', 'Nie warto']);
    expect(filterEateries(all, { ...DEFAULT_EATERY_FILTER, cuisines: ['włoska'] }).map((each) => each.name)).toEqual(['Pizzeria', 'Z przewodnika']);
    expect(filterEateries(all, { ...DEFAULT_EATERY_FILTER, cuisines: ['pizza', 'burgery'], noChains: false }).map((each) => each.name)).toEqual(['Sieć', 'Pizzeria']);
    expect(filterEateries(all, { ...DEFAULT_EATERY_FILTER, onlyRecommended: true }).map((each) => each.name)).toEqual(['Z przewodnika', 'Nasza']);
    expect(cuisineOptions([result('A', { cuisine: 'pasta;noodle' }), result('B', { cuisine: 'noodles' })])).toEqual([{ key: 'makarony', label: 'makarony', count: 2 }]);
    expect(cuisineOptions(all)).toEqual([
      { key: 'włoska', label: 'włoska', count: 2 },
      { key: 'burgery', label: 'burgery', count: 1 },
      { key: 'pizza', label: 'pizza', count: 1 },
    ]);
  });

  it('kolejność: zamknięte na koniec; polecane (też bez godzin), zwykłe, sieciówki, nasze „nie warto”; potem bliżej trasy', () => {
    const open = { state: 'open' as const };
    const ranked = rankEateries([
      result('Nie warto', { open, distanceM: 10, memory: { worth: 0, notWorth: 2, notes: [] } }),
      result('Sieć', { open, distanceM: 10, chain: true }),
      result('Daleko zwykła', { open, distanceM: 50, routeM: 400 }),
      result('Blisko trasy', { open, distanceM: 900, routeM: 20 }),
      result('Polecana', { open, distanceM: 800, tip: { source: 'wikivoyage', article: 'A', url: 'https://x.org' } }),
      result('Polecana bez godzin', { distanceM: 10, tip: { source: 'wikivoyage', article: 'A', url: 'https://x.org' } }),
      result('Zamknięta polecana', { open: { state: 'closed' }, tip: { source: 'wikivoyage', article: 'A', url: 'https://x.org' } }),
    ]);
    expect(ranked.map((each) => each.name)).toEqual(['Polecana', 'Polecana bez godzin', 'Blisko trasy', 'Daleko zwykła', 'Sieć', 'Nie warto', 'Zamknięta polecana']);
  });

  it('mapa wyników: numer = pozycja na liście, stały klucz wyniku do wskazania w obie strony', () => {
    const { keys, map } = eateryResultsMap([result('A', { summary: 'pizza' }), result('B', { lat: 31.7 })]);
    expect(keys).toEqual(['A|31.6262|-7.9891', 'B|31.7|-7.9891']);
    expect(map.pins.map((pin) => [pin.placeRef, pin.stops[0]!.n, pin.stops[0]!.title])).toEqual([
      ['A|31.6262|-7.9891', 1, 'pizza'],
      ['B|31.7|-7.9891', 2, ''],
    ]);
    expect(map.numbers).toEqual({ 'A|31.6262|-7.9891': 1, 'B|31.7|-7.9891': 2 });
  });

  it('opinie w Google: sam link wyszukiwania po nazwie i adresie (albo współrzędnych)', () => {
    expect(googleMapsSearchUrl({ name: 'Café Clock', address: 'Derb Chtouka 224, Marrakesz', lat: 31.6, lng: -7.9 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20Clock%2C%20Derb%20Chtouka%20224%2C%20Marrakesz',
    );
    expect(googleMapsSearchUrl({ name: 'Nomad', lat: 31.625831, lng: -7.988921 })).toBe('https://www.google.com/maps/search/?api=1&query=Nomad%2031.62583%2C-7.98892');
  });

  it('przypięta knajpa z polecenia ma link do artykułu Wikivoyage (bez tekstu wpisu)', () => {
    const tip = { source: 'wikivoyage' as const, article: 'Marrakech', url: 'https://en.wikivoyage.org/wiki/Marrakech', text: 'Great tagine.' };
    const edit = addEatOutChoices(maroko, 'd2-lunch', [{ eatery: { name: 'Nowa Knajpa', lat: 31.626, lng: -7.988, kind: 'restaurant', tip } }], () => 'id-00000000-0000-7000-8000-000000000999')!;
    const place = edit.doc.places.find((each) => each.name === 'Nowa Knajpa')!;
    expect(place.links).toEqual([{ label: 'Wikivoyage: Marrakech', url: 'https://en.wikivoyage.org/wiki/Marrakech' }]);
    expect(JSON.stringify(place)).not.toContain('Great tagine');
  });
});
