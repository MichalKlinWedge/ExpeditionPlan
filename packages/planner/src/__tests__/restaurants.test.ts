import { describe, expect, it } from 'vitest';

import { eateryFrom, findEateries } from '../restaurants.ts';

describe('knajpy z Geoapify Places', () => {
  it('wynik z OSM: rodzaj, kuchnia, godziny, strona, dieta, link do OSM; bez nazwy = pomijamy', () => {
    expect(
      eateryFrom({
        properties: {
          name: 'Café Clock',
          lat: 31.62,
          lon: -7.98,
          categories: ['catering', 'catering.cafe'],
          address_line2: 'Derb Chtouka 224, Marrakesz',
          datasource: { raw: { osm_id: -55, osm_type: 'w', cuisine: 'moroccan;burger', opening_hours: 'Mo-Su 09:00-22:00', 'contact:website': 'https://cafeclock.com', 'diet:vegan': 'yes' } },
        },
      }),
    ).toEqual({
      name: 'Café Clock',
      lat: 31.62,
      lng: -7.98,
      kind: 'cafe',
      address: 'Derb Chtouka 224, Marrakesz',
      cuisine: 'moroccan;burger',
      openingHours: 'Mo-Su 09:00-22:00',
      website: 'https://cafeclock.com',
      osm: { type: 'way', id: 55 },
      vegetarian: true,
      vegan: true,
    });
    expect(eateryFrom({ properties: { lat: 1, lon: 2 } })).toBeNull();
  });

  it('zapytanie: kategorie rodzajów, okrąg i bliskość (lon,lat), dieta jako `conditions`', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ features: [{ properties: { name: 'X', lat: 1, lon: 2, categories: ['catering.fast_food'] } }] }), { status: 200 });
    }) as typeof fetch;
    const found = await findEateries('test-key', { lat: 31.6, lng: -7.9, radiusM: 1000, kinds: ['restaurant', 'fast_food'], diet: 'vegetarian' }, fake);
    expect(found.map((each) => each.kind)).toEqual(['fast_food']);
    const params = new URL(urls[0]!).searchParams;
    expect(params.get('categories')).toBe('catering.restaurant,catering.fast_food,catering.food_court');
    expect(params.get('filter')).toBe('circle:-7.9,31.6,1000');
    expect(params.get('bias')).toBe('proximity:-7.9,31.6');
    expect(params.get('conditions')).toBe('vegetarian');
    expect(params.get('apiKey')).toBe('test-key');
  });
});
