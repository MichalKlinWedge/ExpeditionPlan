import { describe, expect, it } from 'vitest';

import { geoapifyHit, geoapifyLookup } from '../geoapify.ts';

describe('Geoapify jako źródło miejsc', () => {
  it('wynik z OSM: współrzędne, godziny otwarcia, obszar administracyjny jako `place`', () => {
    expect(
      geoapifyHit({
        lat: 31.63,
        lon: -7.99,
        formatted: 'Medersa Ben Youssef, Marrakesz',
        result_type: 'amenity',
        country_code: 'ma',
        datasource: { sourcename: 'openstreetmap', raw: { osm_id: 123, osm_type: 'w', opening_hours: 'Mo-Su 09:00-19:00' } },
      }),
    ).toEqual({ lat: 31.63, lng: -7.99, displayName: 'Medersa Ben Youssef, Marrakesz', osmType: 'w', osmId: 123, category: 'amenity', countryCode: 'ma', openingHours: 'Mo-Su 09:00-19:00' });
    expect(geoapifyHit({ lat: 1, lon: 2, result_type: 'city' })?.category).toBe('place');
    expect(geoapifyHit({ formatted: 'bez współrzędnych' })).toBeNull();
  });

  it('zapytanie: kraje i prostokąt w jednym filtrze, klucz w parametrze, pusty wynik = null', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;
    const lookup = geoapifyLookup('test-key', fake);
    expect(await lookup('Bahia', ['MA', 'pl'], { south: 31, west: -8.1, north: 31.7, east: -7.9 })).toBeNull();
    const params = new URL(urls[0]!).searchParams;
    expect(params.get('text')).toBe('Bahia');
    expect(params.get('filter')).toBe('countrycode:ma,pl|rect:-8.1,31,-7.9,31.7');
    expect(params.get('apiKey')).toBe('test-key');
  });

  it('błąd usługi przechodzi wyżej', async () => {
    const lookup = geoapifyLookup('k', (async () => new Response('', { status: 401 })) as typeof fetch);
    await expect(lookup('x', ['ma'])).rejects.toThrow('Geoapify 401');
  });
});
